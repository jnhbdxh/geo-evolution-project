import { randomUUID } from "node:crypto";

import fastifyJwt from "@fastify/jwt";
import {
  createBrandSchema,
  createCustomerSchema,
  createExecutionRunSchema,
  createMembershipSchema,
  createProjectSchema,
  createTenantSchema,
  deactivateEntitySchema,
  replaceIndustryBindingSchema,
  replacePolicyBindingSchema,
  tenantRoles,
  type AuthenticatedIdentity,
  type TenantContext,
  type TenantRole,
} from "@geo-os/contracts";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";

import type { AccessControl } from "./access.js";
import type { ApiConfig } from "./config.js";
import { DomainError, forbidden } from "./errors.js";
import type { ObservationRepository } from "./observation-repository.js";
import type { WorkspaceRepository } from "./workspace-repository.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

declare module "fastify" {
  interface FastifyRequest {
    identity: AuthenticatedIdentity | null;
    tenantContext: TenantContext | null;
  }
}

export interface AppDependencies {
  readonly config: ApiConfig;
  readonly accessControl: AccessControl;
  readonly workspaceRepository: WorkspaceRepository;
  readonly observationRepository: ObservationRepository;
}

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: dependencies.config.LOG_LEVEL },
    genReqId: () => randomUUID(),
  });

  await app.register(fastifyJwt, { secret: dependencies.config.JWT_SECRET });
  app.decorateRequest("identity", null);
  app.decorateRequest("tenantContext", null);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "Request validation failed",
          traceId: request.id,
          details: error.issues,
        },
      });
    }
    if (error instanceof DomainError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          traceId: request.id,
          details: error.details,
        },
      });
    }
    request.log.error({ error }, "Unhandled request error");
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected server error",
        traceId: request.id,
      },
    });
  });

  app.get("/v1/health", () => ({ data: { status: "ok" } }));

  if (dependencies.config.AUTH_MODE === "development") {
    app.post("/v1/auth/dev-token", (request) => {
      const input = z.strictObject({ userIdentityId: z.uuid() }).parse(request.body);
      return { data: { token: app.jwt.sign({ sub: input.userIdentityId }) } };
    });
  }

  app.get(
    "/v1/context",
    { preHandler: tenantPreHandler(dependencies.accessControl) },
    (request) => ({ data: requireResolvedTenantContext(request) }),
  );

  app.post(
    "/v1/platform/tenants",
    { preHandler: platformAdminPreHandler(dependencies.accessControl) },
    async (request, reply) => {
      const input = createTenantSchema.parse(request.body);
      const identity = requireIdentity(request);
      const tenant = await dependencies.workspaceRepository.provisionTenant(
        input,
        identity.userIdentityId,
        request.id,
      );
      return reply.status(201).send({ data: tenant });
    },
  );

  app.post(
    "/v1/platform/tenants/:tenantId/suspend",
    { preHandler: platformAdminPreHandler(dependencies.accessControl) },
    async (request) => {
      const { tenantId } = tenantIdParamsSchema.parse(request.params);
      const identity = requireIdentity(request);
      const tenant = await dependencies.workspaceRepository.suspendTenant(
        tenantId,
        deactivateEntitySchema.parse(request.body),
        identity.userIdentityId,
        request.id,
      );
      return { data: tenant };
    },
  );

  app.post(
    "/v1/platform/tenants/:tenantId/deactivate",
    { preHandler: platformAdminPreHandler(dependencies.accessControl) },
    async (request) => {
      const { tenantId } = tenantIdParamsSchema.parse(request.params);
      const identity = requireIdentity(request);
      const tenant = await dependencies.workspaceRepository.deactivateTenant(
        tenantId,
        deactivateEntitySchema.parse(request.body),
        identity.userIdentityId,
        request.id,
      );
      return { data: tenant };
    },
  );

  app.post(
    "/v1/memberships",
    { preHandler: tenantRolePreHandler(dependencies.accessControl, "TENANT_ADMIN") },
    async (request, reply) => {
      const membership = await dependencies.workspaceRepository.createMembership(
        requireResolvedTenantContext(request),
        createMembershipSchema.parse(request.body),
        request.id,
      );
      return reply.status(201).send({ data: membership });
    },
  );

  app.post(
    "/v1/customers",
    { preHandler: tenantRolePreHandler(dependencies.accessControl, "TENANT_MEMBER") },
    async (request, reply) => {
      const customer = await dependencies.workspaceRepository.createCustomer(
        requireResolvedTenantContext(request),
        createCustomerSchema.parse(request.body),
        request.id,
      );
      return reply.status(201).send({ data: customer });
    },
  );

  app.post(
    "/v1/brands",
    { preHandler: tenantRolePreHandler(dependencies.accessControl, "TENANT_MEMBER") },
    async (request, reply) => {
      const brand = await dependencies.workspaceRepository.createBrand(
        requireResolvedTenantContext(request),
        createBrandSchema.parse(request.body),
        request.id,
      );
      return reply.status(201).send({ data: brand });
    },
  );

  app.post(
    "/v1/projects",
    { preHandler: tenantRolePreHandler(dependencies.accessControl, "TENANT_MEMBER") },
    async (request, reply) => {
      const project = await dependencies.workspaceRepository.createProject(
        requireResolvedTenantContext(request),
        createProjectSchema.parse(request.body),
        request.id,
      );
      return reply.status(201).send({ data: project });
    },
  );

  app.post(
    "/v1/memberships/:id/deactivate",
    { preHandler: tenantRolePreHandler(dependencies.accessControl, "TENANT_ADMIN") },
    async (request) => {
      const { id } = resourceIdParamsSchema.parse(request.params);
      const membership = await dependencies.workspaceRepository.deactivateMembership(
        requireResolvedTenantContext(request),
        id,
        deactivateEntitySchema.parse(request.body),
        request.id,
      );
      return { data: membership };
    },
  );

  app.post(
    "/v1/customers/:id/deactivate",
    { preHandler: tenantRolePreHandler(dependencies.accessControl, "TENANT_ADMIN") },
    async (request) => {
      const { id } = resourceIdParamsSchema.parse(request.params);
      const customer = await dependencies.workspaceRepository.deactivateCustomer(
        requireResolvedTenantContext(request),
        id,
        deactivateEntitySchema.parse(request.body),
        request.id,
      );
      return { data: customer };
    },
  );

  app.post(
    "/v1/brands/:id/deactivate",
    { preHandler: tenantRolePreHandler(dependencies.accessControl, "TENANT_ADMIN") },
    async (request) => {
      const { id } = resourceIdParamsSchema.parse(request.params);
      const brand = await dependencies.workspaceRepository.deactivateBrand(
        requireResolvedTenantContext(request),
        id,
        deactivateEntitySchema.parse(request.body),
        request.id,
      );
      return { data: brand };
    },
  );

  app.post(
    "/v1/projects/:id/deactivate",
    { preHandler: tenantRolePreHandler(dependencies.accessControl, "TENANT_ADMIN") },
    async (request) => {
      const { id } = resourceIdParamsSchema.parse(request.params);
      const project = await dependencies.workspaceRepository.deactivateProject(
        requireResolvedTenantContext(request),
        id,
        deactivateEntitySchema.parse(request.body),
        request.id,
      );
      return { data: project };
    },
  );

  app.post(
    "/v1/projects/:projectId/policy-bindings",
    { preHandler: tenantRolePreHandler(dependencies.accessControl, "TENANT_ADMIN") },
    async (request) => {
      const { projectId } = projectIdParamsSchema.parse(request.params);
      const binding = await dependencies.workspaceRepository.replacePolicyBinding(
        requireResolvedTenantContext(request),
        projectId,
        replacePolicyBindingSchema.parse(request.body),
        request.id,
      );
      return { data: binding };
    },
  );

  app.post(
    "/v1/projects/:projectId/industry-binding",
    { preHandler: tenantRolePreHandler(dependencies.accessControl, "TENANT_ADMIN") },
    async (request) => {
      const { projectId } = projectIdParamsSchema.parse(request.params);
      const binding = await dependencies.workspaceRepository.replaceIndustryBinding(
        requireResolvedTenantContext(request),
        projectId,
        replaceIndustryBindingSchema.parse(request.body),
        request.id,
      );
      return { data: binding };
    },
  );

  app.post(
    "/v1/projects/:projectId/execution-runs",
    { preHandler: tenantRolePreHandler(dependencies.accessControl, "TENANT_MEMBER") },
    async (request, reply) => {
      const { projectId } = projectIdParamsSchema.parse(request.params);
      const executionRun = await dependencies.observationRepository.createExecutionRun(
        requireResolvedTenantContext(request),
        projectId,
        createExecutionRunSchema.parse(request.body),
        request.id,
      );
      return reply.status(201).send({ data: executionRun });
    },
  );

  return app;
}

const resourceIdParamsSchema = z.strictObject({ id: z.uuid() });
const projectIdParamsSchema = z.strictObject({ projectId: z.uuid() });
const tenantIdParamsSchema = z.strictObject({ tenantId: z.uuid() });

function authenticatedPreHandler(): (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void> {
  return async (request, reply) => {
    try {
      await request.jwtVerify();
      request.identity = { userIdentityId: request.user.sub };
    } catch {
      await reply.status(401).send({
        error: {
          code: "UNAUTHENTICATED",
          message: "A valid Bearer token is required",
          traceId: request.id,
        },
      });
    }
  };
}

function tenantPreHandler(
  accessControl: AccessControl,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const authenticate = authenticatedPreHandler();
  return async (request, reply) => {
    await authenticate(request, reply);
    if (reply.sent) return;

    const identity = requireIdentity(request);
    const tenantHeader = request.headers["x-tenant-id"];
    const tenantId = z.uuid().parse(Array.isArray(tenantHeader) ? tenantHeader[0] : tenantHeader);
    const context = await accessControl.resolveTenantContext(identity.userIdentityId, tenantId);
    if (!context) throw forbidden();
    request.tenantContext = context;
  };
}

function tenantRolePreHandler(
  accessControl: AccessControl,
  minimumRole: TenantRole,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const resolveTenant = tenantPreHandler(accessControl);
  return async (request, reply) => {
    await resolveTenant(request, reply);
    if (reply.sent) return;

    const context = requireResolvedTenantContext(request);
    if (!hasMinimumTenantRole(context.roles, minimumRole)) throw forbidden();
  };
}

function platformAdminPreHandler(
  accessControl: AccessControl,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const authenticate = authenticatedPreHandler();
  return async (request, reply) => {
    await authenticate(request, reply);
    if (reply.sent) return;

    const identity = requireIdentity(request);
    if (!(await accessControl.isPlatformAdmin(identity.userIdentityId))) throw forbidden();
  };
}

function hasMinimumTenantRole(roles: readonly TenantRole[], minimumRole: TenantRole): boolean {
  if (minimumRole === "TENANT_MEMBER") {
    return roles.some((role) => tenantRoles.includes(role));
  }
  return roles.includes("TENANT_ADMIN");
}

function requireIdentity(request: FastifyRequest): AuthenticatedIdentity {
  if (!request.identity) throw new DomainError("UNAUTHENTICATED", "Authentication required", 401);
  return request.identity;
}

function requireResolvedTenantContext(request: FastifyRequest): TenantContext {
  if (!request.tenantContext) throw forbidden();
  return request.tenantContext;
}
