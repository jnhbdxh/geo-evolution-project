import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import type { TenantContext } from "@geo-os/contracts";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { Database } from "./database.js";
import { PostgresWorkspaceRepository } from "./workspace-repository.js";

const databaseUrl = requireDatabaseUrl();

const { Client } = pg;
const idSchema = z.object({ id: z.uuid() });
const databases: Database[] = [];
const clients: pg.Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => client.end()));
  await Promise.all(databases.splice(0).map(async (database) => database.close()));
});

describe("Workspace parent-child concurrency", () => {
  it("serializes Customer deactivation against Brand creation", async () => {
    const runId = shortRunId();
    const workspace = await createWorkspace(`customer-brand-${runId}`);
    const customer = idSchema.parse(
      await workspace.repository.createCustomer(
        workspace.context,
        { name: `Customer ${runId}` },
        randomUUID(),
      ),
    );
    const deactivationDatabase = createDatabase(`deactivate_customer_${runId}`);
    const parentLocked = deferred<void>();
    const continueDeactivation = deferred<void>();

    const deactivation = settle(
      deactivationDatabase.withTenantTransaction(workspace.context.tenantId, async (client) => {
        const parent = await client.query(
          `SELECT id FROM customers
            WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE'
            FOR UPDATE`,
          [workspace.context.tenantId, customer.id],
        );
        expect(parent.rowCount).toBe(1);
        const children = await client.query(
          `SELECT 1 FROM brands
            WHERE tenant_id = $1 AND customer_id = $2 AND status = 'ACTIVE'
            LIMIT 1`,
          [workspace.context.tenantId, customer.id],
        );
        expect(children.rowCount).toBe(0);
        parentLocked.resolve();
        await continueDeactivation.promise;
        await client.query(
          `UPDATE customers
              SET status = 'DEACTIVATED',
                  deactivated_at = clock_timestamp(),
                  deactivation_reason = 'concurrency test'
            WHERE tenant_id = $1 AND id = $2`,
          [workspace.context.tenantId, customer.id],
        );
      }),
    );

    try {
      await withTimeout(parentLocked.promise, "Customer lock was not acquired");
    } catch (error) {
      continueDeactivation.resolve();
      await deactivation;
      throw error;
    }
    const creatorApplicationName = `create_brand_${runId}`;
    const creatorDatabase = createDatabase(creatorApplicationName);
    const creator = new PostgresWorkspaceRepository(creatorDatabase);
    const creation = settle(
      creator.createBrand(
        workspace.context,
        { customerId: customer.id, name: `Brand ${runId}` },
        randomUUID(),
      ),
    );

    const lockObserved = await observeLockWait(creatorApplicationName);
    continueDeactivation.resolve();
    const deactivationOutcome = await deactivation;
    const creationOutcome = await creation;

    expect(lockObserved).toBe(true);
    expect(deactivationOutcome).toMatchObject({ status: "fulfilled" });
    expect(creationOutcome).toMatchObject({
      status: "rejected",
      reason: { code: "NOT_FOUND" },
    });
    await expectNoActiveChildUnderDeactivatedParent(
      workspace.database,
      workspace.context.tenantId,
      "Customer",
      customer.id,
    );
  });

  it("serializes Brand deactivation against Project creation", async () => {
    const runId = shortRunId();
    const workspace = await createWorkspace(`brand-project-${runId}`);
    const customer = idSchema.parse(
      await workspace.repository.createCustomer(
        workspace.context,
        { name: `Customer ${runId}` },
        randomUUID(),
      ),
    );
    const brand = idSchema.parse(
      await workspace.repository.createBrand(
        workspace.context,
        { customerId: customer.id, name: `Brand ${runId}` },
        randomUUID(),
      ),
    );
    const creationDatabase = createDatabase(`create_project_${runId}`);
    const parentLocked = deferred<void>();
    const continueCreation = deferred<void>();
    const projectId = randomUUID();

    const creation = settle(
      creationDatabase.withTenantTransaction(workspace.context.tenantId, async (client) => {
        const parent = await client.query(
          `SELECT b.id
             FROM brands b
             JOIN customers c ON c.tenant_id = b.tenant_id AND c.id = b.customer_id
            WHERE b.tenant_id = $1
              AND b.id = $2
              AND b.status = 'ACTIVE'
              AND c.status = 'ACTIVE'
            FOR UPDATE OF b, c`,
          [workspace.context.tenantId, brand.id],
        );
        expect(parent.rowCount).toBe(1);
        parentLocked.resolve();
        await continueCreation.promise;
        await client.query(
          `INSERT INTO projects(id, tenant_id, brand_id, name)
           VALUES ($1, $2, $3, $4)`,
          [projectId, workspace.context.tenantId, brand.id, `Project ${runId}`],
        );
      }),
    );

    try {
      await withTimeout(parentLocked.promise, "Brand and Customer locks were not acquired");
    } catch (error) {
      continueCreation.resolve();
      await creation;
      throw error;
    }
    const deactivatorApplicationName = `deactivate_brand_${runId}`;
    const deactivatorDatabase = createDatabase(deactivatorApplicationName);
    const deactivator = new PostgresWorkspaceRepository(deactivatorDatabase);
    const deactivation = settle(
      deactivator.deactivateBrand(
        workspace.context,
        brand.id,
        { reason: "concurrency test" },
        randomUUID(),
      ),
    );

    const lockObserved = await observeLockWait(deactivatorApplicationName);
    continueCreation.resolve();
    const creationOutcome = await creation;
    const deactivationOutcome = await deactivation;

    expect(lockObserved).toBe(true);
    expect(creationOutcome).toMatchObject({ status: "fulfilled" });
    expect(deactivationOutcome).toMatchObject({
      status: "rejected",
      reason: { code: "CONFLICT" },
    });
    await expectNoActiveChildUnderDeactivatedParent(
      workspace.database,
      workspace.context.tenantId,
      "Brand",
      brand.id,
    );
  });

  it("runs repository deactivateCustomer before repository createBrand without violating the chain", async () => {
    const runId = shortRunId();
    const workspace = await createWorkspace(`real-customer-brand-${runId}`);
    const customer = idSchema.parse(
      await workspace.repository.createCustomer(
        workspace.context,
        { name: `Customer ${runId}` },
        randomUUID(),
      ),
    );
    const blocker = await blockParentRow(
      workspace.context.tenantId,
      "Customer",
      customer.id,
      `block_customer_${runId}`,
    );
    const deactivatorApplicationName = `real_deactivate_customer_${runId}`;
    const deactivator = new PostgresWorkspaceRepository(createDatabase(deactivatorApplicationName));
    const deactivation = settle(
      deactivator.deactivateCustomer(
        workspace.context,
        customer.id,
        { reason: "concurrency test" },
        randomUUID(),
      ),
    );
    expect(await observeLockWait(deactivatorApplicationName)).toBe(true);

    const creatorApplicationName = `real_create_brand_${runId}`;
    const creator = new PostgresWorkspaceRepository(createDatabase(creatorApplicationName));
    const creation = settle(
      creator.createBrand(
        workspace.context,
        { customerId: customer.id, name: `Brand ${runId}` },
        randomUUID(),
      ),
    );
    expect(await observeLockWait(creatorApplicationName)).toBe(true);

    blocker.release();
    expect(await blocker.outcome).toMatchObject({ status: "fulfilled" });
    expect(await deactivation).toMatchObject({ status: "fulfilled" });
    expect(await creation).toMatchObject({
      status: "rejected",
      reason: { code: "NOT_FOUND" },
    });
    await expectNoActiveChildUnderDeactivatedParent(
      workspace.database,
      workspace.context.tenantId,
      "Customer",
      customer.id,
    );
  });

  it("runs repository createProject before repository deactivateBrand without violating the chain", async () => {
    const runId = shortRunId();
    const workspace = await createWorkspace(`real-brand-project-${runId}`);
    const customer = idSchema.parse(
      await workspace.repository.createCustomer(
        workspace.context,
        { name: `Customer ${runId}` },
        randomUUID(),
      ),
    );
    const brand = idSchema.parse(
      await workspace.repository.createBrand(
        workspace.context,
        { customerId: customer.id, name: `Brand ${runId}` },
        randomUUID(),
      ),
    );
    const blocker = await blockParentRow(
      workspace.context.tenantId,
      "Brand",
      brand.id,
      `block_brand_${runId}`,
    );
    const creatorApplicationName = `real_create_project_${runId}`;
    const creator = new PostgresWorkspaceRepository(createDatabase(creatorApplicationName));
    const creation = settle(
      creator.createProject(
        workspace.context,
        { brandId: brand.id, name: `Project ${runId}` },
        randomUUID(),
      ),
    );
    expect(await observeLockWait(creatorApplicationName)).toBe(true);

    const deactivatorApplicationName = `real_deactivate_brand_${runId}`;
    const deactivator = new PostgresWorkspaceRepository(createDatabase(deactivatorApplicationName));
    const deactivation = settle(
      deactivator.deactivateBrand(
        workspace.context,
        brand.id,
        { reason: "concurrency test" },
        randomUUID(),
      ),
    );
    expect(await observeLockWait(deactivatorApplicationName)).toBe(true);

    blocker.release();
    expect(await blocker.outcome).toMatchObject({ status: "fulfilled" });
    expect(await creation).toMatchObject({ status: "fulfilled" });
    expect(await deactivation).toMatchObject({
      status: "rejected",
      reason: { code: "CONFLICT" },
    });
    await expectNoActiveChildUnderDeactivatedParent(
      workspace.database,
      workspace.context.tenantId,
      "Brand",
      brand.id,
    );
  });
});

interface TestWorkspace {
  readonly database: Database;
  readonly repository: PostgresWorkspaceRepository;
  readonly context: TenantContext;
}

async function createWorkspace(label: string): Promise<TestWorkspace> {
  const database = createDatabase(`setup_${shortRunId()}`);
  const repository = new PostgresWorkspaceRepository(database);
  const userIdentityId = randomUUID();
  await database.withPlatformTransaction(async (client) => {
    await client.query(
      `INSERT INTO user_identities(id, issuer, subject, display_name)
       VALUES ($1, 'geo-os-database-test', $2, $3)`,
      [userIdentityId, randomUUID(), `Database Test ${label}`],
    );
  });
  const slug = `test-${label}`;
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
    if (!id) throw new Error("Provisioned test Tenant was not returned");
    return id;
  });
  const membershipId = await database.withTenantTransaction(tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM memberships
        WHERE tenant_id = $1 AND user_identity_id = $2 AND status = 'ACTIVE'`,
      [tenantId, userIdentityId],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Initial admin Membership was not returned");
    return id;
  });
  return {
    database,
    repository,
    context: { tenantId, membershipId, userIdentityId, roles: ["TENANT_ADMIN"] },
  };
}

function createDatabase(applicationName: string): Database {
  const url = new URL(databaseUrl);
  url.searchParams.set("application_name", applicationName);
  const database = new Database(url.toString());
  databases.push(database);
  return database;
}

interface ParentBlocker {
  readonly outcome: ReturnType<typeof settle<void>>;
  readonly release: () => void;
}

async function blockParentRow(
  tenantId: string,
  parentType: "Customer" | "Brand",
  parentId: string,
  applicationName: string,
): Promise<ParentBlocker> {
  const database = createDatabase(applicationName);
  const locked = deferred<void>();
  const release = deferred<void>();
  const outcome = settle(
    database.withTenantTransaction(tenantId, async (client) => {
      const query =
        parentType === "Customer"
          ? `SELECT id FROM customers
              WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE'
              FOR UPDATE`
          : `SELECT id FROM brands
              WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE'
              FOR UPDATE`;
      const result = await client.query(query, [tenantId, parentId]);
      if (result.rowCount !== 1) throw new Error(`Active ${parentType} was not locked`);
      locked.resolve();
      await release.promise;
    }),
  );
  try {
    await withTimeout(locked.promise, `${parentType} blocker did not acquire its lock`);
  } catch (error) {
    release.resolve();
    await outcome;
    throw error;
  }
  return { outcome, release: () => release.resolve() };
}

async function observeLockWait(applicationName: string): Promise<boolean> {
  const observerUrl = new URL(databaseUrl);
  observerUrl.searchParams.set("application_name", `observer_${shortRunId()}`);
  const observer = new Client({ connectionString: observerUrl.toString() });
  clients.push(observer);
  await observer.connect();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await observer.query(
      `SELECT 1
         FROM pg_stat_activity
        WHERE application_name = $1 AND wait_event_type = 'Lock'`,
      [applicationName],
    );
    if (result.rowCount === 1) return true;
    await delay(25);
  }
  return false;
}

async function expectNoActiveChildUnderDeactivatedParent(
  database: Database,
  tenantId: string,
  parentType: "Customer" | "Brand",
  parentId: string,
): Promise<void> {
  const invalid = await database.withTenantTransaction(tenantId, async (client) => {
    const query =
      parentType === "Customer"
        ? `SELECT EXISTS (
             SELECT 1
               FROM customers c
               JOIN brands b ON b.tenant_id = c.tenant_id AND b.customer_id = c.id
              WHERE c.tenant_id = $1 AND c.id = $2
                AND c.status = 'DEACTIVATED' AND b.status = 'ACTIVE'
           ) AS invalid`
        : `SELECT EXISTS (
             SELECT 1
               FROM brands b
               JOIN projects p ON p.tenant_id = b.tenant_id AND p.brand_id = b.id
              WHERE b.tenant_id = $1 AND b.id = $2
                AND b.status = 'DEACTIVATED' AND p.status = 'ACTIVE'
           ) AS invalid`;
    const result = await client.query<{ invalid: boolean }>(query, [tenantId, parentId]);
    return result.rows[0]?.invalid;
  });
  expect(invalid).toBe(false);
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return Promise.race([
    promise,
    delay(5_000).then(() => {
      throw new Error(message);
    }),
  ]);
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
  return randomUUID().replaceAll("-", "").slice(0, 12);
}

function requireDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || process.env.ALLOW_DATABASE_INTEGRATION_TESTS !== "true") {
    throw new Error(
      "Database integration tests require TEST_DATABASE_URL and ALLOW_DATABASE_INTEGRATION_TESTS=true",
    );
  }
  const databaseName = decodeURIComponent(new URL(url).pathname.slice(1));
  if (databaseName !== "geo_os_test") {
    throw new Error(
      `Database integration tests only run against geo_os_test; received ${databaseName || "no database name"}`,
    );
  }
  return url;
}
