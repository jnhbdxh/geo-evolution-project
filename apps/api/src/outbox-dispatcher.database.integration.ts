import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Database } from "./database.js";
import { OutboxDatabase } from "./outbox-database.js";
import { OutboxDispatcher, type OutboxDelivery } from "./outbox-dispatcher.js";
import { PostgresOutboxStore } from "./outbox-repository.js";

const applicationDatabaseUrl = requireTestDatabaseUrl("TEST_DATABASE_URL");
const outboxDatabaseUrl = requireTestDatabaseUrl("TEST_OUTBOX_DATABASE_URL");
const migrationUrl = requireTestDatabaseUrl("TEST_DATABASE_MIGRATION_URL");
const { Client } = pg;
const applicationDatabases: Database[] = [];
const outboxDatabases: OutboxDatabase[] = [];
const clients: pg.Client[] = [];

afterEach(async () => {
  const cleanupClient = clients[0];
  if (cleanupClient) {
    await cleanupClient.query(
      "UPDATE outbox_events SET status = 'FAILED' WHERE status = 'PENDING'",
    );
  }
  await Promise.all(clients.splice(0).map(async (client) => client.end()));
  await Promise.all(applicationDatabases.splice(0).map(async (database) => database.close()));
  await Promise.all(outboxDatabases.splice(0).map(async (database) => database.close()));
});

describe("Persistent Outbox dispatcher PostgreSQL contract", () => {
  it("does not let the dedicated Dispatcher role create an Outbox fact", async () => {
    const database = createOutboxDatabase("outbox_dispatcher_insert_denied");

    await expect(
      database.withTransaction(async (client) =>
        client.query(
          `INSERT INTO outbox_events(
             tenant_id, aggregate_type, aggregate_id, event_type, payload, trace_id
           ) VALUES ($1, 'ExecutionRun', $2, 'ExecutionQueued', '{}'::jsonb, $3)`,
          [randomUUID(), randomUUID(), randomUUID()],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("does not let the dedicated Dispatcher role delete an Outbox fact", async () => {
    const event = await insertPendingEvent(new Date("2000-01-01T00:00:00.000Z"));
    const database = createOutboxDatabase("outbox_dispatcher_delete_denied");

    await expect(
      database.withTransaction(async (client) =>
        client.query("DELETE FROM outbox_events WHERE id = $1", [event.id]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("denies the Dispatcher role access to non-Outbox business tables", async () => {
    const database = createOutboxDatabase("outbox_dispatcher_business_read_denied");

    await expect(
      database.withTransaction(async (client) => client.query("SELECT id FROM tenants LIMIT 1")),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("binds cross-Tenant delivery to the dedicated role, not a caller-set GUC", async () => {
    const event = await insertPendingEvent(new Date("2000-01-01T00:00:00.000Z"));
    const applicationDatabase = createApplicationDatabase("outbox_app_guc_denied");
    const invisibleWithCallerSetDispatcherContext = await applicationDatabase.withPlatformRead(
      async (client) => {
        await client.query("SELECT set_config('app.outbox_dispatcher_context', 'true', true)");
        const result = await client.query<{ count: number }>(
          "SELECT count(*)::integer AS count FROM outbox_events WHERE id = $1",
          [event.id],
        );
        return result.rows[0]?.count;
      },
    );
    const database = createOutboxDatabase("outbox_single_delivery");
    const visibleToDedicatedRole = await database.withTransaction(async (client) => {
      const result = await client.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM outbox_events WHERE id = $1",
        [event.id],
      );
      return result.rows[0]?.count;
    });
    const publish = vi
      .fn<(delivery: OutboxDelivery) => Promise<void>>()
      .mockResolvedValue(undefined);
    const dispatcher = new OutboxDispatcher(new PostgresOutboxStore(database), { publish });

    expect(invisibleWithCallerSetDispatcherContext).toBe(0);
    expect(visibleToDedicatedRole).toBe(1);
    await expect(dispatcher.dispatchNext()).resolves.toEqual({
      kind: "published",
      eventId: event.id,
      attempts: 1,
    });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        deduplicationKey: event.id,
        eventType: "ExecutionQueued",
      }),
    );
    await expect(readDeliveryState(event.id)).resolves.toMatchObject({
      status: "PUBLISHED",
      attempts: 1,
    });
    const state = await readDeliveryState(event.id);
    expect(state.published_at).toBeInstanceOf(Date);
  });

  it("denies the application role updates to Dispatcher-owned delivery state", async () => {
    const event = await insertPendingEvent(new Date("2000-01-01T00:00:00.000Z"));
    const database = createApplicationDatabase("outbox_app_delivery_update_denied");

    await expect(
      database.withTenantTransaction(event.tenantId, async (client) =>
        client.query("UPDATE outbox_events SET attempts = attempts + 1 WHERE id = $1", [event.id]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("uses SKIP LOCKED so concurrent dispatchers cannot publish the same locked event", async () => {
    const event = await insertPendingEvent(new Date("2000-01-02T00:00:00.000Z"));
    const firstDatabase = createOutboxDatabase("outbox_concurrent_first");
    const secondDatabase = createOutboxDatabase("outbox_concurrent_second");
    let releaseFirstPublish: (() => void) | undefined;
    let signalFirstPublish: (() => void) | undefined;
    const firstPublishStarted = new Promise<void>((resolve) => {
      signalFirstPublish = resolve;
    });
    const firstPublishMayFinish = new Promise<void>((resolve) => {
      releaseFirstPublish = resolve;
    });
    const publish = vi.fn(async () => {
      signalFirstPublish?.();
      await firstPublishMayFinish;
    });
    const first = new OutboxDispatcher(new PostgresOutboxStore(firstDatabase), { publish });
    const second = new OutboxDispatcher(new PostgresOutboxStore(secondDatabase), { publish });

    const firstResult = first.dispatchNext();
    await firstPublishStarted;
    await expect(second.dispatchNext()).resolves.toEqual({ kind: "idle" });
    releaseFirstPublish?.();
    await expect(firstResult).resolves.toMatchObject({ kind: "published", eventId: event.id });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("persists retry attempts and the next availability after queue failure", async () => {
    const event = await insertPendingEvent(new Date("2000-01-03T00:00:00.000Z"));
    const database = createOutboxDatabase("outbox_retry");
    const dispatcher = new OutboxDispatcher(
      new PostgresOutboxStore(database),
      { publish: vi.fn().mockRejectedValue(new Error("Redis unavailable")) },
      { baseRetryDelayMs: 2_000 },
    );

    await expect(dispatcher.dispatchNext()).resolves.toMatchObject({
      kind: "retry_scheduled",
      eventId: event.id,
      attempts: 1,
    });
    const state = await readDeliveryState(event.id);
    expect(state).toMatchObject({
      status: "PENDING",
      attempts: 1,
      published_at: null,
      last_error_category: "PUBLISHER",
      last_error_code: "OUTBOX_PUBLISH_FAILED",
      last_error_message: "Outbox publisher rejected delivery",
    });
    expect(state.last_failed_at).toBeInstanceOf(Date);
    expect(state.available_at.getTime() - state.last_failed_at!.getTime()).toBe(2_000);
  });

  it("starts retry backoff after a long publish timeout and releases the original lock", async () => {
    const event = await insertPendingEvent(new Date("2000-01-04T00:00:00.000Z"));
    const firstDatabase = createOutboxDatabase("outbox_timeout_first", {
      idleInTransactionTimeoutMs: 1_000,
    });
    const secondDatabase = createOutboxDatabase("outbox_timeout_second");
    const first = new OutboxDispatcher(
      new PostgresOutboxStore(firstDatabase),
      { publish: vi.fn(() => new Promise<void>(() => undefined)) },
      { publishTimeoutMs: 350, baseRetryDelayMs: 250 },
    );
    const secondPublish = vi.fn<(delivery: OutboxDelivery) => Promise<void>>().mockResolvedValue();
    const second = new OutboxDispatcher(new PostgresOutboxStore(secondDatabase), {
      publish: secondPublish,
    });

    await expect(first.dispatchNext()).resolves.toMatchObject({
      kind: "retry_scheduled",
      eventId: event.id,
    });
    const retryState = await readDeliveryState(event.id);
    expect(retryState.last_failed_at).toBeInstanceOf(Date);
    expect(retryState.available_at.getTime() - retryState.last_failed_at!.getTime()).toBe(250);
    await expect(second.dispatchNext()).resolves.toEqual({ kind: "idle" });
    expect(secondPublish).not.toHaveBeenCalled();

    await waitUntil(retryState.available_at);
    await expect(second.dispatchNext()).resolves.toMatchObject({
      kind: "published",
      eventId: event.id,
    });
    expect(secondPublish).toHaveBeenCalledTimes(1);
  });
});

interface InsertedEvent {
  readonly id: string;
  readonly tenantId: string;
}

async function insertPendingEvent(occurredAt: Date): Promise<InsertedEvent> {
  const id = randomUUID();
  const tenantId = randomUUID();
  const aggregateId = randomUUID();
  const traceId = randomUUID();
  const client = await migrationClient("outbox_fixture");
  await client.query(
    `INSERT INTO outbox_events(
       id, tenant_id, aggregate_type, aggregate_id, event_type, schema_version,
       payload, headers, trace_id, available_at, occurred_at
     ) VALUES ($1, $2, 'ExecutionRun', $3, 'ExecutionQueued', 1, $4::jsonb, '{}'::jsonb, $5, $6, $6)`,
    [
      id,
      tenantId,
      aggregateId,
      JSON.stringify({
        event_id: id,
        event_type: "ExecutionQueued",
        tenant_id: tenantId,
        aggregate_type: "ExecutionRun",
        aggregate_id: aggregateId,
        schema_version: 1,
        occurred_at: occurredAt.toISOString(),
        trace_id: traceId,
        data: { execution_run_id: aggregateId },
      }),
      traceId,
      occurredAt,
    ],
  );
  return { id, tenantId };
}

async function waitUntil(instant: Date): Promise<void> {
  const remainingMs = instant.getTime() - Date.now();
  if (remainingMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, remainingMs + 25));
  }
}

async function readDeliveryState(eventId: string): Promise<{
  readonly status: string;
  readonly attempts: number;
  readonly available_at: Date;
  readonly published_at: Date | null;
  readonly last_error_category: string | null;
  readonly last_error_code: string | null;
  readonly last_error_message: string | null;
  readonly last_failed_at: Date | null;
}> {
  const client = await migrationClient("outbox_state");
  const result = await client.query<{
    status: string;
    attempts: number;
    available_at: Date;
    published_at: Date | null;
    last_error_category: string | null;
    last_error_code: string | null;
    last_error_message: string | null;
    last_failed_at: Date | null;
  }>(
    `SELECT status, attempts, available_at, published_at,
            last_error_category, last_error_code, last_error_message, last_failed_at
       FROM outbox_events
      WHERE id = $1`,
    [eventId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Outbox event ${eventId} was not found`);
  return row;
}

function createApplicationDatabase(applicationName: string): Database {
  const url = new URL(applicationDatabaseUrl);
  url.searchParams.set("application_name", applicationName);
  const database = new Database(url.toString());
  applicationDatabases.push(database);
  return database;
}

function createOutboxDatabase(
  applicationName: string,
  options: { readonly idleInTransactionTimeoutMs?: number } = {},
): OutboxDatabase {
  const url = new URL(outboxDatabaseUrl);
  url.searchParams.set("application_name", applicationName);
  const database = new OutboxDatabase(url.toString(), options);
  outboxDatabases.push(database);
  return database;
}

async function migrationClient(applicationName: string): Promise<pg.Client> {
  const url = new URL(migrationUrl);
  url.searchParams.set("application_name", applicationName);
  const client = new Client({ connectionString: url.toString() });
  clients.push(client);
  await client.connect();
  return client;
}

function requireTestDatabaseUrl(variableName: string): string {
  const value = process.env[variableName];
  if (!value || process.env.ALLOW_DATABASE_INTEGRATION_TESTS !== "true") {
    throw new Error(
      `Database integration tests require ${variableName} and ALLOW_DATABASE_INTEGRATION_TESTS=true`,
    );
  }
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (databaseName !== "geo_os_test") {
    throw new Error(`${variableName} must target geo_os_test; received ${databaseName}`);
  }
  return value;
}
