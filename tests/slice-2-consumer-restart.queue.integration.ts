import { randomUUID } from "node:crypto";

import type { TenantContext } from "@geo-os/contracts";
import { Queue, QueueEvents, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";

import { Database } from "../apps/api/src/database.js";
import { PostgresObservationRepository } from "../apps/api/src/observation-repository.js";
import {
  handleExecutionQueuedJob,
  type ExecutionQueuedJobData,
} from "../apps/query-engine/src/execution-queued-job.js";

const { Client } = pg;
const applicationDatabaseUrl = requireTestUrl("TEST_DATABASE_URL");
const migrationUrl = requireTestUrl("TEST_DATABASE_MIGRATION_URL");
const redisUrl = requireRedisUrl();

describe("Query Engine Consumer restart", () => {
  it("reuses the durable terminal result when the same event is redelivered after restart", async () => {
    const fixture = await createFixture();
    const database = new Database(applicationDatabaseUrl);
    const repository = new PostgresObservationRepository(database);
    const queueName = `geo-os-consumer-restart-${randomUUID()}`;
    const queueConnection = redisConnection("consumer-restart-queue");
    const eventConnection = redisConnection("consumer-restart-events");
    const queue = new Queue<ExecutionQueuedJobData>(queueName, { connection: queueConnection });
    const queueEvents = new QueueEvents(queueName, { connection: eventConnection });
    const workers: Array<{ worker: Worker<ExecutionQueuedJobData>; connection: Redis }> = [];

    try {
      const traceId = randomUUID();
      const execution = await repository.createExecutionRun(
        fixture.context,
        fixture.projectId,
        {
          sampleSlotId: fixture.sampleSlotId,
          idempotencyKey: `consumer-restart-${randomUUID()}`,
        },
        traceId,
      );
      const queuedEvent = await readQueuedEvent(database, fixture.context.tenantId, execution.id);
      const jobData: ExecutionQueuedJobData = {
        envelope: queuedEvent.payload,
        headers: queuedEvent.headers,
      };
      const execute = vi.fn(async () => {
        const started = await repository.startExecutionRun(
          fixture.context,
          execution.id,
          {
            actualPlatform: "doubao",
            actualModel: "doubao-web",
            actualSurface: "doubao_web",
            executionContextSnapshot: { identityId: "restart-test" },
          },
          traceId,
        );
        if (!started.started_at) throw new Error("Consumer restart fixture did not start");
        const observedAt = new Date(Math.max(Date.now(), started.started_at.getTime()));
        const candidate = await repository.createObservationCandidate(
          fixture.context,
          {
            executionRunId: execution.id,
            responseOutcomeKind: "ANSWER",
            representation: "TEXT",
            correlationStatus: "CONFIRMED",
            targetSurfaceReached: true,
            targetQuestionSubmitted: true,
            visibleResponseOutcomeObserved: true,
            lifecycleAssociated: true,
            existenceBasis: {
              kind: "VISIBLE_TEXT_RESPONSE",
              questionSubmittedAt: observedAt.toISOString(),
              detectorVersion: "consumer-restart-test/1",
              conversationMarker: `conversation-${execution.id}`,
              responseMarker: `response-${execution.id}`,
            },
            responseStartedAt: observedAt.toISOString(),
            responseLastSeenAt: observedAt.toISOString(),
          },
          traceId,
        );
        const completed = await repository.completeExecutionRun(
          fixture.context,
          execution.id,
          { responseOutcomeKind: "ANSWER" },
          traceId,
        );
        if (!completed.completed_at) throw new Error("Consumer restart fixture did not complete");
        const observation = await repository.finalizeObservation(
          fixture.context,
          {
            observationCandidateId: candidate.id,
            representation: "TEXT",
            rawAnswerText: "durable consumer result",
            captureArtifactIds: [],
            responseLastSeenAt: completed.completed_at.toISOString(),
            rawObservationVersion: 1,
          },
          traceId,
        );
        return { rawObservationId: observation.id };
      });
      const core = {
        claim: async (input: {
          readonly tenantId: string;
          readonly executionRunId: string;
          readonly eventId: string;
        }) => {
          const state = await repository.resolveExecutionWorkerState(
            {
              tenantId: input.tenantId,
              userIdentityId: null,
              actorService: "QUERY_ENGINE",
            },
            input.executionRunId,
            input.eventId,
          );
          return {
            ...state,
            completed_at: state.completed_at?.toISOString() ?? null,
            token: "fresh-execution-token",
          };
        },
      };
      const createWorker = (): Worker<ExecutionQueuedJobData> => {
        const connection = redisConnection("consumer-restart-worker");
        const worker = new Worker<ExecutionQueuedJobData>(
          queueName,
          async (job: Job<ExecutionQueuedJobData>) =>
            handleExecutionQueuedJob({ job: job.data, core, execute }),
          { connection, concurrency: 1 },
        );
        workers.push({ worker, connection });
        return worker;
      };

      await queueEvents.waitUntilReady();
      const firstWorker = createWorker();
      await firstWorker.waitUntilReady();
      const firstJob = await queue.add("ExecutionQueued", jobData, {
        jobId: queuedEvent.id,
        removeOnComplete: false,
      });
      await expect(firstJob.waitUntilFinished(queueEvents, 10_000)).resolves.toMatchObject({
        kind: "executed",
      });
      expect(execute).toHaveBeenCalledOnce();

      await closeWorker(workers, firstWorker);
      await firstJob.remove();

      const restartedWorker = createWorker();
      await restartedWorker.waitUntilReady();
      const replay = await queue.add("ExecutionQueued", jobData, {
        jobId: queuedEvent.id,
        removeOnComplete: false,
      });
      await expect(replay.waitUntilFinished(queueEvents, 10_000)).resolves.toMatchObject({
        kind: "already_accepted",
        claim: {
          execution_run_id: execution.id,
          operational_status: "COMPLETED",
        },
      });
      expect(execute).toHaveBeenCalledOnce();

      await expect(
        readTerminalCounts(database, fixture.context.tenantId, execution.id),
      ).resolves.toEqual({ executions: 1, candidates: 1, observations: 1 });
    } finally {
      await Promise.allSettled(workers.map(({ worker }) => worker.close()));
      workers.forEach(({ connection }) => connection.disconnect());
      await Promise.allSettled([queueEvents.close(), queue.close(), database.close()]);
      eventConnection.disconnect();
      queueConnection.disconnect();
    }
  });
});

async function createFixture(): Promise<{
  readonly context: TenantContext;
  readonly projectId: string;
  readonly sampleSlotId: string;
}> {
  const ids = {
    tenant: randomUUID(),
    user: randomUUID(),
    membership: randomUUID(),
    customer: randomUUID(),
    brand: randomUUID(),
    project: randomUUID(),
    question: randomUUID(),
    questionVersion: randomUUID(),
    plan: randomUUID(),
    planVersion: randomUUID(),
    batch: randomUUID(),
    slot: randomUUID(),
  };
  const client = new Client({ connectionString: migrationUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO user_identities(id, issuer, subject, display_name) VALUES ($1, 'consumer-restart-test', $2, 'Consumer Restart')",
      [ids.user, randomUUID()],
    );
    await client.query("INSERT INTO tenants(id, slug, name) VALUES ($1, $2, 'Tenant')", [
      ids.tenant,
      `consumer-restart-${randomUUID()}`,
    ]);
    await client.query(
      "INSERT INTO memberships(id, tenant_id, user_identity_id) VALUES ($1, $2, $3)",
      [ids.membership, ids.tenant, ids.user],
    );
    await client.query(
      "INSERT INTO tenant_role_assignments(tenant_id, membership_id, role) VALUES ($1, $2, 'TENANT_MEMBER')",
      [ids.tenant, ids.membership],
    );
    await client.query("INSERT INTO customers(id, tenant_id, name) VALUES ($1, $2, 'Customer')", [
      ids.customer,
      ids.tenant,
    ]);
    await client.query(
      "INSERT INTO brands(id, tenant_id, customer_id, name) VALUES ($1, $2, $3, 'Brand')",
      [ids.brand, ids.tenant, ids.customer],
    );
    await client.query(
      "INSERT INTO projects(id, tenant_id, brand_id, name) VALUES ($1, $2, $3, 'Project')",
      [ids.project, ids.tenant, ids.brand],
    );
    await client.query(
      `INSERT INTO project_policy_bindings(
         tenant_id, project_id, policy_definition_id, policy_release_id,
         reason, created_by_user_identity_id
       ) VALUES ($1, $2, '00000000-0000-4000-8000-000000000001',
                 '00000000-0000-4000-8000-000000000002', 'fixture', $3)`,
      [ids.tenant, ids.project, ids.user],
    );
    await client.query(
      "INSERT INTO questions(id, tenant_id, project_id, name, created_by_user_identity_id) VALUES ($1, $2, $3, 'Question', $4)",
      [ids.question, ids.tenant, ids.project, ids.user],
    );
    await client.query(
      `INSERT INTO question_versions(
         id, tenant_id, project_id, question_id, version, prompt_text,
         content_sha256, created_by_user_identity_id
       ) VALUES ($1, $2, $3, $4, 1, 'restart test',
                 question_version_content_sha256('restart test', 'zh-CN', '{}'::jsonb),
                 $5)`,
      [ids.questionVersion, ids.tenant, ids.project, ids.question, ids.user],
    );
    await client.query(
      "UPDATE question_versions SET status = 'PUBLISHED', published_at = clock_timestamp() WHERE id = $1",
      [ids.questionVersion],
    );
    await client.query(
      "INSERT INTO monitoring_plans(id, tenant_id, project_id, name, created_by_user_identity_id) VALUES ($1, $2, $3, 'Plan', $4)",
      [ids.plan, ids.tenant, ids.project, ids.user],
    );
    await client.query(
      `INSERT INTO monitoring_plan_versions(
         id, tenant_id, project_id, monitoring_plan_id, version,
         planned_platform, planned_model, planned_surface, sampling_config,
         content_sha256, created_by_user_identity_id
       ) VALUES ($1, $2, $3, $4, 1, 'doubao', 'doubao-web', 'doubao_web',
                 '{"sampleCount":1}'::jsonb, repeat('0', 64), $5)`,
      [ids.planVersion, ids.tenant, ids.project, ids.plan, ids.user],
    );
    await client.query(
      "INSERT INTO monitoring_plan_version_questions(tenant_id, project_id, monitoring_plan_version_id, question_version_id, ordinal) VALUES ($1, $2, $3, $4, 1)",
      [ids.tenant, ids.project, ids.planVersion, ids.questionVersion],
    );
    await client.query(
      `UPDATE monitoring_plan_versions
          SET content_sha256 = monitoring_plan_version_content_sha256(id),
              status = 'PUBLISHED', published_at = clock_timestamp()
        WHERE id = $1`,
      [ids.planVersion],
    );
    await client.query(
      `INSERT INTO sample_batches(
         id, tenant_id, project_id, monitoring_plan_version_id,
         idempotency_key, scheduled_for, scheduled_by_user_identity_id
       ) VALUES ($1, $2, $3, $4, $5, clock_timestamp(), $6)`,
      [ids.batch, ids.tenant, ids.project, ids.planVersion, randomUUID(), ids.user],
    );
    await client.query(
      `INSERT INTO sample_slots(
         id, tenant_id, project_id, sample_batch_id, question_version_id,
         slot_key, planned_context, planned_for
       ) VALUES ($1, $2, $3, $4, $5, 'slot-1', '{}'::jsonb, clock_timestamp())`,
      [ids.slot, ids.tenant, ids.project, ids.batch, ids.questionVersion],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }

  return {
    context: {
      tenantId: ids.tenant,
      userIdentityId: ids.user,
      membershipId: ids.membership,
      roles: ["TENANT_MEMBER"],
    },
    projectId: ids.project,
    sampleSlotId: ids.slot,
  };
}

async function readQueuedEvent(database: Database, tenantId: string, executionRunId: string) {
  return database.withTenantRead(tenantId, async (client) => {
    const result = await client.query<{
      id: string;
      payload: Readonly<Record<string, unknown>>;
      headers: Readonly<Record<string, unknown>>;
    }>(
      `SELECT id, payload, headers
         FROM outbox_events
        WHERE tenant_id = $1 AND aggregate_id = $2 AND event_type = 'ExecutionQueued'`,
      [tenantId, executionRunId],
    );
    const event = result.rows[0];
    if (!event) throw new Error("ExecutionQueued event was not returned");
    return event;
  });
}

async function readTerminalCounts(database: Database, tenantId: string, executionRunId: string) {
  return database.withTenantRead(tenantId, async (client) => {
    const result = await client.query<{
      executions: number;
      candidates: number;
      observations: number;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM execution_runs WHERE id = $1) AS executions,
         (SELECT count(*)::integer FROM observation_candidates WHERE execution_run_id = $1) AS candidates,
         (SELECT count(*)::integer FROM raw_observations WHERE execution_run_id = $1) AS observations`,
      [executionRunId],
    );
    const counts = result.rows[0];
    if (!counts) throw new Error("Terminal counts were not returned");
    return counts;
  });
}

function redisConnection(name: string): Redis {
  return new Redis(redisUrl, { connectionName: name, maxRetriesPerRequest: null });
}

async function closeWorker(
  workers: Array<{ worker: Worker<ExecutionQueuedJobData>; connection: Redis }>,
  worker: Worker<ExecutionQueuedJobData>,
): Promise<void> {
  const index = workers.findIndex((entry) => entry.worker === worker);
  const entry = index < 0 ? undefined : workers.splice(index, 1)[0];
  await worker.close();
  entry?.connection.disconnect();
}

function requireTestUrl(variableName: string): string {
  const value = process.env[variableName];
  if (!value || process.env.ALLOW_DATABASE_INTEGRATION_TESTS !== "true") {
    throw new Error(
      `Consumer restart test requires ${variableName} and ALLOW_DATABASE_INTEGRATION_TESTS=true`,
    );
  }
  if (decodeURIComponent(new URL(value).pathname.slice(1)) !== "geo_os_test") {
    throw new Error(`${variableName} must target geo_os_test`);
  }
  return value;
}

function requireRedisUrl(): string {
  const value = process.env.TEST_REDIS_URL;
  if (!value || process.env.ALLOW_REDIS_INTEGRATION_TESTS !== "true") {
    throw new Error(
      "Consumer restart test requires TEST_REDIS_URL and ALLOW_REDIS_INTEGRATION_TESTS=true",
    );
  }
  return value;
}
