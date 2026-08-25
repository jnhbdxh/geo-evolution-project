import { domainEventEnvelopeSchema } from "@geo-os/contracts";
import { z } from "zod";

import type { CoreWorkerClient, ExecutionWorkerClaim } from "./core-worker-client.js";

const executionQueuedEnvelopeSchema = domainEventEnvelopeSchema.extend({
  event_type: z.literal("ExecutionQueued"),
  schema_version: z.literal(1),
  tenant_id: z.uuid(),
  aggregate_type: z.literal("ExecutionRun"),
  data: z
    .object({
      execution_run_id: z.uuid(),
      question_version_id: z.uuid(),
    })
    .passthrough(),
});

export interface ExecutionQueuedJobData {
  readonly envelope: unknown;
  readonly headers: Readonly<Record<string, unknown>>;
}

export type ExecutionQueuedJobResult<TResult> =
  | { readonly kind: "executed"; readonly result: TResult }
  | { readonly kind: "already_accepted"; readonly claim: ExecutionWorkerClaim };

export class ExecutionRequiresRecoveryError extends Error {
  public constructor(
    public readonly executionRunId: string,
    public readonly operationalStatus: ExecutionWorkerClaim["operational_status"],
  ) {
    super(`ExecutionRun ${executionRunId} requires recovery before queue acknowledgement`);
    this.name = "ExecutionRequiresRecoveryError";
  }
}

export class ExecutionClaimMismatchError extends Error {
  public constructor() {
    super("Core claim does not match the queued ExecutionRun");
    this.name = "ExecutionClaimMismatchError";
  }
}

export async function handleExecutionQueuedJob<TResult>(input: {
  readonly job: ExecutionQueuedJobData;
  readonly core: Pick<CoreWorkerClient, "claim">;
  readonly execute: (input: {
    readonly token: string;
    readonly envelope: z.infer<typeof executionQueuedEnvelopeSchema>;
  }) => Promise<TResult>;
}): Promise<ExecutionQueuedJobResult<TResult>> {
  const envelope = executionQueuedEnvelopeSchema.parse(input.job.envelope);
  if (envelope.aggregate_id !== envelope.data.execution_run_id) {
    throw new Error("ExecutionQueued aggregate does not match its payload");
  }
  const claim = await input.core.claim({
    tenantId: envelope.tenant_id,
    executionRunId: envelope.aggregate_id,
    eventId: envelope.event_id,
  });
  if (claim.execution_run_id !== envelope.aggregate_id) {
    throw new ExecutionClaimMismatchError();
  }

  if (claim.operational_status === "QUEUED") {
    return {
      kind: "executed",
      result: await input.execute({ token: claim.token, envelope }),
    };
  }
  if (
    claim.operational_status === "RUNNING" ||
    (claim.observation_candidate_id !== null && claim.raw_observation_id === null)
  ) {
    throw new ExecutionRequiresRecoveryError(claim.execution_run_id, claim.operational_status);
  }
  return { kind: "already_accepted", claim };
}
