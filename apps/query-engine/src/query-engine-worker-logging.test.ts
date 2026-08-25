import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ExecutionClaimMismatchError,
  ExecutionRequiresRecoveryError,
} from "./execution-queued-job.js";
import { classifyExecutionJobError, executionJobLogFields } from "./query-engine-worker-logging.js";

describe("Query Engine Worker logging", () => {
  it("emits the execution correlation fields without logging the payload", () => {
    const executionRunId = randomUUID();
    const eventId = randomUUID();
    const traceId = randomUUID();

    expect(
      executionJobLogFields({
        id: eventId,
        name: "ExecutionQueued",
        data: {
          envelope: {
            event_id: eventId,
            event_type: "ExecutionQueued",
            tenant_id: randomUUID(),
            aggregate_type: "ExecutionRun",
            aggregate_id: executionRunId,
            schema_version: 1,
            occurred_at: new Date().toISOString(),
            trace_id: traceId,
            data: { prompt_text: "must not be logged" },
          },
        },
      }),
    ).toEqual({
      job_id: eventId,
      event_type: "ExecutionQueued",
      trace_id: traceId,
      event_id: eventId,
      execution_run_id: executionRunId,
    });
  });

  it("uses stable sanitized failure categories", () => {
    expect(
      classifyExecutionJobError(new ExecutionRequiresRecoveryError(randomUUID(), "RUNNING")),
    ).toBe("EXECUTION_REQUIRES_RECOVERY");
    expect(classifyExecutionJobError(new ExecutionClaimMismatchError())).toBe(
      "CORE_CLAIM_MISMATCH",
    );
    expect(classifyExecutionJobError(new z.ZodError([]))).toBe("INVALID_EXECUTION_JOB");
    expect(classifyExecutionJobError(new Error("sensitive provider response"))).toBe(
      "QUERY_EXECUTION_FAILED",
    );
  });
});
