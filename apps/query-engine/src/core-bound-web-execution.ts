import { createHash } from "node:crypto";

import type { CreateObservationCandidateInput } from "@geo-os/contracts";

import type { CandidateDecision, CoreExecutionClient } from "./core-execution-client.js";
import {
  type WebSurfaceAdapter,
  type WebSurfaceExecutionRequest,
  type WebSurfaceExecutionResult,
  WebSurfaceExecutionError,
} from "./web-surface-adapter.js";

export interface CoreBoundExecutionResult {
  readonly execution: WebSurfaceExecutionResult;
  readonly captureArtifactIds: readonly string[];
  readonly observationCandidateId: string;
  readonly rawObservationId: string;
}

export interface CoreBoundWebExecutionDependencies {
  readonly adapter: WebSurfaceAdapter;
  readonly core: CoreExecutionClient;
  readonly decideCandidate: (
    result: WebSurfaceExecutionResult,
  ) => Promise<CandidateDecision> | CandidateDecision;
}

export class CoreBoundWebExecution {
  public constructor(private readonly dependencies: CoreBoundWebExecutionDependencies) {}

  public async run(request: WebSurfaceExecutionRequest): Promise<CoreBoundExecutionResult> {
    try {
      const assignment = await this.dependencies.core.getAssignment();
      requireCanonicalAssignment(request, this.dependencies.adapter, assignment);
      const execution = await this.dependencies.adapter.execute(request, {
        onRuntimeReady: async (runtime) => {
          await this.dependencies.core.start(runtime);
        },
      });
      const captures = await this.captureUiTruth(execution);
      const decision = await this.dependencies.decideCandidate(execution);
      const candidateCommand = candidateCommandFor(execution, captures.allIds, decision);
      const observationCandidateId = await this.dependencies.core.createCandidate(candidateCommand);
      await this.dependencies.core.complete({
        responseOutcomeKind: decision.responseOutcomeKind,
      });
      const rawObservationId = await this.dependencies.core.finalize({
        observationCandidateId,
        representation: decision.representation,
        rawAnswerArtifactId: captures.rawAnswerArtifactId,
        captureArtifactIds: [...captures.allIds],
        responseLastSeenAt: execution.responseLastSeenAt.toISOString(),
        rawObservationVersion: 1,
      });
      return {
        execution,
        captureArtifactIds: captures.allIds,
        observationCandidateId,
        rawObservationId,
      };
    } catch (error) {
      await this.failExecution(error).catch(() => undefined);
      throw error;
    }
  }

  private async captureUiTruth(result: WebSurfaceExecutionResult): Promise<{
    readonly rawAnswerArtifactId: string;
    readonly allIds: readonly string[];
  }> {
    const rawAnswerBytes = new TextEncoder().encode(result.uiTruth.responseText);
    const manifestBytes = new TextEncoder().encode(
      stableJson({
        schema_version: 1,
        execution_run_id: result.executionRunId,
        question_version_id: result.questionVersionId,
        actual_platform: result.actualPlatform,
        actual_model: result.actualModel,
        actual_surface: result.actualSurface,
        question_submitted_at: result.questionSubmittedAt.toISOString(),
        response_started_at: result.responseStartedAt.toISOString(),
        response_last_seen_at: result.responseLastSeenAt.toISOString(),
        completed_at: result.completedAt.toISOString(),
        question_response_binding: result.questionResponseBinding,
        visible_link_candidates: result.uiTruth.visibleLinkCandidates,
        artifact_sha256: {
          raw_response: sha256Bytes(rawAnswerBytes),
          response_html: sha256Bytes(result.uiTruth.responseHtmlBytes),
          response_screenshot: sha256Bytes(result.uiTruth.responseScreenshotBytes),
          viewport_screenshot: sha256Bytes(result.uiTruth.viewportScreenshotBytes),
        },
        execution_context_snapshot: result.executionContextSnapshot,
      }),
    );
    const capturedAt = result.completedAt;
    const rawAnswerArtifactId = await this.dependencies.core.capture({
      idempotencyKey: "core-bound-v1:raw-response",
      artifactKind: "RAW_RESPONSE",
      mediaType: "text/plain; charset=utf-8",
      capturedAt,
      bytes: rawAnswerBytes,
    });
    const remainingIds = await Promise.all([
      this.dependencies.core.capture({
        idempotencyKey: "core-bound-v1:response-html",
        artifactKind: "TRACE",
        mediaType: "text/html; charset=utf-8",
        capturedAt,
        bytes: result.uiTruth.responseHtmlBytes,
      }),
      this.dependencies.core.capture({
        idempotencyKey: "core-bound-v1:response-screenshot",
        artifactKind: "SCREENSHOT",
        mediaType: "image/png",
        capturedAt,
        bytes: result.uiTruth.responseScreenshotBytes,
      }),
      this.dependencies.core.capture({
        idempotencyKey: "core-bound-v1:viewport-screenshot",
        artifactKind: "SCREENSHOT",
        mediaType: "image/png",
        capturedAt,
        bytes: result.uiTruth.viewportScreenshotBytes,
      }),
      this.dependencies.core.capture({
        idempotencyKey: "core-bound-v1:manifest",
        artifactKind: "STRUCTURED_RESPONSE",
        mediaType: "application/json",
        capturedAt,
        bytes: manifestBytes,
      }),
    ]);
    return { rawAnswerArtifactId, allIds: [rawAnswerArtifactId, ...remainingIds] };
  }

  private async failExecution(error: unknown): Promise<void> {
    const operationalError =
      error instanceof WebSurfaceExecutionError
        ? { kind: error.kind, retryable: error.retryable, message: error.message }
        : {
            kind: "CORE_BOUND_EXECUTION_FAILED",
            retryable: false,
            message: safeErrorMessage(error),
          };
    await this.dependencies.core.fail({ operationalError });
  }
}

function requireCanonicalAssignment(
  request: WebSurfaceExecutionRequest,
  adapter: WebSurfaceAdapter,
  assignment: Awaited<ReturnType<CoreExecutionClient["getAssignment"]>>,
): void {
  const promptSha256 = createHash("sha256").update(request.promptText, "utf8").digest("hex");
  if (
    assignment.execution_run_id !== request.executionRunId ||
    assignment.question_version_id !== request.questionVersionId ||
    assignment.prompt_text !== request.promptText ||
    assignment.submitted_prompt_sha256 !== promptSha256 ||
    assignment.locale !== request.locale ||
    assignment.planned_platform !== adapter.platform ||
    assignment.planned_surface !== adapter.surface ||
    (assignment.region !== null && assignment.region !== request.region)
  ) {
    throw new Error("Core Execution assignment does not match the Web execution request");
  }
}

function candidateCommandFor(
  result: WebSurfaceExecutionResult,
  evidenceArtifactIds: readonly string[],
  decision: CandidateDecision,
): CreateObservationCandidateInput {
  return {
    executionRunId: result.executionRunId,
    responseOutcomeKind: decision.responseOutcomeKind,
    representation: decision.representation,
    correlationStatus: decision.correlationStatus,
    targetSurfaceReached: true,
    targetQuestionSubmitted: true,
    visibleResponseOutcomeObserved: true,
    lifecycleAssociated: true,
    existenceBasis: {
      kind: decision.existenceBasisKind,
      questionSubmittedAt: result.questionSubmittedAt.toISOString(),
      detectorVersion: decision.detectorVersion,
      conversationMarker: result.questionResponseBinding.userMessageId,
      responseMarker: result.questionResponseBinding.assistantMessageId,
      evidenceArtifactIds: [...evidenceArtifactIds],
    },
    responseStartedAt: result.responseStartedAt.toISOString(),
    responseLastSeenAt: result.responseLastSeenAt.toISOString(),
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJson(nested)]),
    );
  }
  return value;
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Core-bound execution failure";
}
