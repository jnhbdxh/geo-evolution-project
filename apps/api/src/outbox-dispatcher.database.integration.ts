import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Database } from "./database.js";
import { OutboxDispatcher, type OutboxDelivery } from "./outbox-dispatcher.js";
import { PostgresOutboxStore } from "./outbox-repository.js";

const databaseUrl = requireTestDatabaseUrl("TEST_DATABASE_URL");
const migrationUrl = requireTestDatabaseUrl("TEST_DATABASE_MIGRATION_URL");
const { Client } = pg;
const databases: Database[] = [];
const clients: pg.Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => client.end()));
  await Promise.all(databases.splice(0).map(async (database) => database.close()));
});

describe("Persistent Outbox dispatcher PostgreSQL contract", () => {
  it("does not let Dispatcher context create a cross-Tenant Outbox fact", async () => {
    const database = createDatabase("outbox_dispatcher_insert_denied");

    await expect(
      database.withOutboxDispatcherTransaction(async (client) =>
        client.query(
          `INSERT INTO outbox_events(
             tenant_id, aggregate_type, aggregate_id, event_type, payload, trace_id
           ) VALUES ($1, 'ExecutionRun', $2, 'ExecutionQueued', '{}'::jsonb, $3)`,
          [randomUUID(), randomUUID(), randomUUID()],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("uses the dedicated context to publish a Tenant event and persist delivery state", async () => {
    const clock = new Date("2000-01-01T00:00:01.000Z");
    const event = await insertPendingEvent(new Date("2000-01-01T00:00:00.000Z"));
    const database = createDatabase("outbox_single_delivery");
    const invisibleWithoutDispatcherContext = await database.withPlatformRead(async (client) => {
      const result = await client.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM outbox_events WHERE id = $1",
        [event.id],
      );
      return result.rows[0]?.count;
    });
    const publish = vi
      .fn<(delivery: OutboxDelivery) => Promise<void>>()
      .mockResolvedValue(undefined);
    const dispatcher = new OutboxDispatcher(
      new PostgresOutboxStore(database),
      { publish },
      {
        clock: () => clock,
      },
    );

    expect(invisibleWithoutDispatcherContext).toBe(0);
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
      published_at: clock,
    });
  });

  it("uses SKIP LOCKED so concurrent dispatchers cannot publish the same locked event", async () => {
    const clock = new Date("2000-01-02T00:00:01.000Z");
    const event = await insertPendingEvent(new Date("2000-01-02T00:00:00.000Z"));
    const firstDatabase = createDatabase("outbox_concurrent_first");
    const secondDatabase = createDatabase("outbox_concurrent_second");
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
    const first = new OutboxDispatcher(
      new PostgresOutboxStore(firstDatabase),
      { publish },
      {
        clock: () => clock,
      },
    );
    const second = new OutboxDispatcher(
      new PostgresOutboxStore(secondDatabase),
      { publish },
      {
        clock: () => clock,
      },
    );

    const firstResult = first.dispatchNext();
    await firstPublishStarted;
    await expect(second.dispatchNext()).resolves.toEqual({ kind: "idle" });
    releaseFirstPublish?.();
    await expect(firstResult).resolves.toMatchObject({ kind: "published", eventId: event.id });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("persists retry attempts and the next availability after queue failure", async () => {
    const clock = new Date("2000-01-03T00:00:01.000Z");
    const event = await insertPendingEvent(new Date("2000-01-03T00:00:00.000Z"));
    const database = createDatabase("outbox_retry");
    const dispatcher = new OutboxDispatcher(
      new PostgresOutboxStore(database),
      { publish: vi.fn().mockRejectedValue(new Error("Redis unavailable")) },
      { clock: () => clock, baseRetryDelayMs: 2_000 },
    );

    await expect(dispatcher.dispatchNext()).resolves.toEqual({
      kind: "retry_scheduled",
      eventId: event.id,
      attempts: 1,
      availableAt: new Date("2000-01-03T00:00:03.000Z"),
    });
    await expect(readDeliveryState(event.id)).resolves.toMatchObject({
      status: "PENDING",
      attempts: 1,
      available_at: new Date("2000-01-03T00:00:03.000Z"),
      published_at: null,
    });
  });
});

interface InsertedEvent {
  readonly id: string;
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
  return { id };
}

async function readDeliveryState(eventId: string): Promise<{
  readonly status: string;
  readonly attempts: number;
  readonly available_at: Date;
  readonly published_at: Date | null;
}> {
  const client = await migrationClient("outbox_state");
  const result = await client.query<{
    status: string;
    attempts: number;
    available_at: Date;
    published_at: Date | null;
  }>("SELECT status, attempts, available_at, published_at FROM outbox_events WHERE id = $1", [
    eventId,
  ]);
  const row = result.rows[0];
  if (!row) throw new Error(`Outbox event ${eventId} was not found`);
  return row;
}

function createDatabase(applicationName: string): Database {
  const url = new URL(databaseUrl);
  url.searchParams.set("application_name", applicationName);
  const database = new Database(url.toString());
  databases.push(database);
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
