import type {
  CreateBrandInput,
  CreateCustomerInput,
  CreateMembershipInput,
  CreateProjectInput,
  CreateTenantInput,
  DeactivateEntityInput,
  ReplaceIndustryBindingInput,
  ReplacePolicyBindingInput,
  TenantContext,
} from "@geo-os/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AccessControl } from "./access.js";
import { buildApp, type AppDependencies } from "./app.js";
import type { ObservationRepository } from "./observation-repository.js";
import type { WorkspaceRepository } from "./workspace-repository.js";

const userIdentityId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const otherTenantId = "33333333-3333-4333-8333-333333333333";
const brandId = "44444444-4444-4444-8444-444444444444";
const projectId = "66666666-6666-4666-8666-666666666666";
const policyReleaseId = "77777777-7777-4777-8777-777777777777";
const invitedUserIdentityId = "88888888-8888-4888-8888-888888888888";
const sampleSlotId = "99999999-9999-4999-8999-999999999999";

const activeContext: TenantContext = {
  userIdentityId,
  tenantId,
  membershipId: "55555555-5555-4555-8555-555555555555",
  roles: ["TENANT_MEMBER"],
};

const adminContext: TenantContext = { ...activeContext, roles: ["TENANT_ADMIN"] };

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("authentication and Tenant Context", () => {
  it("resolves roles from active database membership rather than JWT claims", async () => {
    const workspace = createWorkspaceRepository();
    const app = await createTestApp(createAccessControl(activeContext), workspace);
    const token = await issueToken(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": tenantId },
      payload: { name: "Acme" },
    });

    expect(response.statusCode).toBe(201);
    expect(workspace.createCustomer).toHaveBeenCalledOnce();
  });

  it("denies a different Tenant without revealing its data", async () => {
    const app = await createTestApp(
      createAccessControl(activeContext),
      createWorkspaceRepository(),
    );
    const token = await issueToken(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/context",
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": otherTenantId },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("denies a deactivated UserIdentity even when its JWT has not expired", async () => {
    const app = await createTestApp(createAccessControl(null), createWorkspaceRepository());
    const token = await issueToken(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/context",
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": tenantId },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("keeps platform authorization separate from Tenant roles", async () => {
    const app = await createTestApp(
      createAccessControl(activeContext, false),
      createWorkspaceRepository(),
    );
    const token = await issueToken(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/platform/tenants",
      headers: { authorization: `Bearer ${token}` },
      payload: { slug: "tenant-a", name: "Tenant A", initialAdminUserIdentityId: userIdentityId },
    });

    expect(response.statusCode).toBe(403);
  });

  it("rejects customer_id on Project input because Customer is derived through Brand", async () => {
    const workspace = createWorkspaceRepository();
    const app = await createTestApp(createAccessControl(activeContext), workspace);
    const token = await issueToken(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": tenantId },
      payload: { brandId, customerId: otherTenantId, name: "Project A" },
    });

    expect(response.statusCode).toBe(400);
    expect(workspace.createProject).not.toHaveBeenCalled();
  });

  it("requires TENANT_ADMIN to create a Membership", async () => {
    const workspace = createWorkspaceRepository();
    const app = await createTestApp(createAccessControl(activeContext), workspace);
    const token = await issueToken(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/memberships",
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": tenantId },
      payload: { userIdentityId: invitedUserIdentityId, roles: ["TENANT_MEMBER"] },
    });

    expect(response.statusCode).toBe(403);
    expect(workspace.createMembership).not.toHaveBeenCalled();
  });

  it("allows TENANT_ADMIN to create a Membership with fixed roles", async () => {
    const workspace = createWorkspaceRepository();
    const app = await createTestApp(createAccessControl(adminContext), workspace);
    const token = await issueToken(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/memberships",
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": tenantId },
      payload: { userIdentityId: invitedUserIdentityId, roles: ["TENANT_MEMBER"] },
    });

    expect(response.statusCode).toBe(201);
    expect(workspace.createMembership).toHaveBeenCalledOnce();
  });

  it("validates and dispatches explicit deactivation commands", async () => {
    const workspace = createWorkspaceRepository();
    const app = await createTestApp(createAccessControl(adminContext), workspace);
    const token = await issueToken(app);

    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/deactivate`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": tenantId },
      payload: { reason: "No longer monitored" },
    });

    expect(response.statusCode).toBe(200);
    expect(workspace.deactivateProject).toHaveBeenCalledOnce();
  });

  it("allows TENANT_ADMIN to replace future default bindings", async () => {
    const workspace = createWorkspaceRepository();
    const app = await createTestApp(createAccessControl(adminContext), workspace);
    const token = await issueToken(app);
    const headers = { authorization: `Bearer ${token}`, "x-tenant-id": tenantId };

    const policyResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/policy-bindings`,
      headers,
      payload: { policyReleaseId, reason: "Adopt validated policy" },
    });
    const industryResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/industry-binding`,
      headers,
      payload: { industryPolicyReleaseId: null, reason: "Clear optional industry default" },
    });

    expect(policyResponse.statusCode).toBe(200);
    expect(industryResponse.statusCode).toBe(200);
    expect(workspace.replacePolicyBinding).toHaveBeenCalledOnce();
    expect(workspace.replaceIndustryBinding).toHaveBeenCalledOnce();
  });

  it("queues an ExecutionRun through the tenant-scoped versioned command API", async () => {
    const observation = createObservationRepository();
    const app = await createTestApp(
      createAccessControl(activeContext),
      createWorkspaceRepository(),
      observation,
    );
    const token = await issueToken(app);
    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/execution-runs`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": tenantId },
      payload: {
        sampleSlotId,
        idempotencyKey: "run-anchor-question-1",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(observation.createExecutionRun).toHaveBeenCalledWith(
      activeContext,
      projectId,
      expect.objectContaining({ sampleSlotId, idempotencyKey: "run-anchor-question-1" }),
      expect.any(String),
    );
  });

  it("rejects Tenant attempts to declare actual execution facts while queuing", async () => {
    const observation = createObservationRepository();
    const app = await createTestApp(
      createAccessControl(activeContext),
      createWorkspaceRepository(),
      observation,
    );
    const token = await issueToken(app);
    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/execution-runs`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": tenantId },
      payload: {
        sampleSlotId,
        idempotencyKey: "forged-actual-context",
        actualPlatform: "declared-by-tenant",
        actualModel: "unverified-model",
        actualSurface: "chat",
        executionContextSnapshot: { source: "tenant" },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(observation.createExecutionRun).not.toHaveBeenCalled();
  });
});

function createAccessControl(context: TenantContext | null, platformAdmin = false): AccessControl {
  return {
    async resolveTenantContext(requestUserIdentityId, requestTenantId) {
      if (
        context?.userIdentityId === requestUserIdentityId &&
        context.tenantId === requestTenantId
      ) {
        return context;
      }
      return null;
    },
    async isPlatformAdmin(requestUserIdentityId) {
      return platformAdmin && requestUserIdentityId === userIdentityId;
    },
  };
}

function createWorkspaceRepository(): WorkspaceRepository & {
  createCustomer: ReturnType<typeof vi.fn>;
  createMembership: ReturnType<typeof vi.fn>;
  createProject: ReturnType<typeof vi.fn>;
  deactivateProject: ReturnType<typeof vi.fn>;
  replacePolicyBinding: ReturnType<typeof vi.fn>;
  replaceIndustryBinding: ReturnType<typeof vi.fn>;
} {
  return {
    provisionTenant: vi.fn(async (input: CreateTenantInput) => input),
    createCustomer: vi.fn(async (_context: TenantContext, input: CreateCustomerInput) => input),
    createBrand: vi.fn(async (_context: TenantContext, input: CreateBrandInput) => input),
    createProject: vi.fn(async (_context: TenantContext, input: CreateProjectInput) => input),
    createMembership: vi.fn(async (_context: TenantContext, input: CreateMembershipInput) => input),
    deactivateMembership: vi.fn(
      async (_context: TenantContext, _id: string, input: DeactivateEntityInput) => input,
    ),
    deactivateCustomer: vi.fn(
      async (_context: TenantContext, _id: string, input: DeactivateEntityInput) => input,
    ),
    deactivateBrand: vi.fn(
      async (_context: TenantContext, _id: string, input: DeactivateEntityInput) => input,
    ),
    deactivateProject: vi.fn(
      async (_context: TenantContext, _id: string, input: DeactivateEntityInput) => input,
    ),
    suspendTenant: vi.fn(async (_id: string, input: DeactivateEntityInput) => input),
    deactivateTenant: vi.fn(async (_id: string, input: DeactivateEntityInput) => input),
    replacePolicyBinding: vi.fn(
      async (_context: TenantContext, _id: string, input: ReplacePolicyBindingInput) => input,
    ),
    replaceIndustryBinding: vi.fn(
      async (_context: TenantContext, _id: string, input: ReplaceIndustryBindingInput) => input,
    ),
  };
}

function createObservationRepository(): ObservationRepository & {
  createExecutionRun: ReturnType<typeof vi.fn>;
} {
  return {
    addQuestionVersionToDraftPlan: vi.fn(async () => ({
      id: randomId(1),
      tenant_id: tenantId,
      project_id: projectId,
      monitoring_plan_version_id: randomId(2),
      question_version_id: randomId(3),
      ordinal: 1,
    })),
    createExecutionRun: vi.fn(async (_context, _projectId, input) => ({
      id: randomId(4),
      tenant_id: tenantId,
      project_id: projectId,
      sample_slot_id: input.sampleSlotId,
      question_version_id: randomId(5),
      retry_of_execution_run_id: input.retryOfExecutionRunId ?? null,
      attempt_no: 1,
      idempotency_key: input.idempotencyKey,
      operational_status: "QUEUED" as const,
      response_outcome_kind: null,
      actual_platform: null,
      actual_model: null,
      actual_surface: null,
      policy_release_id: policyReleaseId,
      industry_policy_release_id: null,
      execution_context_snapshot: null,
      started_at: null,
      completed_at: null,
      operational_error: null,
      created_at: new Date(),
    })),
    startExecutionRun: vi.fn(),
    completeExecutionRun: vi.fn(),
    failExecutionRun: vi.fn(),
    cancelExecutionRun: vi.fn(),
    createObservationCandidate: vi.fn(),
    resolveObservationFinalizationEvidence: vi.fn(),
    finalizeObservation: vi.fn(),
  };
}

function randomId(suffix: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${suffix.toString().padStart(12, "0")}`;
}

async function createTestApp(
  accessControl: AccessControl,
  workspaceRepository: WorkspaceRepository,
  observationRepository: ObservationRepository = createObservationRepository(),
): Promise<Awaited<ReturnType<typeof buildApp>>> {
  const dependencies: AppDependencies = {
    config: {
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 3_000,
      LOG_LEVEL: "silent",
      DATABASE_URL: "postgresql://unused",
      JWT_SECRET: "test-secret-at-least-thirty-two-characters",
      AUTH_MODE: "development",
    },
    accessControl,
    workspaceRepository,
    observationRepository,
  };
  const app = await buildApp(dependencies);
  apps.push(app);
  return app;
}

async function issueToken(app: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/dev-token",
    payload: { userIdentityId },
  });
  return (response.json() as { data: { token: string } }).data.token;
}
