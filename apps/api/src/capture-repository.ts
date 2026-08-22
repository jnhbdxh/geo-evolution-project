import { randomUUID } from "node:crypto";

import {
  domainEventEnvelopeSchema,
  type CaptureArtifactKind,
  type TenantContext,
} from "@geo-os/contracts";
import type { PoolClient } from "pg";

import type { Database, SqlExecutor } from "./database.js";
import { conflict, notFound } from "./errors.js";

export interface CaptureTarget {
  readonly projectId: string;
  readonly executionRunId: string;
  readonly startedAt: Date;
  readonly databaseNow: Date;
}

export interface RegisterCaptureArtifactInput {
  readonly executionRunId: string;
  readonly idempotencyKey: string;
  readonly artifactKind: CaptureArtifactKind;
  readonly storageBucket: string;
  readonly storageKey: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly capturedAt: Date;
}

export interface CaptureArtifactRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly project_id: string;
  readonly execution_run_id: string;
  readonly idempotency_key: string;
  readonly artifact_kind: CaptureArtifactKind;
  readonly storage_bucket: string;
  readonly storage_key: string;
  readonly media_type: string;
  readonly byte_size: string;
  readonly sha256: string;
  readonly captured_at: Date;
  readonly created_at: Date;
}

export interface CaptureRepository {
  resolveCaptureTarget(context: TenantContext, executionRunId: string): Promise<CaptureTarget>;
  registerCaptureArtifact(
    context: TenantContext,
    input: RegisterCaptureArtifactInput,
    traceId: string,
  ): Promise<CaptureArtifactRow>;
}

interface CaptureTargetRow {
  readonly project_id: string;
  readonly execution_run_id: string;
  readonly started_at: Date | null;
  readonly project_status: string;
  readonly database_now: Date;
}

export class PostgresCaptureRepository implements CaptureRepository {
  public constructor(private readonly database: Database) {}

  public resolveCaptureTarget(
    context: TenantContext,
    executionRunId: string,
  ): Promise<CaptureTarget> {
    return this.database.withTenantRead(context.tenantId, async (client) => {
      const target = await findCaptureTarget(client, context.tenantId, executionRunId);
      return requireCaptureTarget(target);
    });
  }

  public registerCaptureArtifact(
    context: TenantContext,
    input: RegisterCaptureArtifactInput,
    traceId: string,
  ): Promise<CaptureArtifactRow> {
    return this.database.withTenantTransaction(context.tenantId, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `capture-command:${context.tenantId}:${input.executionRunId}:${input.idempotencyKey}`,
      ]);
      const existing = await findCaptureByIdempotencyKey(
        client,
        context.tenantId,
        input.executionRunId,
        input.idempotencyKey,
      );
      if (existing) return requireSameCaptureCommand(existing, input);

      const targetResult = await client.query<CaptureTargetRow>(
        `SELECT er.project_id,
                er.id AS execution_run_id,
                er.started_at,
                p.status AS project_status,
                clock_timestamp() AS database_now
           FROM execution_runs er
           JOIN projects p ON p.tenant_id = er.tenant_id AND p.id = er.project_id
          WHERE er.tenant_id = $1 AND er.id = $2
          FOR SHARE OF er, p`,
        [context.tenantId, input.executionRunId],
      );
      const target = requireCaptureTarget(targetResult.rows[0] ?? null);
      validateCaptureTime(input.capturedAt, target.startedAt, target.databaseNow);
      requireTenantStorageKey(context.tenantId, target.projectId, input);

      const result = await client.query<CaptureArtifactRow>(
        `INSERT INTO capture_artifacts(
           tenant_id, project_id, execution_run_id, idempotency_key,
           artifact_kind, storage_bucket, storage_key, media_type,
           byte_size, sha256, captured_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, tenant_id, project_id, execution_run_id, idempotency_key,
                   artifact_kind, storage_bucket, storage_key, media_type,
                   byte_size::text AS byte_size, sha256, captured_at, created_at`,
        [
          context.tenantId,
          target.projectId,
          input.executionRunId,
          input.idempotencyKey,
          input.artifactKind,
          input.storageBucket,
          input.storageKey,
          input.mediaType,
          input.byteSize,
          input.sha256,
          input.capturedAt,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("CaptureArtifact was not returned");
      await writeCaptureAuditAndOutbox(client, context, traceId, row);
      return row;
    });
  }
}

async function findCaptureTarget(
  client: SqlExecutor,
  tenantId: string,
  executionRunId: string,
): Promise<CaptureTargetRow | null> {
  const result = await client.query<CaptureTargetRow>(
    `SELECT er.project_id,
            er.id AS execution_run_id,
            er.started_at,
            p.status AS project_status,
            clock_timestamp() AS database_now
       FROM execution_runs er
       JOIN projects p ON p.tenant_id = er.tenant_id AND p.id = er.project_id
      WHERE er.tenant_id = $1 AND er.id = $2`,
    [tenantId, executionRunId],
  );
  return result.rows[0] ?? null;
}

function requireCaptureTarget(row: CaptureTargetRow | null): CaptureTarget {
  if (!row) throw notFound("Started ExecutionRun not found");
  if (row.project_status !== "ACTIVE") throw conflict("ExecutionRun Project is not active");
  if (!row.started_at) throw conflict("CaptureArtifact requires a started ExecutionRun");
  return {
    projectId: row.project_id,
    executionRunId: row.execution_run_id,
    startedAt: row.started_at,
    databaseNow: row.database_now,
  };
}

async function findCaptureByIdempotencyKey(
  client: PoolClient,
  tenantId: string,
  executionRunId: string,
  idempotencyKey: string,
): Promise<CaptureArtifactRow | null> {
  const result = await client.query<CaptureArtifactRow>(
    `SELECT id, tenant_id, project_id, execution_run_id, idempotency_key,
            artifact_kind, storage_bucket, storage_key, media_type,
            byte_size::text AS byte_size, sha256, captured_at, created_at
       FROM capture_artifacts
      WHERE tenant_id = $1 AND execution_run_id = $2 AND idempotency_key = $3`,
    [tenantId, executionRunId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

function requireSameCaptureCommand(
  existing: CaptureArtifactRow,
  input: RegisterCaptureArtifactInput,
): CaptureArtifactRow {
  if (
    existing.artifact_kind !== input.artifactKind ||
    existing.storage_bucket !== input.storageBucket ||
    existing.storage_key !== input.storageKey ||
    existing.media_type !== input.mediaType ||
    BigInt(existing.byte_size) !== BigInt(input.byteSize) ||
    existing.sha256 !== input.sha256 ||
    existing.captured_at.getTime() !== input.capturedAt.getTime()
  ) {
    throw conflict("Idempotency key is already bound to a different Capture command");
  }
  return existing;
}

function validateCaptureTime(capturedAt: Date, startedAt: Date, databaseNow: Date): void {
  if (capturedAt.getTime() < startedAt.getTime()) {
    throw conflict("CaptureArtifact cannot predate its ExecutionRun start");
  }
  if (capturedAt.getTime() > databaseNow.getTime() + 5 * 60 * 1_000) {
    throw conflict("CaptureArtifact timestamp is too far in the future");
  }
}

function requireTenantStorageKey(
  tenantId: string,
  projectId: string,
  input: RegisterCaptureArtifactInput,
): void {
  const prefix = `tenants/${tenantId}/projects/${projectId}/executions/${input.executionRunId}/`;
  if (!input.storageKey.startsWith(prefix)) {
    throw conflict("Capture object key is outside the ExecutionRun Tenant/Project scope");
  }
}

async function writeCaptureAuditAndOutbox(
  client: PoolClient,
  context: TenantContext,
  traceId: string,
  artifact: CaptureArtifactRow,
): Promise<void> {
  const eventId = randomUUID();
  const occurredAt = new Date().toISOString();
  const payload = {
    capture_artifact_id: artifact.id,
    project_id: artifact.project_id,
    execution_run_id: artifact.execution_run_id,
    artifact_kind: artifact.artifact_kind,
    media_type: artifact.media_type,
    byte_size: artifact.byte_size,
    sha256: artifact.sha256,
    storage_bucket: artifact.storage_bucket,
    storage_key: artifact.storage_key,
    captured_at: artifact.captured_at.toISOString(),
  };
  const envelope = domainEventEnvelopeSchema.parse({
    event_id: eventId,
    event_type: "CaptureArtifactRegistered",
    tenant_id: context.tenantId,
    aggregate_type: "CaptureArtifact",
    aggregate_id: artifact.id,
    schema_version: 1,
    occurred_at: occurredAt,
    trace_id: traceId,
    data: payload,
  });
  await client.query(
    `INSERT INTO audit_events(
       tenant_id, actor_user_identity_id, action, target_type, target_id, trace_id, details
     ) VALUES ($1, $2, 'CAPTURE_ARTIFACT_REGISTERED', 'CaptureArtifact', $3, $4, $5::jsonb)`,
    [context.tenantId, context.userIdentityId, artifact.id, traceId, JSON.stringify(payload)],
  );
  await client.query(
    `INSERT INTO outbox_events(
       id, tenant_id, aggregate_type, aggregate_id, event_type, payload, trace_id, occurred_at
     ) VALUES ($1, $2, 'CaptureArtifact', $3, 'CaptureArtifactRegistered', $4::jsonb, $5, $6)`,
    [eventId, context.tenantId, artifact.id, JSON.stringify(envelope), traceId, occurredAt],
  );
}
