import { randomUUID } from "node:crypto";
import { once } from "node:events";
import net from "node:net";

import { Queue } from "bullmq";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";

import {
  createBullMqOutboxPublisher,
  createRoutedBullMqOutboxPublisher,
  type OutboxQueueJobData,
} from "./bullmq-outbox-publisher.js";
import { OutboxDatabase } from "./outbox-database.js";
import { OutboxDispatcher } from "./outbox-dispatcher.js";
import { PostgresOutboxStore } from "./outbox-repository.js";

const { Client } = pg;
const outboxDatabaseUrl = requireTestDatabaseUrl("TEST_OUTBOX_DATABASE_URL");
const migrationUrl = requireTestDatabaseUrl("TEST_DATABASE_MIGRATION_URL");
const redisUrl = requireTestRedisUrl();
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) {
    await close();
  }
});

describe("Outbox to BullMQ", () => {
  it("isolates ExecutionQueued jobs from the general domain-event queue", async () => {
    const domainQueueName = `geo-os-domain-${randomUUID()}`;
    const executionQueueName = `geo-os-execution-${randomUUID()}`;
    const publisher = createRoutedBullMqOutboxPublisher({
      redisUrl,
      domainQueueName,
      executionQueueName,
      commandTimeoutMs: 1_000,
    });
    closers.push(async () => publisher.close());
    await publisher.initialize(2_000);
    const domainReader = createQueueReader(domainQueueName);
    const executionReader = createQueueReader(executionQueueName);
    const execution = createDelivery("ExecutionQueued", "ExecutionRun");
    const project = createDelivery("ProjectCreated", "Project");

    await publisher.publish(execution);
    await publisher.publish(project);

    await expect(executionReader.getJob(execution.deduplicationKey)).resolves.toBeDefined();
    await expect(executionReader.getJob(project.deduplicationKey)).resolves.toBeUndefined();
    await expect(domainReader.getJob(project.deduplicationKey)).resolves.toBeDefined();
    await expect(domainReader.getJob(execution.deduplicationKey)).resolves.toBeUndefined();
  });

  it("publishes one retained job and commits PostgreSQL delivery metadata", async () => {
    const event = await insertPendingEvent();
    const queueName = `geo-os-outbox-${randomUUID()}`;
    const publisher = createBullMqOutboxPublisher({
      redisUrl,
      queueName,
      commandTimeoutMs: 1_000,
    });
    closers.push(async () => publisher.close());
    await publisher.initialize(2_000);
    const reader = createQueueReader(queueName);
    const database = createOutboxDatabase();
    const dispatcher = new OutboxDispatcher(new PostgresOutboxStore(database), publisher, {
      publishTimeoutMs: 2_000,
    });

    await expect(dispatcher.dispatchNext()).resolves.toMatchObject({
      kind: "published",
      eventId: event.id,
      attempts: 1,
    });

    const job = await reader.getJob(event.id);
    expect(job).toMatchObject({
      id: event.id,
      name: "ExecutionQueued",
      data: {
        envelope: {
          event_id: event.id,
          aggregate_id: event.aggregateId,
        },
        headers: {},
      },
    });
    await publisher.publish({
      deduplicationKey: event.id,
      eventType: "ExecutionQueued",
      envelope: job?.data.envelope ?? event.envelope,
      headers: job?.data.headers ?? {},
    });
    expect(await reader.getWaitingCount()).toBe(1);
    await expect(readDeliveryState(event.id)).resolves.toMatchObject({
      status: "PUBLISHED",
      attempts: 1,
    });
  });

  it("does not enqueue a late job when Redis recovers after a disconnected publish", async () => {
    const event = await insertPendingEvent();
    const proxy = new RedisTcpProxy(redisUrl);
    const proxyUrl = await proxy.start();
    closers.push(async () => proxy.stop());
    const queueName = `geo-os-recovery-${randomUUID()}`;
    const publisher = createBullMqOutboxPublisher({
      redisUrl: proxyUrl,
      queueName,
      commandTimeoutMs: 100,
      onConnectionError: () => undefined,
    });
    closers.push(async () => publisher.close());
    await publisher.initialize(2_000);
    const database = createOutboxDatabase();
    const dispatcher = new OutboxDispatcher(new PostgresOutboxStore(database), publisher, {
      publishTimeoutMs: 300,
      baseRetryDelayMs: 1_000,
    });

    await proxy.stop();
    await expect(dispatcher.dispatchNext()).resolves.toMatchObject({
      kind: "retry_scheduled",
      eventId: event.id,
      attempts: 1,
    });

    await proxy.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const reader = createQueueReader(queueName);
    await expect(reader.getJob(event.id)).resolves.toBeUndefined();

    const state = await readDeliveryState(event.id);
    expect(state).toMatchObject({
      status: "PENDING",
      attempts: 1,
      event_id: event.id,
      last_error_code: "OUTBOX_PUBLISH_FAILED",
    });
  });
});

interface InsertedEvent {
  readonly id: string;
  readonly aggregateId: string;
  readonly envelope: OutboxQueueJobData["envelope"];
}

function createDelivery(eventType: string, aggregateType: string) {
  const eventId = randomUUID();
  const aggregateId = randomUUID();
  return {
    deduplicationKey: eventId,
    eventType,
    envelope: {
      event_id: eventId,
      event_type: eventType,
      tenant_id: randomUUID(),
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      schema_version: 1,
      occurred_at: new Date().toISOString(),
      trace_id: randomUUID(),
      data: {},
    },
    headers: {},
  };
}

async function insertPendingEvent(): Promise<InsertedEvent> {
  const id = randomUUID();
  const tenantId = randomUUID();
  const aggregateId = randomUUID();
  const traceId = randomUUID();
  const occurredAt = new Date("2000-01-01T00:00:00.000Z");
  const envelope = {
    event_id: id,
    event_type: "ExecutionQueued",
    tenant_id: tenantId,
    aggregate_type: "ExecutionRun",
    aggregate_id: aggregateId,
    schema_version: 1,
    occurred_at: occurredAt.toISOString(),
    trace_id: traceId,
    data: { execution_run_id: aggregateId },
  };
  const client = await createMigrationClient("outbox_bullmq_fixture");
  await client.query(
    `INSERT INTO outbox_events(
       id, tenant_id, aggregate_type, aggregate_id, event_type, schema_version,
       payload, headers, trace_id, available_at, occurred_at
     ) VALUES ($1, $2, 'ExecutionRun', $3, 'ExecutionQueued', 1, $4::jsonb, '{}'::jsonb, $5, $6, $6)`,
    [id, tenantId, aggregateId, JSON.stringify(envelope), traceId, occurredAt],
  );
  return { id, aggregateId, envelope };
}

async function readDeliveryState(eventId: string): Promise<{
  readonly event_id: string;
  readonly status: string;
  readonly attempts: number;
  readonly last_error_code: string | null;
}> {
  const client = await createMigrationClient("outbox_bullmq_state");
  const result = await client.query<{
    event_id: string;
    status: string;
    attempts: number;
    last_error_code: string | null;
  }>(
    `SELECT payload ->> 'event_id' AS event_id, status, attempts, last_error_code
       FROM outbox_events
      WHERE id = $1`,
    [eventId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Outbox event ${eventId} was not found`);
  return row;
}

function createOutboxDatabase(): OutboxDatabase {
  const database = new OutboxDatabase(outboxDatabaseUrl, {
    statementTimeoutMs: 2_000,
    idleInTransactionTimeoutMs: 3_000,
  });
  closers.push(async () => database.close());
  return database;
}

function createQueueReader(queueName: string): Queue<OutboxQueueJobData> {
  const queue = new Queue<OutboxQueueJobData>(queueName, {
    connection: {
      url: redisUrl,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    },
  });
  queue.on("error", () => undefined);
  closers.push(async () => queue.close());
  return queue;
}

async function createMigrationClient(applicationName: string): Promise<pg.Client> {
  const url = new URL(migrationUrl);
  url.searchParams.set("application_name", applicationName);
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  closers.push(async () => client.end());
  return client;
}

function requireTestDatabaseUrl(variableName: string): string {
  const value = process.env[variableName];
  if (!value || process.env.ALLOW_DATABASE_INTEGRATION_TESTS !== "true") {
    throw new Error(
      `Queue integration tests require ${variableName} and ALLOW_DATABASE_INTEGRATION_TESTS=true`,
    );
  }
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (databaseName !== "geo_os_test") {
    throw new Error(`${variableName} must target geo_os_test; received ${databaseName}`);
  }
  return value;
}

class RedisTcpProxy {
  private readonly target: URL;
  private readonly sockets = new Set<net.Socket>();
  private server: net.Server | undefined;
  private port: number | undefined;

  public constructor(targetUrl: string) {
    this.target = new URL(targetUrl);
  }

  public async start(): Promise<string> {
    if (this.server) return this.url();
    const server = net.createServer((client) => {
      const upstream = net.createConnection({
        host: this.target.hostname,
        port: Number(this.target.port),
      });
      this.track(client);
      this.track(upstream);
      client.on("error", () => undefined);
      upstream.on("error", () => client.destroy());
      client.pipe(upstream).pipe(client);
    });
    this.server = server;
    server.listen(this.port ?? 0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Redis test proxy did not acquire a TCP port");
    }
    this.port = address.port;
    return this.url();
  }

  public async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private track(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.once("close", () => this.sockets.delete(socket));
  }

  private url(): string {
    if (this.port === undefined) throw new Error("Redis test proxy is not initialized");
    return `redis://127.0.0.1:${this.port}`;
  }
}

function requireTestRedisUrl(): string {
  const value = process.env.TEST_REDIS_URL;
  if (!value || process.env.ALLOW_REDIS_INTEGRATION_TESTS !== "true") {
    throw new Error(
      "Queue integration tests require TEST_REDIS_URL and ALLOW_REDIS_INTEGRATION_TESTS=true",
    );
  }
  const url = new URL(value);
  if (url.hostname !== "127.0.0.1" || url.port !== "6380") {
    throw new Error("TEST_REDIS_URL must target the isolated Redis service at 127.0.0.1:6380");
  }
  return value;
}
