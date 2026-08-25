import { z } from "zod";

const claimResponseSchema = z.object({
  data: z.object({
    execution_run_id: z.uuid(),
    operational_status: z.enum(["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]),
    response_outcome_kind: z.string().nullable(),
    completed_at: z.iso.datetime({ offset: true }).nullable(),
    observation_candidate_id: z.uuid().nullable(),
    raw_observation_id: z.uuid().nullable(),
    token: z.string().min(1),
  }),
});

export type ExecutionWorkerClaim = z.infer<typeof claimResponseSchema>["data"];

export interface CoreWorkerClientOptions {
  readonly baseUrl: string;
  readonly workerToken: string;
  readonly fetch?: typeof globalThis.fetch;
}

export class CoreWorkerClient {
  private readonly baseUrl: string;
  private readonly workerToken: string;
  private readonly fetchImplementation: typeof globalThis.fetch;

  public constructor(options: CoreWorkerClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/u, "");
    this.workerToken = z.string().min(32).parse(options.workerToken);
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }

  public async claim(input: {
    readonly tenantId: string;
    readonly executionRunId: string;
    readonly eventId: string;
  }): Promise<ExecutionWorkerClaim> {
    const response = await this.fetchImplementation(
      `${this.baseUrl}/v1/internal/query-engine/execution-runs/${input.executionRunId}/claim`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.workerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ tenantId: input.tenantId, eventId: input.eventId }),
      },
    );
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Core Worker claim failed with HTTP ${response.status}`);
    }
    return claimResponseSchema.parse(payload).data;
  }
}
