import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  ExecutionRequiresRecoveryError,
  handleExecutionQueuedJob,
} from "./execution-queued-job.js";

describe("ExecutionQueued job handling", () => {
  it("executes a queued Core assignment with a freshly claimed scoped token", async () => {
    const fixture = jobFixture();
    const claim = vi.fn(async () => workerClaim(fixture.executionRunId, "QUEUED"));
    const execute = vi.fn(async () => ({ rawObservationId: randomUUID() }));

    const result = await handleExecutionQueuedJob({
      job: fixture.job,
      core: { claim },
      execute,
    });

    expect(claim).toHaveBeenCalledWith({
      tenantId: fixture.tenantId,
      executionRunId: fixture.executionRunId,
      eventId: fixture.eventId,
      traceId: fixture.traceId,
    });
    expect(execute).toHaveBeenCalledWith({
      token: "fresh-execution-token",
      envelope: fixture.job.envelope,
    });
    expect(result.kind).toBe("executed");
  });

  it("acknowledges a duplicate only when Core already has a durable terminal result", async () => {
    const fixture = jobFixture();
    const accepted = workerClaim(fixture.executionRunId, "COMPLETED", {
      observation_candidate_id: randomUUID(),
      raw_observation_id: randomUUID(),
    });
    const execute = vi.fn();

    const result = await handleExecutionQueuedJob({
      job: fixture.job,
      core: { claim: vi.fn(async () => accepted) },
      execute,
    });

    expect(result).toEqual({ kind: "already_accepted", claim: accepted });
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not replay a running browser side effect", async () => {
    const fixture = jobFixture();

    await expect(
      handleExecutionQueuedJob({
        job: fixture.job,
        core: { claim: vi.fn(async () => workerClaim(fixture.executionRunId, "RUNNING")) },
        execute: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(ExecutionRequiresRecoveryError);
  });

  it("does not acknowledge a terminal Candidate before Observation finalization", async () => {
    const fixture = jobFixture();

    await expect(
      handleExecutionQueuedJob({
        job: fixture.job,
        core: {
          claim: vi.fn(async () =>
            workerClaim(fixture.executionRunId, "COMPLETED", {
              observation_candidate_id: randomUUID(),
            }),
          ),
        },
        execute: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(ExecutionRequiresRecoveryError);
  });

  it("rejects a Core claim for a different ExecutionRun", async () => {
    const fixture = jobFixture();
    const execute = vi.fn();

    await expect(
      handleExecutionQueuedJob({
        job: fixture.job,
        core: { claim: vi.fn(async () => workerClaim(randomUUID(), "QUEUED")) },
        execute,
      }),
    ).rejects.toThrow("Core claim does not match the queued ExecutionRun");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects an unsupported envelope version before Claim or execution", async () => {
    const fixture = jobFixture();
    const claim = vi.fn();
    const execute = vi.fn();

    await expect(
      handleExecutionQueuedJob({
        job: {
          ...fixture.job,
          envelope: { ...fixture.job.envelope, schema_version: 2 },
        },
        core: { claim },
        execute,
      }),
    ).rejects.toThrow();
    expect(claim).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});

function jobFixture() {
  const tenantId = randomUUID();
  const executionRunId = randomUUID();
  const eventId = randomUUID();
  const traceId = randomUUID();
  return {
    tenantId,
    executionRunId,
    eventId,
    traceId,
    job: {
      envelope: {
        event_id: eventId,
        event_type: "ExecutionQueued",
        tenant_id: tenantId,
        aggregate_type: "ExecutionRun",
        aggregate_id: executionRunId,
        schema_version: 1,
        occurred_at: new Date().toISOString(),
        trace_id: traceId,
        data: {
          execution_run_id: executionRunId,
          question_version_id: randomUUID(),
        },
      },
      headers: {},
    },
  };
}

function workerClaim(
  executionRunId: string,
  operationalStatus: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED",
  overrides: Partial<{
    observation_candidate_id: string | null;
    raw_observation_id: string | null;
  }> = {},
) {
  return {
    execution_run_id: executionRunId,
    operational_status: operationalStatus,
    response_outcome_kind: operationalStatus === "COMPLETED" ? "ANSWER" : null,
    completed_at:
      operationalStatus === "QUEUED" || operationalStatus === "RUNNING"
        ? null
        : new Date().toISOString(),
    observation_candidate_id: overrides.observation_candidate_id ?? null,
    raw_observation_id: overrides.raw_observation_id ?? null,
    token: "fresh-execution-token",
  };
}
