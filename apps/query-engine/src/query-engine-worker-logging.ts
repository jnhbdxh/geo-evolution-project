import { domainEventEnvelopeSchema } from "@geo-os/contracts";
import { ZodError } from "zod";

import {
  ExecutionClaimMismatchError,
  ExecutionRequiresRecoveryError,
} from "./execution-queued-job.js";

export interface WorkerJobForLogging {
  readonly id?: string;
  readonly name: string;
  readonly data?: unknown;
}

export function executionJobLogFields(
  job: WorkerJobForLogging | undefined,
): Readonly<Record<string, unknown>> {
  const envelope = readEnvelope(job?.data);
  return {
    job_id: job?.id,
    event_type: job?.name,
    trace_id: envelope?.trace_id,
    event_id: envelope?.event_id,
    execution_run_id: envelope?.aggregate_id,
  };
}

export function classifyExecutionJobError(error: unknown): string {
  if (error instanceof ExecutionRequiresRecoveryError) return "EXECUTION_REQUIRES_RECOVERY";
  if (error instanceof ExecutionClaimMismatchError) return "CORE_CLAIM_MISMATCH";
  if (error instanceof ZodError) return "INVALID_EXECUTION_JOB";
  return "QUERY_EXECUTION_FAILED";
}

function readEnvelope(data: unknown) {
  if (typeof data !== "object" || data === null || !("envelope" in data)) return undefined;
  const parsed = domainEventEnvelopeSchema.safeParse(data.envelope);
  return parsed.success ? parsed.data : undefined;
}
