import { randomUUID } from "node:crypto";

import fastifyJwt from "@fastify/jwt";
import {
  createBrandSchema,
  captureArtifactMetadataSchema,
  cancelExecutionRunSchema,
  completeExecutionRunSchema,
  createCustomerSchema,
  createExecutionRunSchema,
  createMembershipSchema,
  createObservationCandidateSchema,
  createProjectSchema,
  createTenantSchema,
  deactivateEntitySchema,
  failExecutionRunSchema,
  finalizeObservationSchema,
  replaceIndustryBindingSchema,
  replacePolicyBindingSchema,
  startExecutionRunSchema,
  tenantRoles,
  type AuthenticatedIdentity,
  type DomainCommandContext,
  type TenantContext,
  type TenantRole,
} from "@geo-os/contracts";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";

import type { AccessControl } from "./access.js";
import type { CaptureService } from "./capture-service.js";
import type { ApiConfig } from "./config.js";
import { DomainError, forbidden } from "./errors.js";
import type {
  InternalExecutionAuth,
  InternalExecutionPrincipal,
} from "./internal-execution-auth.js";
import type { ObservationFinalizationService } from "./observation-finalization-service.js";
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
    internalExecutionPrincipal: InternalExecutionPrincipal | null;
  }
}

export interface AppDependencies {
  readonly config: ApiConfig;
  readonly accessControl: AccessControl;
  readonly workspaceRepository: WorkspaceRepository;
  readonly observationRepository: ObservationRepository;
  readonly captureService: Pick<CaptureService, "captureBytes">;
  readonly observationFinalizationService: Pick<ObservationFinalizationService, "finalize">;
  readonly internalExecutionAuth: InternalExecutionAuth;
}

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: dependencies.config.LOG_LEVEL },
    genReqId: () => randomUUID(),
  });

  await app.register(fastifyJwt, { secret: dependencies.config.JWT_SECRET });
  app.decorateRequest("identity", null);
  app.decorateRequest("tenantContext", null);
  app.decorateRequest("internalExecutionPrincipal", null);

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

  const internalPreHandler = internalExecutionPreHandler(dependencies.internalExecutionAuth);

  app.get(
    "/v1/internal/execution-runs/:executionRunId/assignment",
    { preHandler: internalPreHandler },
    async (request) => {
      const principal = requireInternalExecutionPrincipal(request);
      const { executionRunId } = internalExecutionParamsSchema.parse(request.params);
      requireAuthorizedExecution(principal, executionRunId);
      const assignment = await dependencies.observationRepository.resolveExecutionAssignment(
        internalCommandContext(principal),
        executionRunId,
      );
      return { data: assignment };
    },
  );

  app.post(
    "/v1/internal/execution-runs/:executionRunId/start",
    { preHandler: internalPreHandler },
    async (request) => {
      const principal = requireInternalExecutionPrincipal(request);
      const { executionRunId } = internalExecutionParamsSchema.parse(request.params);
      requireAuthorizedExecution(principal, executionRunId);
      const run = await dependencies.observationRepository.startExecutionRun(
        internalCommandContext(principal),
        executionRunId,
        startExecutionRunSchema.parse(request.body),
        request.id,
      );
      return { data: run };
    },
  );

  app.post(
    "/v1/internal/execution-runs/:executionRunId/capture-artifacts",
    { preHandler: internalPreHandler, bodyLimit: 14 * 1_024 * 1_024 },
    async (request, reply) => {
      const principal = requireInternalExecutionPrincipal(request);
      const { executionRunId } = internalExecutionParamsSchema.parse(request.params);
      requireAuthorizedExecution(principal, executionRunId);
      const input = internalCaptureUploadSchema.parse(request.body);
      const artifact = await dependencies.captureService.captureBytes(
        internalCommandContext(principal),
        {
          executionRunId,
          idempotencyKey: input.idempotencyKey,
          artifactKind: input.artifactKind,
          mediaType: input.mediaType,
          capturedAt: input.capturedAt,
          declaredSha256: input.declaredSha256,
          bytes: decodeCaptureBytes(input.bytesBase64),
        },
        request.id,
      );
      return reply.status(201).send({ data: artifact });
    },
  );

  app.post(
    "/v1/internal/execution-runs/:executionRunId/observation-candidates",
    { preHandler: internalPreHandler },
    async (request, reply) => {
      const principal = requireInternalExecutionPrincipal(request);
      const { executionRunId } = internalExecutionParamsSchema.parse(request.params);
      requireAuthorizedExecution(principal, executionRunId);
      const command = createObservationCandidateSchema.parse(request.body);
      requireAuthorizedExecution(principal, command.executionRunId);
      const candidate = await dependencies.observationRepository.createObservationCandidate(
        internalCommandContext(principal),
        command,
        request.id,
      );
      return reply.status(201).send({ data: candidate });
    },
  );

  app.post(
    "/v1/internal/execution-runs/:executionRunId/complete",
    { preHandler: internalPreHandler },
    async (request) => {
      const principal = requireInternalExecutionPrincipal(request);
      const { executionRunId } = internalExecutionParamsSchema.parse(request.params);
      requireAuthorizedExecution(principal, executionRunId);
      const run = await dependencies.observationRepository.completeExecutionRun(
        internalCommandContext(principal),
        executionRunId,
        completeExecutionRunSchema.parse(request.body),
        request.id,
      );
      return { data: run };
    },
  );

  app.post(
    "/v1/internal/execution-runs/:executionRunId/fail",
    { preHandler: internalPreHandler },
    async (request) => {
      const principal = requireInternalExecutionPrincipal(request);
      const { executionRunId } = internalExecutionParamsSchema.parse(request.params);
      requireAuthorizedExecution(principal, executionRunId);
      const run = await dependencies.observationRepository.failExecutionRun(
        internalCommandContext(principal),
        executionRunId,
        failExecutionRunSchema.parse(request.body),
        request.id,
      );
      return { data: run };
    },
  );

  app.post(
    "/v1/internal/execution-runs/:executionRunId/cancel",
    { preHandler: internalPreHandler },
    async (request) => {
      const principal = requireInternalExecutionPrincipal(request);
      const { executionRunId } = internalExecutionParamsSchema.parse(request.params);
      requireAuthorizedExecution(principal, executionRunId);
      const run = await dependencies.observationRepository.cancelExecutionRun(
        internalCommandContext(principal),
        executionRunId,
        cancelExecutionRunSchema.parse(request.body),
        request.id,
      );
      return { data: run };
    },
  );

  app.post(
    "/v1/internal/execution-runs/:executionRunId/finalize",
    { preHandler: internalPreHandler },
    async (request, reply) => {
      const principal = requireInternalExecutionPrincipal(request);
      const { executionRunId } = internalExecutionParamsSchema.parse(request.params);
      requireAuthorizedExecution(principal, executionRunId);
      const observation = await dependencies.observationFinalizationService.finalize(
        internalCommandContext(principal),
        finalizeObservationSchema.parse(request.body),
        request.id,
        executionRunId,
      );
      return reply.status(201).send({ data: observation });
    },
  );

  return app;
}

const resourceIdParamsSchema = z.strictObject({ id: z.uuid() });
const projectIdParamsSchema = z.strictObject({ projectId: z.uuid() });
const tenantIdParamsSchema = z.strictObject({ tenantId: z.uuid() });
const internalExecutionParamsSchema = z.strictObject({ executionRunId: z.uuid() });
const internalCaptureUploadSchema = captureArtifactMetadataSchema
  .omit({ executionRunId: true })
  .extend({
    bytesBase64: z
      .string()
      .min(1)
      .max(14 * 1_024 * 1_024)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u),
  });
const maximumCaptureBytes = 10 * 1_024 * 1_024;

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

function internalExecutionPreHandler(
  auth: InternalExecutionAuth,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      await reply.status(401).send({
        error: {
          code: "INTERNAL_UNAUTHENTICATED",
          message: "A valid execution-scoped internal token is required",
          traceId: request.id,
        },
      });
      return;
    }
    request.internalExecutionPrincipal = auth.verify(authorization.slice("Bearer ".length));
  };
}

function requireInternalExecutionPrincipal(request: FastifyRequest): InternalExecutionPrincipal {
  if (!request.internalExecutionPrincipal) {
    throw new DomainError("INTERNAL_UNAUTHENTICATED", "Internal authentication required", 401);
  }
  return request.internalExecutionPrincipal;
}

function requireAuthorizedExecution(
  principal: InternalExecutionPrincipal,
  executionRunId: string,
): void {
  if (principal.executionRunId !== executionRunId) {
    throw forbidden("Internal token is not authorized for this ExecutionRun");
  }
}

function internalCommandContext(principal: InternalExecutionPrincipal): DomainCommandContext {
  return {
    tenantId: principal.tenantId,
    userIdentityId: null,
    actorService: principal.service,
  };
}

function decodeCaptureBytes(value: string): Uint8Array {
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength > maximumCaptureBytes) {
    throw new DomainError(
      "CAPTURE_TOO_LARGE",
      `CaptureArtifact exceeds the ${maximumCaptureBytes} byte internal upload limit`,
      413,
    );
  }
  return new Uint8Array(bytes);
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
