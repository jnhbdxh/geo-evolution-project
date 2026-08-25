import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  createObservationCandidateSchema,
  domainEventEnvelopeSchema,
  finalizeObservationSchema,
  type CancelExecutionRunInput,
  type CompleteExecutionRunInput,
  type CreateExecutionRunInput,
  type CreateObservationCandidateInput,
  type DomainCommandContext,
  type ExecutionResponseOutcomeKind,
  type FinalizeObservationInput,
  type FailExecutionRunInput,
  type StartExecutionRunInput,
  type ObservationCorrelationStatus,
  type ObservationRepresentation,
} from "@geo-os/contracts";
import type { PoolClient } from "pg";

import type { Database, SqlExecutor } from "./database.js";
import { conflict, notFound } from "./errors.js";

interface AddQuestionVersionToPlanInput {
  readonly monitoringPlanVersionId: string;
  readonly questionVersionId: string;
  readonly ordinal: number;
}

interface PlanQuestionMembershipRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly project_id: string;
  readonly monitoring_plan_version_id: string;
  readonly question_version_id: string;
  readonly ordinal: number;
}

type ExecutionOperationalStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface ExecutionRunRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly project_id: string;
  readonly sample_slot_id: string;
  readonly question_version_id: string;
  readonly retry_of_execution_run_id: string | null;
  readonly attempt_no: number;
  readonly idempotency_key: string;
  readonly operational_status: ExecutionOperationalStatus;
  readonly response_outcome_kind: ExecutionResponseOutcomeKind | null;
  readonly actual_platform: string | null;
  readonly actual_model: string | null;
  readonly actual_surface: string | null;
  readonly policy_release_id: string;
  readonly industry_policy_release_id: string | null;
  readonly execution_context_snapshot: Readonly<Record<string, unknown>> | null;
  readonly started_at: Date | null;
  readonly completed_at: Date | null;
  readonly operational_error: Readonly<Record<string, unknown>> | null;
  readonly created_at: Date;
}

export interface ExecutionAssignmentRow {
  readonly execution_run_id: string;
  readonly question_version_id: string;
  readonly prompt_text: string;
  readonly submitted_prompt_sha256: string;
  readonly locale: string;
  readonly planned_platform: string;
  readonly planned_model: string;
  readonly planned_surface: string;
  readonly region: string | null;
  readonly planned_context: Readonly<Record<string, unknown>>;
}

interface ExecutionParentRow {
  readonly sample_slot_id: string;
  readonly question_version_id: string;
  readonly monitoring_plan_version_status: string;
  readonly question_version_status: string;
}

interface ReleaseBindingRow {
  readonly release_id: string;
  readonly release_status: string;
}

export interface ObservationCandidateRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly project_id: string;
  readonly execution_run_id: string;
  readonly status: "CAPTURING" | "FINALIZING" | "FINALIZED";
  readonly representation: ObservationRepresentation;
  readonly correlation_status: ObservationCorrelationStatus;
  readonly target_surface_reached: true;
  readonly target_question_submitted: true;
  readonly visible_response_outcome_observed: true;
  readonly lifecycle_associated: true;
  readonly existence_basis: Readonly<Record<string, unknown>>;
  readonly response_started_at: Date;
  readonly response_last_seen_at: Date;
  readonly finalized_at: Date | null;
  readonly created_at: Date;
}

export interface RawObservationRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly project_id: string;
  readonly observation_candidate_id: string;
  readonly execution_run_id: string;
  readonly question_version_id: string;
  readonly representation: ObservationRepresentation;
  readonly raw_answer_text: string | null;
  readonly raw_answer_artifact_id: string | null;
  readonly raw_answer_sha256: string;
  readonly capture_manifest: {
    readonly schema_version: 1;
    readonly artifact_ids: readonly string[];
  };
  readonly capture_hash: string;
  readonly execution_context_snapshot: Readonly<Record<string, unknown>>;
  readonly response_started_at: Date;
  readonly response_last_seen_at: Date;
  readonly raw_observation_version: number;
  readonly finalized_at: Date;
  readonly created_at: Date;
}

export interface FinalizationArtifactRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly project_id: string;
  readonly execution_run_id: string;
  readonly artifact_kind: string;
  readonly storage_bucket: string;
  readonly storage_key: string;
  readonly byte_size: string;
  readonly sha256: string;
}

export interface ObservationFinalizationEvidence {
  readonly candidateId: string;
  readonly projectId: string;
  readonly executionRunId: string;
  readonly artifacts: readonly FinalizationArtifactRow[];
}

export interface ExecutionWorkerStateRow {
  readonly execution_run_id: string;
  readonly operational_status: ExecutionOperationalStatus;
  readonly response_outcome_kind: ExecutionResponseOutcomeKind | null;
  readonly completed_at: Date | null;
  readonly observation_candidate_id: string | null;
  readonly raw_observation_id: string | null;
}

interface CandidateExecutionRow extends ExecutionRunRow {
  readonly project_status: string;
  readonly planned_platform: string;
  readonly planned_model: string;
  readonly planned_surface: string;
  readonly plan_status: string;
  readonly database_now: Date;
}

interface FinalizationTargetRow extends ObservationCandidateRow {
  readonly question_version_id: string;
  readonly execution_context_snapshot: Readonly<Record<string, unknown>> | null;
  readonly execution_operational_status: ExecutionOperationalStatus;
  readonly execution_started_at: Date | null;
  readonly execution_completed_at: Date | null;
}

export interface ObservationRepository {
  resolveExecutionWorkerState(
    context: DomainCommandContext,
    executionRunId: string,
    eventId: string,
  ): Promise<ExecutionWorkerStateRow>;
  resolveExecutionAssignment(
    context: DomainCommandContext,
    executionRunId: string,
  ): Promise<ExecutionAssignmentRow>;
  addQuestionVersionToDraftPlan(
    context: DomainCommandContext,
    input: AddQuestionVersionToPlanInput,
    traceId: string,
  ): Promise<PlanQuestionMembershipRow>;
  createExecutionRun(
    context: DomainCommandContext,
    projectId: string,
    input: CreateExecutionRunInput,
    traceId: string,
  ): Promise<ExecutionRunRow>;
  startExecutionRun(
    context: DomainCommandContext,
    executionRunId: string,
    input: StartExecutionRunInput,
    traceId: string,
  ): Promise<ExecutionRunRow>;
  completeExecutionRun(
    context: DomainCommandContext,
    executionRunId: string,
    input: CompleteExecutionRunInput,
    traceId: string,
  ): Promise<ExecutionRunRow>;
  failExecutionRun(
    context: DomainCommandContext,
    executionRunId: string,
    input: FailExecutionRunInput,
    traceId: string,
  ): Promise<ExecutionRunRow>;
  cancelExecutionRun(
    context: DomainCommandContext,
    executionRunId: string,
    input: CancelExecutionRunInput,
    traceId: string,
  ): Promise<ExecutionRunRow>;
  createObservationCandidate(
    context: DomainCommandContext,
    input: CreateObservationCandidateInput,
    traceId: string,
  ): Promise<ObservationCandidateRow>;
  resolveObservationFinalizationEvidence(
    context: DomainCommandContext,
    input: FinalizeObservationInput,
  ): Promise<ObservationFinalizationEvidence>;
  finalizeObservation(
    context: DomainCommandContext,
    input: FinalizeObservationInput,
    traceId: string,
  ): Promise<RawObservationRow>;
}

export class PostgresObservationRepository implements ObservationRepository {
  public constructor(private readonly database: Database) {}

  public resolveExecutionWorkerState(
    context: DomainCommandContext,
    executionRunId: string,
    eventId: string,
  ): Promise<ExecutionWorkerStateRow> {
    return this.database.withTenantRead(context.tenantId, async (client) => {
      const result = await client.query<ExecutionWorkerStateRow>(
        `SELECT er.id AS execution_run_id,
                er.operational_status,
                er.response_outcome_kind,
                er.completed_at,
                oc.id AS observation_candidate_id,
                ro.id AS raw_observation_id
           FROM execution_runs er
           JOIN outbox_events oe
             ON oe.tenant_id = er.tenant_id
            AND oe.aggregate_type = 'ExecutionRun'
            AND oe.aggregate_id = er.id
            AND oe.event_type = 'ExecutionQueued'
            AND oe.id = $3
           LEFT JOIN observation_candidates oc
             ON oc.tenant_id = er.tenant_id
            AND oc.project_id = er.project_id
            AND oc.execution_run_id = er.id
           LEFT JOIN raw_observations ro
             ON ro.tenant_id = er.tenant_id
            AND ro.project_id = er.project_id
            AND ro.observation_candidate_id = oc.id
          WHERE er.tenant_id = $1
            AND er.id = $2`,
        [context.tenantId, executionRunId, eventId],
      );
      const state = result.rows[0];
      if (!state) throw notFound("ExecutionQueued worker assignment not found");
      return state;
    });
  }

  public resolveExecutionAssignment(
    context: DomainCommandContext,
    executionRunId: string,
  ): Promise<ExecutionAssignmentRow> {
    return this.database.withTenantRead(context.tenantId, async (client) => {
      const result = await client.query<ExecutionAssignmentRow>(
        `SELECT er.id AS execution_run_id,
                qv.id AS question_version_id,
                qv.prompt_text,
                encode(digest(convert_to(qv.prompt_text, 'UTF8'), 'sha256'), 'hex')
                  AS submitted_prompt_sha256,
                qv.locale,
                mpv.planned_platform,
                mpv.planned_model,
                mpv.planned_surface,
                mpv.region,
                ss.planned_context
           FROM execution_runs er
           JOIN question_versions qv
             ON qv.tenant_id = er.tenant_id
            AND qv.project_id = er.project_id
            AND qv.id = er.question_version_id
           JOIN sample_slots ss
             ON ss.tenant_id = er.tenant_id
            AND ss.project_id = er.project_id
            AND ss.id = er.sample_slot_id
           JOIN sample_batches sb
             ON sb.tenant_id = ss.tenant_id
            AND sb.project_id = ss.project_id
            AND sb.id = ss.sample_batch_id
           JOIN monitoring_plan_versions mpv
             ON mpv.tenant_id = sb.tenant_id
            AND mpv.project_id = sb.project_id
            AND mpv.id = sb.monitoring_plan_version_id
          WHERE er.tenant_id = $1
            AND er.id = $2
            AND er.operational_status = 'QUEUED'
            AND qv.status = 'PUBLISHED'
            AND mpv.status = 'PUBLISHED'`,
        [context.tenantId, executionRunId],
      );
      const assignment = result.rows[0];
      if (!assignment) throw notFound("Queued ExecutionRun assignment not found");
      return assignment;
    });
  }

  public addQuestionVersionToDraftPlan(
    context: DomainCommandContext,
    input: AddQuestionVersionToPlanInput,
    traceId: string,
  ): Promise<PlanQuestionMembershipRow> {
    return this.database.withTenantTransaction(context.tenantId, async (client) => {
      const planResult = await client.query<{ id: string; project_id: string; status: string }>(
        `SELECT id, project_id, status
           FROM monitoring_plan_versions
          WHERE tenant_id = $1 AND id = $2
          FOR UPDATE`,
        [context.tenantId, input.monitoringPlanVersionId],
      );
      const plan = planResult.rows[0];
      if (!plan) throw notFound("MonitoringPlanVersion not found");
      if (plan.status !== "DRAFT") throw conflict("MonitoringPlanVersion is not editable");

      const questionResult = await client.query<{ id: string }>(
        `SELECT id
           FROM question_versions
          WHERE tenant_id = $1
            AND project_id = $2
            AND id = $3
            AND status = 'PUBLISHED'`,
        [context.tenantId, plan.project_id, input.questionVersionId],
      );
      if (questionResult.rowCount !== 1) {
        throw notFound("Published QuestionVersion not found in the Plan project");
      }

      const membership = await client.query<PlanQuestionMembershipRow>(
        `INSERT INTO monitoring_plan_version_questions(
           tenant_id, project_id, monitoring_plan_version_id, question_version_id, ordinal
         ) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, tenant_id, project_id, monitoring_plan_version_id,
                   question_version_id, ordinal`,
        [
          context.tenantId,
          plan.project_id,
          input.monitoringPlanVersionId,
          input.questionVersionId,
          input.ordinal,
        ],
      );
      const row = membership.rows[0];
      if (!row) throw new Error("Plan QuestionVersion membership was not returned");
      await writeAuditAndOutbox(client, {
        context,
        traceId,
        action: "MONITORING_PLAN_QUESTION_VERSION_ADDED",
        aggregateType: "MonitoringPlanVersion",
        aggregateId: row.monitoring_plan_version_id,
        eventType: "MonitoringPlanQuestionVersionAdded",
        payload: {
          monitoring_plan_version_id: row.monitoring_plan_version_id,
          question_version_id: row.question_version_id,
          ordinal: row.ordinal,
        },
      });
      return row;
    });
  }

  public createExecutionRun(
    context: DomainCommandContext,
    projectId: string,
    input: CreateExecutionRunInput,
    traceId: string,
  ): Promise<ExecutionRunRow> {
    return this.database.withTenantTransaction(context.tenantId, async (client) => {
      await acquireTransactionLock(
        client,
        `execution-command:${context.tenantId}:${projectId}:${input.idempotencyKey}`,
      );
      const existing = await findExecutionByIdempotencyKey(
        client,
        context.tenantId,
        projectId,
        input.idempotencyKey,
      );
      if (existing) return requireSameCreateCommand(existing, input);

      const project = await client.query<{ id: string; status: string }>(
        `SELECT id, status
           FROM projects
          WHERE tenant_id = $1 AND id = $2
          FOR SHARE`,
        [context.tenantId, projectId],
      );
      if (project.rowCount !== 1) throw notFound("Project not found");
      if (project.rows[0]?.status !== "ACTIVE") throw conflict("Project is not active");

      await acquireTransactionLock(
        client,
        `execution-slot:${context.tenantId}:${input.sampleSlotId}`,
      );
      const parent = await findExecutionParent(
        client,
        context.tenantId,
        projectId,
        input.sampleSlotId,
      );
      if (!parent) throw notFound("SampleSlot not found in the Project execution plan");
      if (!isReleased(parent.monitoring_plan_version_status)) {
        throw conflict("SampleSlot MonitoringPlanVersion is not released");
      }
      if (!isReleased(parent.question_version_status)) {
        throw conflict("SampleSlot QuestionVersion is not released");
      }

      const policy = await findCurrentPolicyRelease(client, context.tenantId, projectId);
      if (!policy) throw conflict("Project has no current system PolicyRelease binding");
      if (policy.release_status !== "PUBLISHED") {
        throw conflict("Project system PolicyRelease binding is not published");
      }
      const industryPolicy = await findCurrentIndustryPolicyRelease(
        client,
        context.tenantId,
        projectId,
      );
      if (industryPolicy && industryPolicy.release_status !== "PUBLISHED") {
        throw conflict("Project IndustryPolicyRelease binding is not published");
      }

      const lastRun = await findLastExecutionForSlot(
        client,
        context.tenantId,
        projectId,
        input.sampleSlotId,
      );
      const attemptNo = nextAttemptNumber(lastRun, input.retryOfExecutionRunId);
      const result = await client.query<ExecutionRunRow>(
        `INSERT INTO execution_runs(
           tenant_id, project_id, sample_slot_id, question_version_id,
           retry_of_execution_run_id, attempt_no, idempotency_key,
           policy_release_id, industry_policy_release_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          context.tenantId,
          projectId,
          input.sampleSlotId,
          parent.question_version_id,
          input.retryOfExecutionRunId ?? null,
          attemptNo,
          input.idempotencyKey,
          policy.release_id,
          industryPolicy?.release_id ?? null,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("ExecutionRun was not returned");
      await writeAuditAndOutbox(client, {
        context,
        traceId,
        action: "EXECUTION_QUEUED",
        aggregateType: "ExecutionRun",
        aggregateId: row.id,
        eventType: "ExecutionQueued",
        payload: executionEventPayload(row),
      });
      return row;
    });
  }

  public startExecutionRun(
    context: DomainCommandContext,
    executionRunId: string,
    input: StartExecutionRunInput,
    traceId: string,
  ): Promise<ExecutionRunRow> {
    return this.database.withTenantTransaction(context.tenantId, async (client) => {
      const current = await lockExecution(client, context.tenantId, executionRunId);
      if (current.operational_status === "RUNNING") {
        return requireSameActualExecutionContext(current, input);
      }
      if (current.operational_status !== "QUEUED") {
        throw conflict("Only a queued ExecutionRun can be started");
      }
      const result = await client.query<ExecutionRunRow>(
        `UPDATE execution_runs
            SET operational_status = 'RUNNING',
                actual_platform = $3,
                actual_model = $4,
                actual_surface = $5,
                execution_context_snapshot = $6::jsonb,
                started_at = clock_timestamp()
          WHERE tenant_id = $1 AND id = $2
          RETURNING *`,
        [
          context.tenantId,
          executionRunId,
          input.actualPlatform,
          input.actualModel,
          input.actualSurface,
          JSON.stringify(input.executionContextSnapshot),
        ],
      );
      const row = requireExecutionResult(result.rows[0]);
      await writeExecutionTransition(
        client,
        context,
        traceId,
        row,
        "EXECUTION_STARTED",
        "ExecutionStarted",
      );
      return row;
    });
  }

  public completeExecutionRun(
    context: DomainCommandContext,
    executionRunId: string,
    input: CompleteExecutionRunInput,
    traceId: string,
  ): Promise<ExecutionRunRow> {
    return this.finishExecutionRun(
      context,
      executionRunId,
      "COMPLETED",
      input.responseOutcomeKind ?? null,
      null,
      traceId,
    );
  }

  public failExecutionRun(
    context: DomainCommandContext,
    executionRunId: string,
    input: FailExecutionRunInput,
    traceId: string,
  ): Promise<ExecutionRunRow> {
    return this.finishExecutionRun(
      context,
      executionRunId,
      "FAILED",
      input.responseOutcomeKind ?? null,
      input.operationalError,
      traceId,
    );
  }

  public cancelExecutionRun(
    context: DomainCommandContext,
    executionRunId: string,
    input: CancelExecutionRunInput,
    traceId: string,
  ): Promise<ExecutionRunRow> {
    return this.finishExecutionRun(
      context,
      executionRunId,
      "CANCELLED",
      null,
      input.operationalError ?? null,
      traceId,
    );
  }

  public createObservationCandidate(
    context: DomainCommandContext,
    input: CreateObservationCandidateInput,
    traceId: string,
  ): Promise<ObservationCandidateRow> {
    const command = createObservationCandidateSchema.parse(input);
    return this.database.withTenantTransaction(context.tenantId, async (client) => {
      const execution = await lockCandidateExecution(
        client,
        context.tenantId,
        command.executionRunId,
      );
      const existing = await findObservationCandidate(
        client,
        context.tenantId,
        command.executionRunId,
      );
      if (existing) return requireSameCandidateCommand(existing, execution, command);

      validateCandidateCreation(execution, command);
      await requireCandidateEvidenceArtifacts(
        client,
        context.tenantId,
        execution.project_id,
        command.executionRunId,
        command.existenceBasis.evidenceArtifactIds ?? [],
      );
      if (!execution.response_outcome_kind) {
        await client.query(
          `UPDATE execution_runs
              SET response_outcome_kind = $3
            WHERE tenant_id = $1 AND id = $2`,
          [context.tenantId, command.executionRunId, command.responseOutcomeKind],
        );
      }

      const result = await client.query<ObservationCandidateRow>(
        `INSERT INTO observation_candidates(
           tenant_id, project_id, execution_run_id, representation, correlation_status,
           target_surface_reached, target_question_submitted,
           visible_response_outcome_observed, lifecycle_associated,
           existence_basis, response_started_at, response_last_seen_at
         ) VALUES ($1, $2, $3, $4, $5, true, true, true, true, $6::jsonb, $7, $8)
         RETURNING *`,
        [
          context.tenantId,
          execution.project_id,
          command.executionRunId,
          command.representation,
          command.correlationStatus,
          JSON.stringify(command.existenceBasis),
          command.responseStartedAt,
          command.responseLastSeenAt,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("ObservationCandidate was not returned");
      await writeAuditAndOutbox(client, {
        context,
        traceId,
        action: "OBSERVATION_CANDIDATE_CREATED",
        aggregateType: "ObservationCandidate",
        aggregateId: row.id,
        eventType: "ObservationCandidateCreated",
        payload: candidateEventPayload(row, command.responseOutcomeKind),
      });
      return row;
    });
  }

  public resolveObservationFinalizationEvidence(
    context: DomainCommandContext,
    input: FinalizeObservationInput,
  ): Promise<ObservationFinalizationEvidence> {
    const command = normalizeFinalizeCommand(finalizeObservationSchema.parse(input));
    return this.database.withTenantRead(context.tenantId, async (client) => {
      const candidateResult = await client.query<{
        id: string;
        project_id: string;
        execution_run_id: string;
      }>(
        `SELECT id, project_id, execution_run_id
           FROM observation_candidates
          WHERE tenant_id = $1 AND id = $2`,
        [context.tenantId, command.observationCandidateId],
      );
      const candidate = candidateResult.rows[0];
      if (!candidate) throw notFound("ObservationCandidate not found");
      const artifacts = await findFinalizationArtifacts(
        client,
        context.tenantId,
        candidate.project_id,
        candidate.execution_run_id,
        command.captureArtifactIds,
      );
      return {
        candidateId: candidate.id,
        projectId: candidate.project_id,
        executionRunId: candidate.execution_run_id,
        artifacts,
      };
    });
  }

  public finalizeObservation(
    context: DomainCommandContext,
    input: FinalizeObservationInput,
    traceId: string,
  ): Promise<RawObservationRow> {
    const command = normalizeFinalizeCommand(finalizeObservationSchema.parse(input));
    return this.database.withTenantTransaction(context.tenantId, async (client) => {
      const target = await lockFinalizationTarget(
        client,
        context.tenantId,
        command.observationCandidateId,
      );
      const existing = await findRawObservation(client, context.tenantId, target.id);
      if (existing) return requireSameFinalizeCommand(existing, command);
      validateFinalizationTarget(target, command);

      const artifacts = await findFinalizationArtifacts(
        client,
        context.tenantId,
        target.project_id,
        target.execution_run_id,
        command.captureArtifactIds,
      );
      const rawAnswerSha256 = requireRawAnswerSha256(command, artifacts);
      const captureManifest = {
        schema_version: 1 as const,
        artifact_ids: command.captureArtifactIds,
      };

      await client.query(
        `UPDATE observation_candidates
            SET status = 'FINALIZING'
          WHERE tenant_id = $1 AND id = $2`,
        [context.tenantId, target.id],
      );
      const result = await client.query<RawObservationRow>(
        `INSERT INTO raw_observations(
           tenant_id, project_id, observation_candidate_id, execution_run_id,
           question_version_id, representation, raw_answer_text, raw_answer_artifact_id,
           raw_answer_sha256, capture_manifest, capture_hash, execution_context_snapshot,
           response_started_at, response_last_seen_at, raw_observation_version, finalized_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
           canonical_jsonb_sha256($10::jsonb), $11::jsonb, $12, $13, $14, clock_timestamp()
         )
         RETURNING *`,
        [
          context.tenantId,
          target.project_id,
          target.id,
          target.execution_run_id,
          target.question_version_id,
          command.representation,
          command.rawAnswerText ?? null,
          command.rawAnswerArtifactId ?? null,
          rawAnswerSha256,
          JSON.stringify(captureManifest),
          JSON.stringify(target.execution_context_snapshot),
          target.response_started_at,
          command.responseLastSeenAt,
          command.rawObservationVersion,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("RawObservation was not returned");
      await writeAuditAndOutbox(client, {
        context,
        traceId,
        action: "RAW_OBSERVATION_FINALIZED",
        aggregateType: "RawObservation",
        aggregateId: row.id,
        eventType: "ObservationFinalized",
        payload: rawObservationEventPayload(row),
      });
      await client.query(
        `UPDATE observation_candidates
            SET status = 'FINALIZED', finalized_at = $3
          WHERE tenant_id = $1 AND id = $2`,
        [context.tenantId, target.id, row.finalized_at],
      );
      return row;
    });
  }

  private finishExecutionRun(
    context: DomainCommandContext,
    executionRunId: string,
    targetStatus: "COMPLETED" | "FAILED" | "CANCELLED",
    responseOutcomeKind: ExecutionResponseOutcomeKind | null,
    operationalError: Readonly<Record<string, unknown>> | null,
    traceId: string,
  ): Promise<ExecutionRunRow> {
    return this.database.withTenantTransaction(context.tenantId, async (client) => {
      const current = await lockExecution(client, context.tenantId, executionRunId);
      const effectiveResponseOutcomeKind = responseOutcomeKind ?? current.response_outcome_kind;
      if (current.operational_status === targetStatus) {
        if (
          current.response_outcome_kind === effectiveResponseOutcomeKind &&
          isDeepStrictEqual(current.operational_error, operationalError)
        ) {
          return current;
        }
        throw conflict("Terminal ExecutionRun command does not match the recorded result");
      }
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(current.operational_status)) {
        throw conflict("ExecutionRun is already terminal");
      }
      if (targetStatus === "COMPLETED" && current.operational_status !== "RUNNING") {
        throw conflict("ExecutionRun must be running before completion");
      }
      if (effectiveResponseOutcomeKind && current.operational_status !== "RUNNING") {
        throw conflict("A visible response can only be recorded for a started ExecutionRun");
      }

      const result = await client.query<ExecutionRunRow>(
        `UPDATE execution_runs
            SET operational_status = $3,
                response_outcome_kind = $4,
                completed_at = clock_timestamp(),
                operational_error = $5::jsonb
          WHERE tenant_id = $1 AND id = $2
          RETURNING *`,
        [
          context.tenantId,
          executionRunId,
          targetStatus,
          effectiveResponseOutcomeKind,
          operationalError ? JSON.stringify(operationalError) : null,
        ],
      );
      const row = requireExecutionResult(result.rows[0]);
      const eventName = executionTerminalEventName(targetStatus);
      await writeExecutionTransition(
        client,
        context,
        traceId,
        row,
        eventName.action,
        eventName.eventType,
      );
      return row;
    });
  }
}

interface DomainEventInput {
  readonly context: DomainCommandContext;
  readonly traceId: string;
  readonly action: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

async function writeAuditAndOutbox(client: PoolClient, input: DomainEventInput): Promise<void> {
  const eventId = randomUUID();
  const occurredAt = new Date().toISOString();
  const envelope = domainEventEnvelopeSchema.parse({
    event_id: eventId,
    event_type: input.eventType,
    tenant_id: input.context.tenantId,
    aggregate_type: input.aggregateType,
    aggregate_id: input.aggregateId,
    schema_version: 1,
    occurred_at: occurredAt,
    trace_id: input.traceId,
    data: input.payload,
  });
  await client.query(
    `INSERT INTO audit_events(
       tenant_id, actor_user_identity_id, action, target_type, target_id, trace_id, details
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      input.context.tenantId,
      input.context.userIdentityId,
      input.action,
      input.aggregateType,
      input.aggregateId,
      input.traceId,
      JSON.stringify(auditDetails(input.context, input.payload)),
    ],
  );
  await client.query(
    `INSERT INTO outbox_events(
       id, tenant_id, aggregate_type, aggregate_id, event_type, payload, trace_id, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [
      eventId,
      input.context.tenantId,
      input.aggregateType,
      input.aggregateId,
      input.eventType,
      JSON.stringify(envelope),
      input.traceId,
      occurredAt,
    ],
  );
}

function auditDetails(
  context: DomainCommandContext,
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return context.actorService ? { ...payload, actor_service: context.actorService } : payload;
}

async function acquireTransactionLock(client: PoolClient, lockKey: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]);
}

async function findExecutionByIdempotencyKey(
  client: PoolClient,
  tenantId: string,
  projectId: string,
  idempotencyKey: string,
): Promise<ExecutionRunRow | null> {
  const result = await client.query<ExecutionRunRow>(
    `SELECT * FROM execution_runs
      WHERE tenant_id = $1 AND project_id = $2 AND idempotency_key = $3`,
    [tenantId, projectId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

async function lockCandidateExecution(
  client: PoolClient,
  tenantId: string,
  executionRunId: string,
): Promise<CandidateExecutionRow> {
  const result = await client.query<CandidateExecutionRow>(
    `SELECT er.*,
            p.status AS project_status,
            mpv.planned_platform,
            mpv.planned_model,
            mpv.planned_surface,
            mpv.status AS plan_status,
            clock_timestamp() AS database_now
       FROM execution_runs er
       JOIN projects p
         ON p.tenant_id = er.tenant_id
        AND p.id = er.project_id
       JOIN sample_slots ss
         ON ss.tenant_id = er.tenant_id
        AND ss.project_id = er.project_id
        AND ss.id = er.sample_slot_id
        AND ss.question_version_id = er.question_version_id
       JOIN sample_batches sb
         ON sb.tenant_id = ss.tenant_id
        AND sb.project_id = ss.project_id
        AND sb.id = ss.sample_batch_id
       JOIN monitoring_plan_versions mpv
         ON mpv.tenant_id = sb.tenant_id
        AND mpv.project_id = sb.project_id
        AND mpv.id = sb.monitoring_plan_version_id
      WHERE er.tenant_id = $1 AND er.id = $2
      FOR UPDATE OF er, p`,
    [tenantId, executionRunId],
  );
  const row = result.rows[0];
  if (!row) throw notFound("Started ExecutionRun not found");
  return row;
}

async function findObservationCandidate(
  client: PoolClient,
  tenantId: string,
  executionRunId: string,
): Promise<ObservationCandidateRow | null> {
  const result = await client.query<ObservationCandidateRow>(
    `SELECT * FROM observation_candidates
      WHERE tenant_id = $1 AND execution_run_id = $2`,
    [tenantId, executionRunId],
  );
  return result.rows[0] ?? null;
}

function requireSameCandidateCommand(
  existing: ObservationCandidateRow,
  execution: CandidateExecutionRow,
  input: CreateObservationCandidateInput,
): ObservationCandidateRow {
  if (
    execution.response_outcome_kind !== input.responseOutcomeKind ||
    existing.representation !== input.representation ||
    existing.correlation_status !== input.correlationStatus ||
    !isDeepStrictEqual(existing.existence_basis, input.existenceBasis) ||
    existing.response_started_at.getTime() !== new Date(input.responseStartedAt).getTime() ||
    existing.response_last_seen_at.getTime() !== new Date(input.responseLastSeenAt).getTime()
  ) {
    throw conflict("ExecutionRun already has a different ObservationCandidate");
  }
  return existing;
}

function validateCandidateCreation(
  execution: CandidateExecutionRow,
  input: CreateObservationCandidateInput,
): void {
  if (execution.project_status !== "ACTIVE") {
    throw conflict("ObservationCandidate Project is not active");
  }
  if (
    !execution.started_at ||
    !execution.actual_platform ||
    !execution.actual_model ||
    !execution.actual_surface
  ) {
    throw conflict("ObservationCandidate requires a started ExecutionRun");
  }
  if (execution.plan_status !== "PUBLISHED" && execution.plan_status !== "DEPRECATED") {
    throw conflict("ObservationCandidate requires its released MonitoringPlanVersion");
  }
  if (
    execution.actual_platform !== execution.planned_platform ||
    execution.actual_surface !== execution.planned_surface
  ) {
    throw conflict("Confirmed execution target does not match the planned target");
  }
  if (
    execution.response_outcome_kind &&
    execution.response_outcome_kind !== input.responseOutcomeKind
  ) {
    throw conflict("ExecutionRun has a different visible response outcome");
  }
  if (execution.operational_status !== "RUNNING" && execution.response_outcome_kind === null) {
    throw conflict("A terminal ExecutionRun without a visible response cannot create a Candidate");
  }
  requireExistenceBasisMatchesOutcome(input);
  requireCandidateTimeline(execution, input);
}

function requireExistenceBasisMatchesOutcome(input: CreateObservationCandidateInput): void {
  const allowedBasis = new Map<ExecutionResponseOutcomeKind, readonly string[]>([
    ["ANSWER", ["VISIBLE_TEXT_RESPONSE", "VISIBLE_STRUCTURED_RESPONSE"]],
    ["PARTIAL_ANSWER", ["VISIBLE_PARTIAL_RESPONSE"]],
    ["REFUSAL", ["VISIBLE_REFUSAL"]],
    ["PARTIAL_REFUSAL", ["VISIBLE_PARTIAL_RESPONSE"]],
    ["NO_INFORMATION", ["VISIBLE_NO_INFORMATION"]],
    ["OTHER_VISIBLE_RESPONSE", ["OTHER_VISIBLE_RESPONSE"]],
  ]);
  if (!allowedBasis.get(input.responseOutcomeKind)?.includes(input.existenceBasis.kind)) {
    throw conflict("Existence basis does not match the visible response outcome");
  }
  if (
    input.existenceBasis.kind === "VISIBLE_STRUCTURED_RESPONSE" &&
    input.representation === "TEXT"
  ) {
    throw conflict("Structured response evidence requires STRUCTURED or MIXED representation");
  }
  if (
    input.existenceBasis.kind === "VISIBLE_TEXT_RESPONSE" &&
    input.representation === "STRUCTURED"
  ) {
    throw conflict("Text response evidence requires TEXT or MIXED representation");
  }
}

function requireCandidateTimeline(
  execution: CandidateExecutionRow,
  input: CreateObservationCandidateInput,
): void {
  if (!execution.started_at) throw conflict("ObservationCandidate requires a started ExecutionRun");
  const submittedAt = new Date(input.existenceBasis.questionSubmittedAt);
  const responseStartedAt = new Date(input.responseStartedAt);
  const responseLastSeenAt = new Date(input.responseLastSeenAt);
  if (submittedAt.getTime() < execution.started_at.getTime()) {
    throw conflict("Target Question submission cannot predate ExecutionRun start");
  }
  if (responseStartedAt.getTime() < submittedAt.getTime()) {
    throw conflict("Visible response cannot predate target Question submission");
  }
  if (responseLastSeenAt.getTime() < responseStartedAt.getTime()) {
    throw conflict("Visible response last-seen time cannot predate its start");
  }
  if (responseLastSeenAt.getTime() > execution.database_now.getTime() + 5 * 60 * 1_000) {
    throw conflict("Visible response timestamp is too far in the future");
  }
  if (execution.completed_at && responseLastSeenAt.getTime() > execution.completed_at.getTime()) {
    throw conflict("Visible response cannot fall outside the completed ExecutionRun lifecycle");
  }
}

async function requireCandidateEvidenceArtifacts(
  client: PoolClient,
  tenantId: string,
  projectId: string,
  executionRunId: string,
  artifactIds: readonly string[],
): Promise<void> {
  if (artifactIds.length === 0) return;
  const result = await client.query<{ id: string }>(
    `SELECT id FROM capture_artifacts
      WHERE tenant_id = $1
        AND project_id = $2
        AND execution_run_id = $3
        AND id = ANY($4::uuid[])`,
    [tenantId, projectId, executionRunId, artifactIds],
  );
  if (result.rowCount !== artifactIds.length) {
    throw notFound("Candidate evidence CaptureArtifact not found in the ExecutionRun");
  }
}

function candidateEventPayload(
  candidate: ObservationCandidateRow,
  responseOutcomeKind: ExecutionResponseOutcomeKind,
): Readonly<Record<string, unknown>> {
  return {
    observation_candidate_id: candidate.id,
    project_id: candidate.project_id,
    execution_run_id: candidate.execution_run_id,
    response_outcome_kind: responseOutcomeKind,
    representation: candidate.representation,
    correlation_status: candidate.correlation_status,
    target_surface_reached: candidate.target_surface_reached,
    target_question_submitted: candidate.target_question_submitted,
    visible_response_outcome_observed: candidate.visible_response_outcome_observed,
    lifecycle_associated: candidate.lifecycle_associated,
    existence_basis: candidate.existence_basis,
    response_started_at: candidate.response_started_at.toISOString(),
    response_last_seen_at: candidate.response_last_seen_at.toISOString(),
  };
}

function normalizeFinalizeCommand(input: FinalizeObservationInput): FinalizeObservationInput {
  return {
    ...input,
    captureArtifactIds: [...input.captureArtifactIds].sort(),
  };
}

async function lockFinalizationTarget(
  client: PoolClient,
  tenantId: string,
  candidateId: string,
): Promise<FinalizationTargetRow> {
  const result = await client.query<FinalizationTargetRow>(
    `SELECT oc.*,
            er.question_version_id,
            er.execution_context_snapshot,
            er.operational_status AS execution_operational_status,
            er.started_at AS execution_started_at,
            er.completed_at AS execution_completed_at
       FROM observation_candidates oc
       JOIN execution_runs er
         ON er.tenant_id = oc.tenant_id
        AND er.project_id = oc.project_id
        AND er.id = oc.execution_run_id
      WHERE oc.tenant_id = $1 AND oc.id = $2
      FOR UPDATE OF oc, er`,
    [tenantId, candidateId],
  );
  const row = result.rows[0];
  if (!row) throw notFound("ObservationCandidate not found");
  return row;
}

async function findFinalizationArtifacts(
  client: SqlExecutor,
  tenantId: string,
  projectId: string,
  executionRunId: string,
  artifactIds: readonly string[],
): Promise<readonly FinalizationArtifactRow[]> {
  if (artifactIds.length === 0) return [];
  const result = await client.query<FinalizationArtifactRow>(
    `SELECT id, tenant_id, project_id, execution_run_id, artifact_kind,
            storage_bucket, storage_key, byte_size::text AS byte_size, sha256
       FROM capture_artifacts
      WHERE tenant_id = $1
        AND project_id = $2
        AND execution_run_id = $3
        AND id = ANY($4::uuid[])`,
    [tenantId, projectId, executionRunId, artifactIds],
  );
  if (result.rowCount !== artifactIds.length) {
    throw notFound("Finalize CaptureArtifact not found in the Candidate ExecutionRun");
  }
  return result.rows;
}

async function findRawObservation(
  client: PoolClient,
  tenantId: string,
  candidateId: string,
): Promise<RawObservationRow | null> {
  const result = await client.query<RawObservationRow>(
    `SELECT * FROM raw_observations
      WHERE tenant_id = $1 AND observation_candidate_id = $2`,
    [tenantId, candidateId],
  );
  return result.rows[0] ?? null;
}

function validateFinalizationTarget(
  target: FinalizationTargetRow,
  input: FinalizeObservationInput,
): void {
  if (target.status !== "CAPTURING") {
    throw conflict("ObservationCandidate is not available for finalization");
  }
  if (!target.execution_started_at || !target.execution_context_snapshot) {
    throw conflict("Finalize requires a started ExecutionRun with actual context");
  }
  if (
    !["COMPLETED", "FAILED", "CANCELLED"].includes(target.execution_operational_status) ||
    !target.execution_completed_at
  ) {
    throw conflict("Finalize requires a terminal ExecutionRun");
  }
  if (!isMonotonicRepresentation(target.representation, input.representation)) {
    throw conflict("Final response representation cannot discard the first-detection form");
  }
  const responseLastSeenAt = new Date(input.responseLastSeenAt);
  if (responseLastSeenAt.getTime() < target.response_last_seen_at.getTime()) {
    throw conflict("Final response cannot end before the Candidate detection snapshot");
  }
  if (responseLastSeenAt.getTime() > target.execution_completed_at.getTime()) {
    throw conflict("Final response cannot extend beyond the completed ExecutionRun lifecycle");
  }
}

function isMonotonicRepresentation(
  firstDetection: ObservationRepresentation,
  finalRepresentation: ObservationRepresentation,
): boolean {
  return (
    firstDetection === finalRepresentation ||
    (firstDetection !== "MIXED" && finalRepresentation === "MIXED")
  );
}

function requireRawAnswerSha256(
  input: FinalizeObservationInput,
  artifacts: readonly FinalizationArtifactRow[],
): string {
  const rawArtifact = input.rawAnswerArtifactId
    ? artifacts.find((artifact) => artifact.id === input.rawAnswerArtifactId)
    : undefined;
  if (input.rawAnswerArtifactId && !rawArtifact) {
    throw notFound("Raw-answer CaptureArtifact not found in the Capture Manifest");
  }
  if (
    rawArtifact &&
    rawArtifact.artifact_kind !== "RAW_RESPONSE" &&
    rawArtifact.artifact_kind !== "STRUCTURED_RESPONSE"
  ) {
    throw conflict("Raw-answer CaptureArtifact must contain response bytes");
  }
  const textSha256 = input.rawAnswerText
    ? createHash("sha256").update(input.rawAnswerText, "utf8").digest("hex")
    : undefined;
  if (textSha256 && rawArtifact && textSha256 !== rawArtifact.sha256) {
    throw conflict("Raw answer text and CaptureArtifact bytes have different SHA-256 values");
  }
  const sha256 = textSha256 ?? rawArtifact?.sha256;
  if (!sha256) throw conflict("Finalize requires raw answer text or response bytes");
  return sha256;
}

function requireSameFinalizeCommand(
  existing: RawObservationRow,
  input: FinalizeObservationInput,
): RawObservationRow {
  if (
    existing.representation !== input.representation ||
    existing.raw_answer_text !== (input.rawAnswerText ?? null) ||
    existing.raw_answer_artifact_id !== (input.rawAnswerArtifactId ?? null) ||
    existing.response_last_seen_at.getTime() !== new Date(input.responseLastSeenAt).getTime() ||
    existing.raw_observation_version !== input.rawObservationVersion ||
    !isDeepStrictEqual(existing.capture_manifest.artifact_ids, input.captureArtifactIds)
  ) {
    throw conflict("ObservationCandidate is already finalized with a different result");
  }
  return existing;
}

function rawObservationEventPayload(
  observation: RawObservationRow,
): Readonly<Record<string, unknown>> {
  return {
    raw_observation_id: observation.id,
    project_id: observation.project_id,
    observation_candidate_id: observation.observation_candidate_id,
    execution_run_id: observation.execution_run_id,
    question_version_id: observation.question_version_id,
    representation: observation.representation,
    raw_answer_artifact_id: observation.raw_answer_artifact_id,
    raw_answer_sha256: observation.raw_answer_sha256,
    capture_manifest: observation.capture_manifest,
    capture_hash: observation.capture_hash,
    response_started_at: observation.response_started_at.toISOString(),
    response_last_seen_at: observation.response_last_seen_at.toISOString(),
    raw_observation_version: observation.raw_observation_version,
    finalized_at: observation.finalized_at.toISOString(),
  };
}

function requireSameCreateCommand(
  existing: ExecutionRunRow,
  input: CreateExecutionRunInput,
): ExecutionRunRow {
  if (
    existing.sample_slot_id !== input.sampleSlotId ||
    existing.retry_of_execution_run_id !== (input.retryOfExecutionRunId ?? null)
  ) {
    throw conflict("Idempotency key is already bound to a different Execution command");
  }
  return existing;
}

function requireSameActualExecutionContext(
  existing: ExecutionRunRow,
  input: StartExecutionRunInput,
): ExecutionRunRow {
  if (
    existing.actual_platform !== input.actualPlatform ||
    existing.actual_model !== input.actualModel ||
    existing.actual_surface !== input.actualSurface ||
    !isDeepStrictEqual(existing.execution_context_snapshot, input.executionContextSnapshot)
  ) {
    throw conflict("ExecutionRun is already started with a different actual execution context");
  }
  return existing;
}

async function findExecutionParent(
  client: PoolClient,
  tenantId: string,
  projectId: string,
  sampleSlotId: string,
): Promise<ExecutionParentRow | null> {
  const result = await client.query<ExecutionParentRow>(
    `SELECT ss.id AS sample_slot_id,
            ss.question_version_id,
            mpv.status AS monitoring_plan_version_status,
            qv.status AS question_version_status
       FROM sample_slots ss
       JOIN sample_batches sb
         ON sb.tenant_id = ss.tenant_id
        AND sb.project_id = ss.project_id
        AND sb.id = ss.sample_batch_id
       JOIN monitoring_plan_versions mpv
         ON mpv.tenant_id = sb.tenant_id
        AND mpv.project_id = sb.project_id
        AND mpv.id = sb.monitoring_plan_version_id
       JOIN monitoring_plan_version_questions mpvq
         ON mpvq.tenant_id = ss.tenant_id
        AND mpvq.project_id = ss.project_id
        AND mpvq.monitoring_plan_version_id = mpv.id
        AND mpvq.question_version_id = ss.question_version_id
       JOIN question_versions qv
         ON qv.tenant_id = ss.tenant_id
        AND qv.project_id = ss.project_id
        AND qv.id = ss.question_version_id
      WHERE ss.tenant_id = $1 AND ss.project_id = $2 AND ss.id = $3`,
    [tenantId, projectId, sampleSlotId],
  );
  return result.rows[0] ?? null;
}

function isReleased(status: string): boolean {
  return status === "PUBLISHED" || status === "DEPRECATED";
}

async function findCurrentPolicyRelease(
  client: PoolClient,
  tenantId: string,
  projectId: string,
): Promise<ReleaseBindingRow | null> {
  const result = await client.query<ReleaseBindingRow>(
    `SELECT ppb.policy_release_id AS release_id, pr.status AS release_status
       FROM project_policy_bindings ppb
       JOIN policy_definitions pd ON pd.id = ppb.policy_definition_id
       JOIN policy_releases pr
         ON pr.policy_definition_id = ppb.policy_definition_id
        AND pr.id = ppb.policy_release_id
      WHERE ppb.tenant_id = $1
        AND ppb.project_id = $2
        AND ppb.effective_to IS NULL
        AND pd.code = 'GEO_OS_SYSTEM_BASE'
      LIMIT 1`,
    [tenantId, projectId],
  );
  return result.rows[0] ?? null;
}

async function findCurrentIndustryPolicyRelease(
  client: PoolClient,
  tenantId: string,
  projectId: string,
): Promise<ReleaseBindingRow | null> {
  const result = await client.query<ReleaseBindingRow>(
    `SELECT pib.industry_policy_release_id AS release_id, ipr.status AS release_status
       FROM project_industry_bindings pib
       JOIN industry_policy_releases ipr
         ON ipr.industry_policy_definition_id = pib.industry_policy_definition_id
        AND ipr.id = pib.industry_policy_release_id
      WHERE pib.tenant_id = $1 AND pib.project_id = $2 AND pib.effective_to IS NULL
      LIMIT 1`,
    [tenantId, projectId],
  );
  return result.rows[0] ?? null;
}

async function findLastExecutionForSlot(
  client: PoolClient,
  tenantId: string,
  projectId: string,
  sampleSlotId: string,
): Promise<ExecutionRunRow | null> {
  const result = await client.query<ExecutionRunRow>(
    `SELECT * FROM execution_runs
      WHERE tenant_id = $1 AND project_id = $2 AND sample_slot_id = $3
      ORDER BY attempt_no DESC
      LIMIT 1`,
    [tenantId, projectId, sampleSlotId],
  );
  return result.rows[0] ?? null;
}

function nextAttemptNumber(
  lastRun: ExecutionRunRow | null,
  retryOfExecutionRunId: string | undefined,
): number {
  if (!lastRun) {
    if (retryOfExecutionRunId) throw notFound("Retry ExecutionRun not found for the SampleSlot");
    return 1;
  }
  if (!retryOfExecutionRunId) {
    throw conflict("SampleSlot already has an ExecutionRun; retry must reference its latest run");
  }
  if (lastRun.id !== retryOfExecutionRunId) {
    throw conflict("Retry must reference the latest ExecutionRun for the SampleSlot");
  }
  const retryable =
    lastRun.operational_status === "FAILED" ||
    lastRun.operational_status === "CANCELLED" ||
    (lastRun.operational_status === "COMPLETED" && lastRun.response_outcome_kind === null);
  if (!retryable) {
    throw conflict("ExecutionRun is not retryable");
  }
  return lastRun.attempt_no + 1;
}

async function lockExecution(
  client: PoolClient,
  tenantId: string,
  executionRunId: string,
): Promise<ExecutionRunRow> {
  const result = await client.query<ExecutionRunRow>(
    "SELECT * FROM execution_runs WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
    [tenantId, executionRunId],
  );
  const row = result.rows[0];
  if (!row) throw notFound("ExecutionRun not found");
  return row;
}

function requireExecutionResult(row: ExecutionRunRow | undefined): ExecutionRunRow {
  if (!row) throw new Error("ExecutionRun was not returned");
  return row;
}

function executionEventPayload(row: ExecutionRunRow): Readonly<Record<string, unknown>> {
  return {
    execution_run_id: row.id,
    project_id: row.project_id,
    sample_slot_id: row.sample_slot_id,
    question_version_id: row.question_version_id,
    retry_of_execution_run_id: row.retry_of_execution_run_id,
    attempt_no: row.attempt_no,
    operational_status: row.operational_status,
    response_outcome_kind: row.response_outcome_kind,
    actual_platform: row.actual_platform,
    actual_model: row.actual_model,
    actual_surface: row.actual_surface,
    execution_context_snapshot: row.execution_context_snapshot,
    policy_release_id: row.policy_release_id,
    industry_policy_release_id: row.industry_policy_release_id,
    started_at: row.started_at?.toISOString() ?? null,
    completed_at: row.completed_at?.toISOString() ?? null,
    operational_error: row.operational_error,
  };
}

async function writeExecutionTransition(
  client: PoolClient,
  context: DomainCommandContext,
  traceId: string,
  row: ExecutionRunRow,
  action: string,
  eventType: string,
): Promise<void> {
  await writeAuditAndOutbox(client, {
    context,
    traceId,
    action,
    aggregateType: "ExecutionRun",
    aggregateId: row.id,
    eventType,
    payload: executionEventPayload(row),
  });
}

function executionTerminalEventName(status: "COMPLETED" | "FAILED" | "CANCELLED"): {
  readonly action: string;
  readonly eventType: string;
} {
  if (status === "COMPLETED") {
    return { action: "EXECUTION_COMPLETED", eventType: "ExecutionCompleted" };
  }
  if (status === "FAILED") {
    return { action: "EXECUTION_FAILED", eventType: "ExecutionFailed" };
  }
  return { action: "EXECUTION_CANCELLED", eventType: "ExecutionCancelled" };
}
