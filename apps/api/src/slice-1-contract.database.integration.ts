import { randomUUID } from "node:crypto";

import type { TenantContext } from "@geo-os/contracts";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { PostgresAccessControl } from "./access.js";
import { buildApp } from "./app.js";
import { Database } from "./database.js";
import { PostgresObservationRepository } from "./observation-repository.js";
import { PostgresWorkspaceRepository } from "./workspace-repository.js";

const databaseUrl = requireTestDatabaseUrl("TEST_DATABASE_URL");
const migrationUrl = requireTestDatabaseUrl("TEST_DATABASE_MIGRATION_URL");
const { Client } = pg;
const idSchema = z.object({ id: z.uuid() });
const databases: Database[] = [];
const clients: pg.Client[] = [];
const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
  await Promise.all(clients.splice(0).map(async (client) => client.end()));
  await Promise.all(databases.splice(0).map(async (database) => database.close()));
});

describe("Slice 1 live PostgreSQL contract", () => {
  it("S0-CT-001 keeps the physical schema at zero foreign keys", async () => {
    const count = await withMigrationClient(async (client) => {
      const result = await client.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM pg_constraint
          WHERE contype = 'f'`,
      );
      return result.rows[0]?.count;
    });
    expect(count).toBe(0);
  });

  it("S1-CT-001 denies Tenant A identity requesting Tenant B context", async () => {
    const tenantA = await createWorkspace("tenant-a");
    const tenantB = await createWorkspace("tenant-b");
    const app = await createDatabaseApp(tenantA.database);
    const token = await issueToken(app, tenantA.context.userIdentityId);

    const response = await app.inject({
      method: "GET",
      url: "/v1/context",
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": tenantB.context.tenantId },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("S1-CT-002 rejects a Brand referencing another Tenant's Customer", async () => {
    const tenantA = await createWorkspace("brand-owner");
    const tenantB = await createWorkspace("customer-owner");
    const customerB = await createCustomer(tenantB, "Customer B");

    const outcome = await settle(
      tenantA.repository.createBrand(
        tenantA.context,
        { customerId: customerB.id, name: "Cross-tenant Brand" },
        randomUUID(),
      ),
    );

    expect(outcome).toMatchObject({ status: "rejected", reason: { code: "NOT_FOUND" } });
  });

  it("S1-CT-003 rejects customer_id in Project API input", async () => {
    const workspace = await createWorkspace("project-input");
    const app = await createDatabaseApp(workspace.database);
    const token = await issueToken(app, workspace.context.userIdentityId);

    const response = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": workspace.context.tenantId },
      payload: {
        brandId: randomUUID(),
        customerId: randomUUID(),
        name: "Invalid Project",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(await countRows(workspace, "projects")).toBe(0);
  });

  it("S1-CT-004 rejects a Project using another Tenant's Brand", async () => {
    const tenantA = await createWorkspace("project-owner");
    const tenantB = await createWorkspace("brand-owner");
    const customerB = await createCustomer(tenantB, "Customer B");
    const brandB = idSchema.parse(
      await tenantB.repository.createBrand(
        tenantB.context,
        { customerId: customerB.id, name: "Brand B" },
        randomUUID(),
      ),
    );

    const outcome = await settle(
      tenantA.repository.createProject(
        tenantA.context,
        { brandId: brandB.id, name: "Cross-tenant Project" },
        randomUUID(),
      ),
    );

    expect(outcome).toMatchObject({ status: "rejected", reason: { code: "NOT_FOUND" } });
    expect(await countRows(tenantA, "projects")).toBe(0);
  });

  it("S1-CT-005 rejects creating children under deactivated parents", async () => {
    const workspace = await createWorkspace("deactivated-parents");
    const customer = await createCustomer(workspace, "Inactive Customer");
    await workspace.repository.deactivateCustomer(
      workspace.context,
      customer.id,
      { reason: "test" },
      randomUUID(),
    );
    const brandUnderCustomer = await settle(
      workspace.repository.createBrand(
        workspace.context,
        { customerId: customer.id, name: "Rejected Brand" },
        randomUUID(),
      ),
    );

    const activeCustomer = await createCustomer(workspace, "Active Customer");
    const brand = idSchema.parse(
      await workspace.repository.createBrand(
        workspace.context,
        { customerId: activeCustomer.id, name: "Inactive Brand" },
        randomUUID(),
      ),
    );
    await workspace.repository.deactivateBrand(
      workspace.context,
      brand.id,
      { reason: "test" },
      randomUUID(),
    );
    const projectUnderBrand = await settle(
      workspace.repository.createProject(
        workspace.context,
        { brandId: brand.id, name: "Rejected Project" },
        randomUUID(),
      ),
    );

    expect(brandUnderCustomer).toMatchObject({
      status: "rejected",
      reason: { code: "NOT_FOUND" },
    });
    expect(projectUnderBrand).toMatchObject({
      status: "rejected",
      reason: { code: "NOT_FOUND" },
    });
  });

  it("S1-CT-006 exposes no hard-delete API and restricts referenced deletion", async () => {
    const workspace = await createWorkspace("delete-restriction");
    const customer = await createCustomer(workspace, "Customer");
    const brand = idSchema.parse(
      await workspace.repository.createBrand(
        workspace.context,
        { customerId: customer.id, name: "Brand" },
        randomUUID(),
      ),
    );
    await workspace.repository.createProject(
      workspace.context,
      { brandId: brand.id, name: "Project" },
      randomUUID(),
    );
    const app = await createDatabaseApp(workspace.database);
    const token = await issueToken(app, workspace.context.userIdentityId);

    const response = await app.inject({
      method: "DELETE",
      url: `/v1/brands/${brand.id}`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": workspace.context.tenantId },
    });
    const deletion = await settle(
      workspace.database.withTenantTransaction(workspace.context.tenantId, async (client) => {
        await client.query("DELETE FROM brands WHERE id = $1", [brand.id]);
      }),
    );

    expect(response.statusCode).toBe(404);
    expect(deletion).toMatchObject({ status: "rejected", reason: { code: "42501" } });
  });

  it("S1-CT-007 creates a Project without an Industry Binding", async () => {
    const workspace = await createWorkspace("optional-industry");
    const customer = await createCustomer(workspace, "Customer");
    const brand = idSchema.parse(
      await workspace.repository.createBrand(
        workspace.context,
        { customerId: customer.id, name: "Brand" },
        randomUUID(),
      ),
    );
    const project = idSchema.parse(
      await workspace.repository.createProject(
        workspace.context,
        { brandId: brand.id, name: "Project" },
        randomUUID(),
      ),
    );

    const industryBindings = await workspace.database.withTenantTransaction(
      workspace.context.tenantId,
      async (client) =>
        client.query(
          `SELECT id FROM project_industry_bindings
            WHERE tenant_id = $1 AND project_id = $2 AND effective_to IS NULL`,
          [workspace.context.tenantId, project.id],
        ),
    );
    expect(industryBindings.rowCount).toBe(0);
  });

  it("S1-CT-008 rolls back Project creation when the system PolicyRelease is unavailable", async () => {
    const workspace = await createWorkspace("missing-system-release");
    const customer = await createCustomer(workspace, "Customer");
    const brand = idSchema.parse(
      await workspace.repository.createBrand(
        workspace.context,
        { customerId: customer.id, name: "Brand" },
        randomUUID(),
      ),
    );
    const hiddenCode = `GEO_OS_SYSTEM_BASE_HIDDEN_${shortRunId()}`;
    await withMigrationClient(async (client) => {
      await client.query("UPDATE policy_definitions SET code = $1 WHERE code = $2", [
        hiddenCode,
        "GEO_OS_SYSTEM_BASE",
      ]);
    });

    try {
      const outcome = await settle(
        workspace.repository.createProject(
          workspace.context,
          { brandId: brand.id, name: "Rolled-back Project" },
          randomUUID(),
        ),
      );
      expect(outcome).toMatchObject({ status: "rejected", reason: { code: "CONFLICT" } });
      expect(await countRows(workspace, "projects")).toBe(0);
    } finally {
      await withMigrationClient(async (client) => {
        await client.query("UPDATE policy_definitions SET code = $1 WHERE code = $2", [
          "GEO_OS_SYSTEM_BASE",
          hiddenCode,
        ]);
      });
    }
  });

  it("S1-CT-009 rejects two current Bindings for the same Project and PolicyDefinition", async () => {
    const { workspace, projectId } = await createProjectWorkspace("unique-binding");

    const outcome = await settle(
      workspace.database.withTenantTransaction(workspace.context.tenantId, async (client) => {
        const current = await client.query<{
          policy_definition_id: string;
          policy_release_id: string;
        }>(
          `SELECT policy_definition_id, policy_release_id
             FROM project_policy_bindings
            WHERE tenant_id = $1 AND project_id = $2 AND effective_to IS NULL`,
          [workspace.context.tenantId, projectId],
        );
        const binding = current.rows[0];
        if (!binding) throw new Error("Initial Policy Binding not found");
        await client.query(
          `INSERT INTO project_policy_bindings(
             tenant_id, project_id, policy_definition_id, policy_release_id,
             reason, created_by_user_identity_id
           ) VALUES ($1, $2, $3, $4, 'duplicate test', $5)`,
          [
            workspace.context.tenantId,
            projectId,
            binding.policy_definition_id,
            binding.policy_release_id,
            workspace.context.userIdentityId,
          ],
        );
      }),
    );

    expect(outcome).toMatchObject({ status: "rejected", reason: { code: "23505" } });
  });

  it("S1-CT-010 closes the previous Binding and retains history", async () => {
    const { workspace, projectId } = await createProjectWorkspace("binding-history");
    const policyReleaseId = randomUUID();
    const version = `test-${shortRunId()}`;
    const manifest = JSON.stringify({ contract: "slice-1", test: version });
    await withMigrationClient(async (client) => {
      await client.query(
        `INSERT INTO policy_releases(
           id, policy_definition_id, version, status, manifest, manifest_sha256, published_at
         ) VALUES (
           $1, '00000000-0000-4000-8000-000000000001', $2, 'PUBLISHED', $3::jsonb,
           encode(digest($3::text, 'sha256'), 'hex'), clock_timestamp()
         )`,
        [policyReleaseId, version, manifest],
      );
    });

    await workspace.repository.replacePolicyBinding(
      workspace.context,
      projectId,
      { policyReleaseId, reason: "history test" },
      randomUUID(),
    );
    const bindings = await workspace.database.withTenantTransaction(
      workspace.context.tenantId,
      async (client) =>
        client.query<{ policy_release_id: string; effective_to: Date | null }>(
          `SELECT policy_release_id, effective_to
             FROM project_policy_bindings
            WHERE tenant_id = $1 AND project_id = $2
            ORDER BY effective_from`,
          [workspace.context.tenantId, projectId],
        ),
    );

    expect(bindings.rows).toHaveLength(2);
    expect(bindings.rows[0]?.effective_to).not.toBeNull();
    expect(bindings.rows[1]).toMatchObject({
      policy_release_id: policyReleaseId,
      effective_to: null,
    });
  });

  it("S1-CT-011 rolls back the domain write when Outbox insertion fails", async () => {
    const workspace = await createWorkspace("outbox-rollback");
    const traceId = randomUUID();
    await installOutboxFailureTrigger(traceId);

    try {
      const outcome = await settle(
        workspace.repository.createCustomer(
          workspace.context,
          { name: "Rolled-back Customer" },
          traceId,
        ),
      );
      expect(outcome).toMatchObject({ status: "rejected", reason: { code: "P0001" } });
      expect(await countRows(workspace, "customers")).toBe(0);
    } finally {
      await removeOutboxFailureTrigger();
    }
  });

  it("S1-CT-012 denies an inactive Membership even with an unexpired JWT", async () => {
    const workspace = await createWorkspace("inactive-membership");
    const app = await createDatabaseApp(workspace.database);
    const token = await issueToken(app, workspace.context.userIdentityId);
    await workspace.database.withTenantTransaction(workspace.context.tenantId, async (client) => {
      await client.query(
        `UPDATE memberships
            SET status = 'DEACTIVATED',
                deactivated_at = clock_timestamp(),
                deactivation_reason = 'contract test'
          WHERE tenant_id = $1 AND id = $2`,
        [workspace.context.tenantId, workspace.context.membershipId],
      );
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/context",
      headers: {
        authorization: `Bearer ${token}`,
        "x-tenant-id": workspace.context.tenantId,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });
});

interface TestWorkspace {
  readonly database: Database;
  readonly repository: PostgresWorkspaceRepository;
  readonly context: TenantContext;
}

async function createWorkspace(label: string): Promise<TestWorkspace> {
  const database = createDatabase(`contract_${shortRunId()}`);
  const repository = new PostgresWorkspaceRepository(database);
  const userIdentityId = randomUUID();
  await database.withPlatformTransaction(async (client) => {
    await client.query(
      `INSERT INTO user_identities(id, issuer, subject, display_name)
       VALUES ($1, 'geo-os-contract-test', $2, $3)`,
      [userIdentityId, randomUUID(), `Contract Test ${label}`],
    );
  });
  const slug = `test-${label}-${shortRunId()}`;
  await repository.provisionTenant(
    { slug, name: `Tenant ${label}`, initialAdminUserIdentityId: userIdentityId },
    userIdentityId,
    randomUUID(),
  );
  const tenantId = await database.withPlatformTransaction(async (client) => {
    const result = await client.query<{ id: string }>("SELECT id FROM tenants WHERE slug = $1", [
      slug,
    ]);
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Provisioned Tenant was not returned");
    return id;
  });
  const membershipId = await database.withTenantTransaction(tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      "SELECT id FROM memberships WHERE tenant_id = $1 AND user_identity_id = $2",
      [tenantId, userIdentityId],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Initial Membership was not returned");
    return id;
  });
  return {
    database,
    repository,
    context: { tenantId, membershipId, userIdentityId, roles: ["TENANT_ADMIN"] },
  };
}

async function createProjectWorkspace(
  label: string,
): Promise<{ workspace: TestWorkspace; projectId: string }> {
  const workspace = await createWorkspace(label);
  const customer = await createCustomer(workspace, "Customer");
  const brand = idSchema.parse(
    await workspace.repository.createBrand(
      workspace.context,
      { customerId: customer.id, name: "Brand" },
      randomUUID(),
    ),
  );
  const project = idSchema.parse(
    await workspace.repository.createProject(
      workspace.context,
      { brandId: brand.id, name: "Project" },
      randomUUID(),
    ),
  );
  return { workspace, projectId: project.id };
}

async function createCustomer(
  workspace: TestWorkspace,
  name: string,
): Promise<{ readonly id: string }> {
  return idSchema.parse(
    await workspace.repository.createCustomer(workspace.context, { name }, randomUUID()),
  );
}

function createDatabase(applicationName: string): Database {
  const url = new URL(databaseUrl);
  url.searchParams.set("application_name", applicationName);
  const database = new Database(url.toString());
  databases.push(database);
  return database;
}

async function createDatabaseApp(
  database: Database,
): Promise<Awaited<ReturnType<typeof buildApp>>> {
  const app = await buildApp({
    config: {
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 3_000,
      LOG_LEVEL: "silent",
      DATABASE_URL: databaseUrl,
      JWT_SECRET: "test-secret-at-least-thirty-two-characters",
      AUTH_MODE: "development",
    },
    accessControl: new PostgresAccessControl(database),
    workspaceRepository: new PostgresWorkspaceRepository(database),
    observationRepository: new PostgresObservationRepository(database),
  });
  apps.push(app);
  return app;
}

async function issueToken(
  app: Awaited<ReturnType<typeof buildApp>>,
  userIdentityId: string,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/dev-token",
    payload: { userIdentityId },
  });
  return z.object({ data: z.object({ token: z.string() }) }).parse(response.json()).data.token;
}

async function countRows(
  workspace: TestWorkspace,
  tableName: "customers" | "projects",
): Promise<number> {
  return workspace.database.withTenantTransaction(workspace.context.tenantId, async (client) => {
    const query =
      tableName === "customers"
        ? "SELECT count(*)::integer AS count FROM customers WHERE tenant_id = $1"
        : "SELECT count(*)::integer AS count FROM projects WHERE tenant_id = $1";
    const result = await client.query<{ count: number }>(query, [workspace.context.tenantId]);
    return result.rows[0]?.count ?? -1;
  });
}

async function withMigrationClient<T>(operation: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = new URL(migrationUrl);
  url.searchParams.set("application_name", `contract_admin_${shortRunId()}`);
  const client = new Client({ connectionString: url.toString() });
  clients.push(client);
  await client.connect();
  return operation(client);
}

async function installOutboxFailureTrigger(traceId: string): Promise<void> {
  await withMigrationClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS test_outbox_failures(trace_id uuid PRIMARY KEY);
      CREATE OR REPLACE FUNCTION fail_selected_test_outbox()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM test_outbox_failures WHERE trace_id = NEW.trace_id) THEN
          RAISE EXCEPTION 'selected test outbox failure';
        END IF;
        RETURN NEW;
      END
      $$;
      DROP TRIGGER IF EXISTS fail_selected_test_outbox_trigger ON outbox_events;
      CREATE TRIGGER fail_selected_test_outbox_trigger
        BEFORE INSERT ON outbox_events
        FOR EACH ROW EXECUTE FUNCTION fail_selected_test_outbox();
    `);
    await client.query("INSERT INTO test_outbox_failures(trace_id) VALUES ($1)", [traceId]);
  });
}

async function removeOutboxFailureTrigger(): Promise<void> {
  await withMigrationClient(async (client) => {
    await client.query(`
      DROP TRIGGER IF EXISTS fail_selected_test_outbox_trigger ON outbox_events;
      DROP FUNCTION IF EXISTS fail_selected_test_outbox();
      DROP TABLE IF EXISTS test_outbox_failures;
    `);
  });
}

function requireTestDatabaseUrl(variableName: string): string {
  const url = process.env[variableName];
  if (!url || process.env.ALLOW_DATABASE_INTEGRATION_TESTS !== "true") {
    throw new Error(
      `Database integration tests require ${variableName} and ALLOW_DATABASE_INTEGRATION_TESTS=true`,
    );
  }
  const databaseName = decodeURIComponent(new URL(url).pathname.slice(1));
  if (databaseName !== "geo_os_test") {
    throw new Error(`${variableName} must target geo_os_test; received ${databaseName}`);
  }
  return url;
}

function settle<T>(
  promise: Promise<T>,
): Promise<
  | { readonly status: "fulfilled"; readonly value: T }
  | { readonly status: "rejected"; readonly reason: unknown }
> {
  return promise.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
}

function shortRunId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 10);
}
