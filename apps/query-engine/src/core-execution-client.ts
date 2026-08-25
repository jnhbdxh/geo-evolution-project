import { createHash } from "node:crypto";

import type {
  CompleteExecutionRunInput,
  CreateObservationCandidateInput,
  ExecutionResponseOutcomeKind,
  FailExecutionRunInput,
  FinalizeObservationInput,
  StartExecutionRunInput,
} from "@geo-os/contracts";
import { z } from "zod";

const idResponseSchema = z.object({ data: z.object({ id: z.uuid() }).passthrough() });
const rowResponseSchema = z.object({ data: z.record(z.string(), z.unknown()) });
const assignmentResponseSchema = z.object({
  data: z.object({
    execution_run_id: z.uuid(),
    question_version_id: z.uuid(),
    prompt_text: z.string().min(1),
    submitted_prompt_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    locale: z.string().min(1),
    planned_platform: z.string().min(1),
    planned_model: z.string().min(1),
    planned_surface: z.string().min(1),
    region: z.string().nullable(),
    planned_context: z.record(z.string(), z.unknown()),
  }),
});

export type CoreExecutionAssignment = z.infer<typeof assignmentResponseSchema>["data"];

export interface CoreCaptureInput {
  readonly idempotencyKey: string;
  readonly artifactKind: "RAW_RESPONSE" | "SCREENSHOT" | "STRUCTURED_RESPONSE" | "TRACE";
  readonly mediaType: string;
  readonly capturedAt: Date;
  readonly bytes: Uint8Array;
}

export interface CoreExecutionClientOptions {
  readonly baseUrl: string;
  readonly executionRunId: string;
  readonly token: string;
  readonly traceId: string;
  readonly fetch?: typeof globalThis.fetch;
}

export class CoreExecutionClient {
  private readonly baseUrl: string;
  private readonly executionRunId: string;
  private readonly token: string;
  private readonly traceId: string;
  private readonly fetchImplementation: typeof globalThis.fetch;

  public constructor(options: CoreExecutionClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/u, "");
    this.executionRunId = z.uuid().parse(options.executionRunId);
    this.token = z.string().min(1).parse(options.token);
    this.traceId = z.uuid().parse(options.traceId);
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }

  public async start(input: StartExecutionRunInput): Promise<void> {
    await this.command("start", input, rowResponseSchema);
  }

  public async getAssignment(): Promise<CoreExecutionAssignment> {
    const response = await this.request("assignment", "GET", undefined, assignmentResponseSchema);
    return response.data;
  }

  public async capture(input: CoreCaptureInput): Promise<string> {
    const response = await this.command(
      "capture-artifacts",
      {
        idempotencyKey: input.idempotencyKey,
        artifactKind: input.artifactKind,
        mediaType: input.mediaType,
        capturedAt: input.capturedAt.toISOString(),
        declaredSha256: sha256Bytes(input.bytes),
        bytesBase64: Buffer.from(input.bytes).toString("base64"),
      },
      idResponseSchema,
    );
    return response.data.id;
  }

  public async createCandidate(input: CreateObservationCandidateInput): Promise<string> {
    const response = await this.command("observation-candidates", input, idResponseSchema);
    return response.data.id;
  }

  public async complete(input: CompleteExecutionRunInput): Promise<void> {
    await this.command("complete", input, rowResponseSchema);
  }

  public async fail(input: FailExecutionRunInput): Promise<void> {
    await this.command("fail", input, rowResponseSchema);
  }

  public async finalize(input: FinalizeObservationInput): Promise<string> {
    const response = await this.command("finalize", input, idResponseSchema);
    return response.data.id;
  }

  private async command<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    return this.request(path, "POST", body, schema);
  }

  private async request<T>(
    path: string,
    method: "GET" | "POST",
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const response = await this.fetchImplementation(
      `${this.baseUrl}/v1/internal/execution-runs/${this.executionRunId}/${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          "x-geo-os-trace-id": this.traceId,
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      },
    );
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new CoreExecutionCommandError(response.status, path, payload);
    }
    return schema.parse(payload);
  }
}

export class CoreExecutionCommandError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly command: string,
    public readonly responseBody: unknown,
  ) {
    super(`Core execution command '${command}' failed with HTTP ${statusCode}`);
    this.name = "CoreExecutionCommandError";
  }
}

export interface CandidateDecision {
  readonly responseOutcomeKind: ExecutionResponseOutcomeKind;
  readonly representation: CreateObservationCandidateInput["representation"];
  readonly correlationStatus: CreateObservationCandidateInput["correlationStatus"];
  readonly existenceBasisKind: CreateObservationCandidateInput["existenceBasis"]["kind"];
  readonly detectorVersion: string;
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
