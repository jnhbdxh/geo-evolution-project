import { randomUUID } from "node:crypto";

import type { TenantContext } from "@geo-os/contracts";
import { Client as MinioClient, type BucketItem } from "minio";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { PostgresCaptureRepository, type CaptureArtifactRow } from "./capture-repository.js";
import { CaptureService, type CaptureBytesCommand } from "./capture-service.js";
import { Database } from "./database.js";
import {
  buildCaptureStorageKey,
  MinioEvidenceObjectStore,
  sha256Bytes,
  type EvidenceObjectReference,
  type EvidenceObjectStore,
  type MinioEvidenceObjectStoreConfig,
  type PutEvidenceObjectInput,
} from "./evidence-object-store.js";
import { ObservationFinalizationService } from "./observation-finalization-service.js";
import { PostgresObservationRepository } from "./observation-repository.js";

const databaseUrl = requireTestDatabaseUrl("TEST_DATABASE_URL");
const migrationUrl = requireTestDatabaseUrl("TEST_DATABASE_MIGRATION_URL");
const objectStorage = requireTestObjectStorageConfig();
const { Client } = pg;
const databases: Database[] = [];
const clients: pg.Client[] = [];
const buckets = new Set<string>();

afterEach(async () => {
  await removeCaptureOutboxFailureTrigger();
  await Promise.all([...buckets].map(cleanupBucket));
  buckets.clear();
  await Promise.all(clients.splice(0).map(async (client) => client.end()));
  await Promise.all(databases.splice(0).map(async (database) => database.close()));
});

describe("Capture evidence integration", () => {
  it("uploads real bytes, verifies SHA-256, registers an immutable private Tenant artifact", async () => {
    const fixture = await createCaptureFixture("verified-bytes");
    const harness = createCaptureHarness(fixture);
    const command = captureCommand(fixture, Buffer.from("exact raw response bytes", "utf8"));
    const artifact = await harness.service.captureBytes(fixture.context, command, randomUUID());
    const reference = artifactReference(artifact);
    const verified = await harness.objectStore.verifyObject(fixture.context, reference);
    const counts = await captureEventCounts(fixture, artifact.id);
    const anonymousResponse = await fetch(
      `${objectStorage.endpoint}/${reference.storageBucket}/${reference.storageKey}`,
    );

    expect(artifact).toMatchObject({
      tenant_id: fixture.context.tenantId,
      project_id: fixture.projectId,
      execution_run_id: fixture.executionRunId,
      artifact_kind: "RAW_RESPONSE",
      media_type: "text/plain; charset=utf-8",
      sha256: command.declaredSha256,
    });
    expect(artifact.storage_key).toMatch(
      new RegExp(
        `^tenants/${fixture.context.tenantId}/projects/${fixture.projectId}/executions/${fixture.executionRunId}/captures/raw_response/`,
        "u",
      ),
    );
    expect(verified).toEqual(reference);
    expect(counts).toEqual({ artifacts: 1, audit: 1, outbox: 1 });
    expect(anonymousResponse.status).toBe(403);
  });

  it("re-verifies real response bytes before finalizing a later MIXED response fact", async () => {
    const fixture = await createCaptureFixture("finalize-verified-bytes");
    const harness = createCaptureHarness(fixture);
    const observation = new PostgresObservationRepository(fixture.database);
    const artifact = await harness.service.captureBytes(
      fixture.context,
      captureCommand(fixture, Buffer.from('text plus {"card":"result"}', "utf8")),
      randomUUID(),
    );
    const candidate = await observation.createObservationCandidate(
      fixture.context,
      {
        executionRunId: fixture.executionRunId,
        responseOutcomeKind: "ANSWER",
        representation: "TEXT",
        correlationStatus: "CONFIRMED",
        targetSurfaceReached: true,
        targetQuestionSubmitted: true,
        visibleResponseOutcomeObserved: true,
        lifecycleAssociated: true,
        existenceBasis: {
          kind: "VISIBLE_TEXT_RESPONSE",
          questionSubmittedAt: artifact.captured_at.toISOString(),
          detectorVersion: "capture-finalize-test-v1",
        },
        responseStartedAt: artifact.captured_at.toISOString(),
        responseLastSeenAt: artifact.captured_at.toISOString(),
      },
      randomUUID(),
    );
    const completed = await observation.completeExecutionRun(
      fixture.context,
      fixture.executionRunId,
      { responseOutcomeKind: "ANSWER" },
      randomUUID(),
    );
    if (!completed.completed_at) throw new Error("Capture Finalize fixture did not complete");
    const finalization = new ObservationFinalizationService(observation, harness.objectStore);
    const finalized = await finalization.finalize(
      fixture.context,
      {
        observationCandidateId: candidate.id,
        representation: "MIXED",
        rawAnswerArtifactId: artifact.id,
        captureArtifactIds: [artifact.id],
        responseLastSeenAt: completed.completed_at.toISOString(),
        rawObservationVersion: 1,
      },
      randomUUID(),
    );

    expect(finalized).toMatchObject({
      observation_candidate_id: candidate.id,
      representation: "MIXED",
      raw_answer_artifact_id: artifact.id,
      raw_answer_sha256: artifact.sha256,
      response_started_at: candidate.response_started_at,
      response_last_seen_at: completed.completed_at,
    });
  });

  it("serializes concurrent idempotent Capture commands into one manifest and event", async () => {
    const fixture = await createCaptureFixture("capture-idempotency");
    const harness = createCaptureHarness(fixture);
    const command = captureCommand(fixture, Buffer.from('{"answer":"same"}', "utf8"), {
      artifactKind: "STRUCTURED_RESPONSE",
      mediaType: "application/json",
    });
    const [first, second] = await Promise.all([
      harness.service.captureBytes(fixture.context, command, randomUUID()),
      harness.service.captureBytes(fixture.context, command, randomUUID()),
    ]);
    const counts = await captureEventCounts(fixture, first.id);

    expect(second.id).toBe(first.id);
    expect(counts).toEqual({ artifacts: 1, audit: 1, outbox: 1 });
  });

  it("preserves shared evidence when one concurrent idempotent registration rolls back", async () => {
    const fixture = await createCaptureFixture("capture-concurrent-rollback");
    const harness = createCaptureHarness(fixture);
    const repository = new PostgresCaptureRepository(fixture.database);
    const secondUploaded = deferred<void>();
    const allowSecondRegistration = deferred<void>();
    const firstStore = gateAfterVerifiedUpload(harness.objectStore, async () => {
      await secondUploaded.promise;
    });
    const secondStore = gateAfterVerifiedUpload(harness.objectStore, async () => {
      secondUploaded.resolve();
      await allowSecondRegistration.promise;
    });
    const firstService = new CaptureService(repository, firstStore);
    const secondService = new CaptureService(repository, secondStore);
    const command = captureCommand(fixture, Buffer.from("shared concurrent evidence", "utf8"));
    const failingTraceId = randomUUID();
    await installCaptureOutboxFailureTrigger(failingTraceId);

    const firstPromise = settle(
      firstService.captureBytes(fixture.context, command, failingTraceId),
    );
    const secondPromise = secondService.captureBytes(fixture.context, command, randomUUID());
    const first = await firstPromise;
    allowSecondRegistration.resolve();
    const second = await secondPromise;
    const reference = artifactReference(second);

    expect(first).toMatchObject({ status: "rejected", reason: { code: "P0001" } });
    await expect(harness.objectStore.verifyObject(fixture.context, reference)).resolves.toEqual(
      reference,
    );
    await expect(captureEventCounts(fixture, second.id)).resolves.toEqual({
      artifacts: 1,
      audit: 1,
      outbox: 1,
    });
  });

  it("rejects declared-hash mismatch before upload and detects later object tampering", async () => {
    const fixture = await createCaptureFixture("capture-tamper");
    const harness = createCaptureHarness(fixture);
    const bytes = Buffer.from("trusted bytes", "utf8");
    const mismatch = await settle(
      harness.service.captureBytes(
        fixture.context,
        { ...captureCommand(fixture, bytes), declaredSha256: "0".repeat(64) },
        randomUUID(),
      ),
    );
    const artifact = await harness.service.captureBytes(
      fixture.context,
      captureCommand(fixture, bytes),
      randomUUID(),
    );
    const reference = artifactReference(artifact);
    await harness.rawClient.putObject(
      reference.storageBucket,
      reference.storageKey,
      Buffer.from("tampered", "utf8"),
    );
    const tamper = await settle(harness.objectStore.verifyObject(fixture.context, reference));
    const observation = new PostgresObservationRepository(fixture.database);
    const candidate = await observation.createObservationCandidate(
      fixture.context,
      {
        executionRunId: fixture.executionRunId,
        responseOutcomeKind: "ANSWER",
        representation: "TEXT",
        correlationStatus: "CONFIRMED",
        targetSurfaceReached: true,
        targetQuestionSubmitted: true,
        visibleResponseOutcomeObserved: true,
        lifecycleAssociated: true,
        existenceBasis: {
          kind: "VISIBLE_TEXT_RESPONSE",
          questionSubmittedAt: artifact.captured_at.toISOString(),
          detectorVersion: "capture-tamper-finalize-test-v1",
        },
        responseStartedAt: artifact.captured_at.toISOString(),
        responseLastSeenAt: artifact.captured_at.toISOString(),
      },
      randomUUID(),
    );
    await observation.completeExecutionRun(
      fixture.context,
      fixture.executionRunId,
      { responseOutcomeKind: "ANSWER" },
      randomUUID(),
    );
    const finalizationTamper = await settle(
      new ObservationFinalizationService(observation, harness.objectStore).finalize(
        fixture.context,
        {
          observationCandidateId: candidate.id,
          representation: "TEXT",
          rawAnswerArtifactId: artifact.id,
          captureArtifactIds: [artifact.id],
          responseLastSeenAt: artifact.captured_at.toISOString(),
          rawObservationVersion: 1,
        },
        randomUUID(),
      ),
    );
    const finalizationState = await fixture.database.withTenantRead(
      fixture.context.tenantId,
      async (client) => {
        const candidateResult = await client.query<{ status: string }>(
          "SELECT status FROM observation_candidates WHERE id = $1",
          [candidate.id],
        );
        const rawResult = await client.query(
          "SELECT id FROM raw_observations WHERE observation_candidate_id = $1",
          [candidate.id],
        );
        return { status: candidateResult.rows[0]?.status, rawCount: rawResult.rowCount };
      },
    );
    const manifestMutation = await settle(
      fixture.database.withTenantTransaction(fixture.context.tenantId, async (client) => {
        await client.query("UPDATE capture_artifacts SET sha256 = $2 WHERE id = $1", [
          artifact.id,
          "f".repeat(64),
        ]);
      }),
    );

    expect(mismatch).toMatchObject({ status: "rejected", reason: { code: "CONFLICT" } });
    expect(tamper).toMatchObject({ status: "rejected", reason: { code: "CONFLICT" } });
    expect(finalizationTamper).toMatchObject({
      status: "rejected",
      reason: { code: "CONFLICT" },
    });
    expect(finalizationState).toEqual({ status: "CAPTURING", rawCount: 0 });
    expect(manifestMutation).toMatchObject({ status: "rejected", reason: { code: "42501" } });
  });

  it("hides both PostgreSQL manifest and object reference from another Tenant", async () => {
    const owner = await createCaptureFixture("capture-owner");
    const outsider = await createCaptureFixture("capture-outsider");
    const harness = createCaptureHarness(owner);
    const artifact = await harness.service.captureBytes(
      owner.context,
      captureCommand(owner, Buffer.from("tenant private", "utf8")),
      randomUUID(),
    );
    const reference = artifactReference(artifact);
    const objectLookup = await settle(
      harness.objectStore.verifyObject(outsider.context, reference),
    );
    const manifestRows = await outsider.database.withTenantRead(
      outsider.context.tenantId,
      async (client) => {
        const result = await client.query("SELECT id FROM capture_artifacts WHERE id = $1", [
          artifact.id,
        ]);
        return result.rowCount;
      },
    );

    expect(objectLookup).toMatchObject({ status: "rejected", reason: { code: "NOT_FOUND" } });
    expect(manifestRows).toBe(0);
  });

  it("rolls back manifest/Audit/Outbox but retains the young orphan on Outbox failure", async () => {
    const fixture = await createCaptureFixture("capture-orphan-retention");
    const harness = createCaptureHarness(fixture);
    const bytes = Buffer.from("young orphan retained", "utf8");
    const command = captureCommand(fixture, bytes);
    const traceId = randomUUID();
    await installCaptureOutboxFailureTrigger(traceId);

    const outcome = await settle(harness.service.captureBytes(fixture.context, command, traceId));
    const storageKey = buildCaptureStorageKey({
      tenantId: fixture.context.tenantId,
      projectId: fixture.projectId,
      executionRunId: fixture.executionRunId,
      artifactKind: command.artifactKind,
      idempotencyKey: command.idempotencyKey,
      declaredSha256: command.declaredSha256,
    });
    const reference: EvidenceObjectReference = {
      storageBucket: harness.bucket,
      storageKey,
      byteSize: bytes.byteLength,
      sha256: command.declaredSha256,
    };
    const objectLookup = await settle(harness.objectStore.verifyObject(fixture.context, reference));
    const counts = await captureTraceCounts(fixture, traceId);

    expect(outcome).toMatchObject({ status: "rejected", reason: { code: "P0001" } });
    expect(objectLookup).toMatchObject({ status: "fulfilled", value: reference });
    expect(counts).toEqual({ artifacts: 0, audit: 0, outbox: 0 });
  });
});

interface CaptureFixture {
  readonly database: Database;
  readonly context: TenantContext;
  readonly projectId: string;
  readonly executionRunId: string;
  readonly startedAt: Date;
}

interface CaptureHarness {
  readonly service: CaptureService;
  readonly objectStore: MinioEvidenceObjectStore;
  readonly rawClient: MinioClient;
  readonly bucket: string;
}

function createCaptureHarness(fixture: CaptureFixture): CaptureHarness {
  const bucket = `geo-os-capture-test-${shortRunId()}`;
  buckets.add(bucket);
  const config = { ...objectStorage, bucket };
  const objectStore = new MinioEvidenceObjectStore(config);
  const repository = new PostgresCaptureRepository(fixture.database);
  return {
    service: new CaptureService(repository, objectStore),
    objectStore,
    rawClient: createRawMinioClient(config),
    bucket,
  };
}

function gateAfterVerifiedUpload(
  delegate: EvidenceObjectStore,
  afterUpload: () => Promise<void>,
): EvidenceObjectStore {
  return {
    putVerifiedObject: async (input: PutEvidenceObjectInput) => {
      const reference = await delegate.putVerifiedObject(input);
      await afterUpload();
      return reference;
    },
    verifyObject: (context, reference) => delegate.verifyObject(context, reference),
    removeVerifiedObject: (context, reference) => delegate.removeVerifiedObject(context, reference),
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      if (!resolvePromise) throw new Error("Deferred promise was not initialized");
      resolvePromise(value);
    },
  };
}

function captureCommand(
  fixture: CaptureFixture,
  bytes: Uint8Array,
  overrides: Partial<CaptureBytesCommand> = {},
): CaptureBytesCommand {
  return {
    executionRunId: fixture.executionRunId,
    idempotencyKey: `capture-${randomUUID()}`,
    artifactKind: "RAW_RESPONSE",
    mediaType: "text/plain; charset=utf-8",
    capturedAt: new Date(Math.max(Date.now(), fixture.startedAt.getTime())).toISOString(),
    declaredSha256: sha256Bytes(bytes),
    bytes,
    ...overrides,
  };
}

function artifactReference(artifact: CaptureArtifactRow): EvidenceObjectReference {
  return {
    storageBucket: artifact.storage_bucket,
    storageKey: artifact.storage_key,
    byteSize: Number(artifact.byte_size),
    sha256: artifact.sha256,
  };
}

async function createCaptureFixture(label: string): Promise<CaptureFixture> {
  const database = createDatabase(`capture_${shortRunId()}`);
  const tenantId = randomUUID();
  const userIdentityId = randomUUID();
  const projectId = randomUUID();
  await withMigrationClient(async (client) => {
    const customerId = randomUUID();
    const brandId = randomUUID();
    await client.query(
      `INSERT INTO user_identities(id, issuer, subject, display_name)
       VALUES ($1, 'capture-test', $2, $3)`,
      [userIdentityId, randomUUID(), `Capture ${label}`],
    );
    await client.query("INSERT INTO tenants(id, slug, name) VALUES ($1, $2, $3)", [
      tenantId,
      `capture-${shortRunId()}`,
      `Capture Tenant ${label}`,
    ]);
    await client.query("INSERT INTO customers(id, tenant_id, name) VALUES ($1, $2, 'Customer')", [
      customerId,
      tenantId,
    ]);
    await client.query(
      "INSERT INTO brands(id, tenant_id, customer_id, name) VALUES ($1, $2, $3, 'Brand')",
      [brandId, tenantId, customerId],
    );
    await client.query(
      "INSERT INTO projects(id, tenant_id, brand_id, name) VALUES ($1, $2, $3, 'Project')",
      [projectId, tenantId, brandId],
    );
    await client.query(
      `INSERT INTO project_policy_bindings(
         tenant_id, project_id, policy_definition_id, policy_release_id,
         reason, created_by_user_identity_id
       ) VALUES (
         $1, $2, '00000000-0000-4000-8000-000000000001',
         '00000000-0000-4000-8000-000000000002', 'capture fixture', $3
       )`,
      [tenantId, projectId, userIdentityId],
    );
  });

  const context: TenantContext = {
    tenantId,
    userIdentityId,
    membershipId: randomUUID(),
    roles: ["TENANT_MEMBER"],
  };
  const sampleSlotId = await database.withTenantTransaction(tenantId, async (client) => {
    const questionId = randomUUID();
    const questionVersionId = randomUUID();
    const planId = randomUUID();
    const planVersionId = randomUUID();
    const batchId = randomUUID();
    const slotId = randomUUID();
    const prompt = `Capture ${label}?`;
    await client.query(
      `INSERT INTO questions(id, tenant_id, project_id, name, created_by_user_identity_id)
       VALUES ($1, $2, $3, 'Question', $4)`,
      [questionId, tenantId, projectId, userIdentityId],
    );
    await client.query(
      `INSERT INTO question_versions(
         id, tenant_id, project_id, question_id, version, prompt_text,
         content_sha256, created_by_user_identity_id
       ) VALUES (
         $1, $2, $3, $4, 1, $5,
         question_version_content_sha256($5, 'zh-CN', '{}'::jsonb), $6
       )`,
      [questionVersionId, tenantId, projectId, questionId, prompt, userIdentityId],
    );
    await client.query(
      "UPDATE question_versions SET status = 'PUBLISHED', published_at = clock_timestamp() WHERE id = $1",
      [questionVersionId],
    );
    await client.query(
      `INSERT INTO monitoring_plans(id, tenant_id, project_id, name, created_by_user_identity_id)
       VALUES ($1, $2, $3, 'Plan', $4)`,
      [planId, tenantId, projectId, userIdentityId],
    );
    await client.query(
      `INSERT INTO monitoring_plan_versions(
         id, tenant_id, project_id, monitoring_plan_id, version,
         planned_platform, planned_model, planned_surface, sampling_config,
         content_sha256, created_by_user_identity_id
       ) VALUES ($1, $2, $3, $4, 1, 'test-platform', 'test-model', 'chat',
                 '{"sampleCount":1}'::jsonb, $5, $6)`,
      [planVersionId, tenantId, projectId, planId, "0".repeat(64), userIdentityId],
    );
    await client.query(
      `INSERT INTO monitoring_plan_version_questions(
         tenant_id, project_id, monitoring_plan_version_id, question_version_id, ordinal
       ) VALUES ($1, $2, $3, $4, 1)`,
      [tenantId, projectId, planVersionId, questionVersionId],
    );
    await client.query(
      `UPDATE monitoring_plan_versions
          SET content_sha256 = monitoring_plan_version_content_sha256(id),
              status = 'PUBLISHED', published_at = clock_timestamp()
        WHERE id = $1`,
      [planVersionId],
    );
    await client.query(
      `INSERT INTO sample_batches(
         id, tenant_id, project_id, monitoring_plan_version_id,
         idempotency_key, scheduled_for, scheduled_by_user_identity_id
       ) VALUES ($1, $2, $3, $4, $5, clock_timestamp(), $6)`,
      [batchId, tenantId, projectId, planVersionId, `batch-${randomUUID()}`, userIdentityId],
    );
    await client.query(
      `INSERT INTO sample_slots(
         id, tenant_id, project_id, sample_batch_id, question_version_id,
         slot_key, planned_context, planned_for
       ) VALUES ($1, $2, $3, $4, $5, 'slot-1', '{}'::jsonb, clock_timestamp())`,
      [slotId, tenantId, projectId, batchId, questionVersionId],
    );
    return slotId;
  });
  const observation = new PostgresObservationRepository(database);
  const execution = await observation.createExecutionRun(
    context,
    projectId,
    { sampleSlotId, idempotencyKey: `execution-${randomUUID()}` },
    randomUUID(),
  );
  const started = await observation.startExecutionRun(
    context,
    execution.id,
    {
      actualPlatform: "test-platform",
      actualModel: "test-model",
      actualSurface: "chat",
      executionContextSnapshot: { adapter: "capture-test" },
    },
    randomUUID(),
  );
  if (!started.started_at) throw new Error("Capture fixture ExecutionRun did not start");
  return {
    database,
    context,
    projectId,
    executionRunId: execution.id,
    startedAt: started.started_at,
  };
}

async function captureEventCounts(
  fixture: CaptureFixture,
  artifactId: string,
): Promise<{ readonly artifacts: number; readonly audit: number; readonly outbox: number }> {
  return fixture.database.withTenantRead(fixture.context.tenantId, async (client) => {
    const artifacts = await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM capture_artifacts WHERE id = $1",
      [artifactId],
    );
    const audit = await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM audit_events WHERE target_id = $1",
      [artifactId],
    );
    const outbox = await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM outbox_events WHERE aggregate_id = $1",
      [artifactId],
    );
    return {
      artifacts: artifacts.rows[0]?.count ?? -1,
      audit: audit.rows[0]?.count ?? -1,
      outbox: outbox.rows[0]?.count ?? -1,
    };
  });
}

async function captureTraceCounts(
  fixture: CaptureFixture,
  traceId: string,
): Promise<{ readonly artifacts: number; readonly audit: number; readonly outbox: number }> {
  return fixture.database.withTenantRead(fixture.context.tenantId, async (client) => {
    const artifacts = await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM capture_artifacts WHERE execution_run_id = $1",
      [fixture.executionRunId],
    );
    const audit = await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM audit_events WHERE trace_id = $1",
      [traceId],
    );
    const outbox = await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM outbox_events WHERE trace_id = $1",
      [traceId],
    );
    return {
      artifacts: artifacts.rows[0]?.count ?? -1,
      audit: audit.rows[0]?.count ?? -1,
      outbox: outbox.rows[0]?.count ?? -1,
    };
  });
}

function createDatabase(applicationName: string): Database {
  const url = new URL(databaseUrl);
  url.searchParams.set("application_name", applicationName);
  const database = new Database(url.toString());
  databases.push(database);
  return database;
}

async function withMigrationClient<T>(operation: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = new URL(migrationUrl);
  url.searchParams.set("application_name", `capture_admin_${shortRunId()}`);
  const client = new Client({ connectionString: url.toString() });
  clients.push(client);
  await client.connect();
  return operation(client);
}

async function installCaptureOutboxFailureTrigger(traceId: string): Promise<void> {
  await withMigrationClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS test_capture_outbox_failures(trace_id uuid PRIMARY KEY);
      CREATE OR REPLACE FUNCTION fail_selected_capture_outbox()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM test_capture_outbox_failures WHERE trace_id = NEW.trace_id
        ) THEN
          RAISE EXCEPTION 'selected Capture Outbox failure';
        END IF;
        RETURN NEW;
      END
      $$;
      DROP TRIGGER IF EXISTS fail_selected_capture_outbox_trigger ON outbox_events;
      CREATE TRIGGER fail_selected_capture_outbox_trigger
        BEFORE INSERT ON outbox_events
        FOR EACH ROW EXECUTE FUNCTION fail_selected_capture_outbox();
    `);
    await client.query("INSERT INTO test_capture_outbox_failures(trace_id) VALUES ($1)", [traceId]);
  });
}

async function removeCaptureOutboxFailureTrigger(): Promise<void> {
  const url = new URL(migrationUrl);
  url.searchParams.set("application_name", `capture_cleanup_${shortRunId()}`);
  const client = new Client({ connectionString: url.toString() });
  try {
    await client.connect();
    await client.query(`
      DROP TRIGGER IF EXISTS fail_selected_capture_outbox_trigger ON outbox_events;
      DROP FUNCTION IF EXISTS fail_selected_capture_outbox();
      DROP TABLE IF EXISTS test_capture_outbox_failures;
    `);
  } finally {
    await client.end().catch(() => undefined);
  }
}

function createRawMinioClient(config: MinioEvidenceObjectStoreConfig): MinioClient {
  const endpoint = new URL(config.endpoint);
  return new MinioClient({
    endPoint: endpoint.hostname,
    port: Number(endpoint.port),
    useSSL: endpoint.protocol === "https:",
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    pathStyle: true,
  });
}

async function cleanupBucket(bucket: string): Promise<void> {
  const client = createRawMinioClient({ ...objectStorage, bucket });
  if (!(await client.bucketExists(bucket))) return;
  const objectNames = await listObjectNames(client, bucket);
  if (objectNames.length > 0) await client.removeObjects(bucket, objectNames);
  await client.removeBucket(bucket);
}

function listObjectNames(client: MinioClient, bucket: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const names: string[] = [];
    client
      .listObjectsV2(bucket, "", true)
      .on("data", (item: BucketItem) => {
        if (item.name) names.push(item.name);
      })
      .on("error", reject)
      .on("end", () => resolve(names));
  });
}

async function settle<T>(
  promise: Promise<T>,
): Promise<
  | { readonly status: "fulfilled"; readonly value: T }
  | { readonly status: "rejected"; readonly reason: unknown }
> {
  try {
    return { status: "fulfilled", value: await promise };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

function requireTestDatabaseUrl(variableName: string): string {
  const value = process.env[variableName];
  if (!value || process.env.ALLOW_DATABASE_INTEGRATION_TESTS !== "true") {
    throw new Error(
      `Capture integration tests require ${variableName} and ALLOW_DATABASE_INTEGRATION_TESTS=true`,
    );
  }
  const url = new URL(value);
  if (url.pathname !== "/geo_os_test") {
    throw new Error(`${variableName} must target the isolated geo_os_test database`);
  }
  return value;
}

function requireTestObjectStorageConfig(): Omit<MinioEvidenceObjectStoreConfig, "bucket"> {
  if (process.env.ALLOW_OBJECT_STORAGE_INTEGRATION_TESTS !== "true") {
    throw new Error(
      "Capture integration tests require ALLOW_OBJECT_STORAGE_INTEGRATION_TESTS=true",
    );
  }
  const endpoint = process.env.TEST_OBJECT_STORAGE_ENDPOINT;
  const accessKey = process.env.TEST_OBJECT_STORAGE_ACCESS_KEY;
  const secretKey = process.env.TEST_OBJECT_STORAGE_SECRET_KEY;
  if (!endpoint || !accessKey || !secretKey) {
    throw new Error("Capture integration tests require isolated object-storage credentials");
  }
  const url = new URL(endpoint);
  if (!(["127.0.0.1", "localhost"].includes(url.hostname) && url.port === "9100")) {
    throw new Error("Capture integration tests must target isolated MinIO on localhost:9100");
  }
  return { endpoint, accessKey, secretKey };
}

function shortRunId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 12);
}
