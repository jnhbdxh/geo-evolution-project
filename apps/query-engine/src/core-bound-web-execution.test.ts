import { describe, expect, it, vi } from "vitest";

import { CoreBoundWebExecution } from "./core-bound-web-execution.js";
import { CoreExecutionClient, CoreExecutionCommandError } from "./core-execution-client.js";
import type {
  WebSurfaceAdapter,
  WebSurfaceExecutionLifecycle,
  WebSurfaceExecutionRequest,
  WebSurfaceExecutionResult,
} from "./web-surface-adapter.js";

const executionRunId = "11111111-1111-4111-8111-111111111111";
const questionVersionId = "22222222-2222-4222-8222-222222222222";
const traceId = "33333333-3333-4333-8333-333333333333";

describe("Core-bound Web execution", () => {
  it("starts Core before submission and completes Capture → Candidate → terminal → Finalize", async () => {
    const events: string[] = [];
    let artifactNumber = 3;
    const fetchImplementation = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      const command = url.split("/").at(-1) ?? "unknown";
      events.push(command);
      expect(init?.headers).toMatchObject({
        authorization: "Bearer scoped-token",
        "x-geo-os-trace-id": traceId,
      });
      if (command === "assignment") {
        return jsonResponse({ data: executionAssignment() });
      }
      if (command === "capture-artifacts") {
        artifactNumber += 1;
        return jsonResponse({ data: { id: uuidWithSuffix(artifactNumber) } }, 201);
      }
      if (command === "observation-candidates") {
        return jsonResponse({ data: { id: uuidWithSuffix(9) } }, 201);
      }
      if (command === "finalize") {
        return jsonResponse({ data: { id: uuidWithSuffix(10) } }, 201);
      }
      return jsonResponse({ data: { id: executionRunId } });
    });
    const adapter = new LifecycleAwareAdapter(events);
    const core = new CoreExecutionClient({
      baseUrl: "http://core.local/",
      executionRunId,
      token: "scoped-token",
      traceId,
      fetch: fetchImplementation as typeof fetch,
    });
    const runner = new CoreBoundWebExecution({
      adapter,
      core,
      decideCandidate: () => ({
        responseOutcomeKind: "ANSWER",
        representation: "TEXT",
        correlationStatus: "CONFIRMED",
        existenceBasisKind: "VISIBLE_TEXT_RESPONSE",
        detectorVersion: "answer-outcome/v1",
      }),
    });

    const result = await runner.run(executionRequest());

    expect(events).toEqual([
      "assignment",
      "start",
      "submit-question",
      "capture-artifacts",
      "capture-artifacts",
      "capture-artifacts",
      "capture-artifacts",
      "capture-artifacts",
      "observation-candidates",
      "complete",
      "finalize",
    ]);
    expect(result.captureArtifactIds).toHaveLength(5);
    expect(result.observationCandidateId).toBe(uuidWithSuffix(9));
    expect(result.rawObservationId).toBe(uuidWithSuffix(10));

    const requests = fetchImplementation.mock.calls
      .filter((call) => call[1]?.body !== undefined)
      .map((call) => ({
        url: requestUrl(call[0]),
        body: JSON.parse(requestBodyText(call[1]?.body)) as Record<string, unknown>,
      }));
    expect(requests[0]?.body).toMatchObject({
      actualPlatform: "doubao",
      actualModel: "豆包 快速",
      actualSurface: "doubao_web",
    });
    const rawUpload = requests.find(
      (request) => request.body.idempotencyKey === "core-bound-v1:raw-response",
    );
    expect(rawUpload?.body).toMatchObject({
      artifactKind: "RAW_RESPONSE",
      bytesBase64: Buffer.from("visible answer", "utf8").toString("base64"),
    });
    expect(requests.at(-1)?.body).toMatchObject({
      observationCandidateId: uuidWithSuffix(9),
      rawAnswerArtifactId: uuidWithSuffix(4),
    });
  });

  it("records a failed ExecutionRun when the Web surface fails", async () => {
    const commands: string[] = [];
    const core = new CoreExecutionClient({
      baseUrl: "http://core.local",
      executionRunId,
      token: "scoped-token",
      traceId,
      fetch: (async (input) => {
        const command = requestUrl(input).split("/").at(-1) ?? "unknown";
        commands.push(command);
        if (command === "assignment") return jsonResponse({ data: executionAssignment() });
        return jsonResponse({ data: { id: executionRunId } });
      }) as typeof fetch,
    });
    const adapter: WebSurfaceAdapter = {
      platform: "doubao",
      surface: "doubao_web",
      async execute() {
        throw new Error("browser unavailable");
      },
    };
    const runner = new CoreBoundWebExecution({
      adapter,
      core,
      decideCandidate: () => {
        throw new Error("not reached");
      },
    });

    await expect(runner.run(executionRequest())).rejects.toThrow("browser unavailable");
    expect(commands).toEqual(["assignment", "fail"]);
  });
});

describe("CoreExecutionClient", () => {
  it("does not hide a rejected Core command", async () => {
    const core = new CoreExecutionClient({
      baseUrl: "http://core.local",
      executionRunId,
      token: "scoped-token",
      traceId,
      fetch: (async () => jsonResponse({ error: { code: "FORBIDDEN" } }, 403)) as typeof fetch,
    });

    const error = await core.start(runtimeContext()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CoreExecutionCommandError);
    expect(error).toMatchObject({ statusCode: 403, command: "start" });
  });
});

class LifecycleAwareAdapter implements WebSurfaceAdapter {
  public readonly platform = "doubao";
  public readonly surface = "doubao_web";

  public constructor(private readonly events: string[]) {}

  public async execute(
    request: WebSurfaceExecutionRequest,
    lifecycle?: WebSurfaceExecutionLifecycle,
  ): Promise<WebSurfaceExecutionResult> {
    await lifecycle?.onRuntimeReady(runtimeContext());
    this.events.push("submit-question");
    const now = new Date("2026-08-22T08:00:00.000Z");
    return {
      executionRunId: request.executionRunId,
      questionVersionId: request.questionVersionId,
      ...runtimeContext(),
      questionSubmittedAt: now,
      responseStartedAt: new Date(now.getTime() + 1_000),
      responseLastSeenAt: new Date(now.getTime() + 2_000),
      completedAt: new Date(now.getTime() + 3_000),
      questionResponseBinding: {
        submittedPromptRaw: request.promptText,
        submittedPromptSha256: "a".repeat(64),
        visibleUserMessageText: request.promptText,
        userMessageId: "user-message-1",
        userMessageSequence: 1,
        assistantMessageId: "assistant-message-1",
        assistantMessageSequence: 2,
      },
      uiTruth: {
        responseText: "visible answer",
        responseHtmlBytes: new TextEncoder().encode("<p>visible answer</p>"),
        responseScreenshotBytes: new Uint8Array([1, 2, 3]),
        viewportScreenshotBytes: new Uint8Array([4, 5, 6]),
        visibleLinkCandidates: [],
      },
    };
  }
}

function executionRequest(): WebSurfaceExecutionRequest {
  return {
    executionRunId,
    questionVersionId,
    identityId: "doubao-identity-1",
    promptText: "test question",
    locale: "zh-CN",
    region: "CN",
  };
}

function executionAssignment() {
  return {
    execution_run_id: executionRunId,
    question_version_id: questionVersionId,
    prompt_text: "test question",
    submitted_prompt_sha256: "9f74ee7f5aa53ad4c6a414ef9dd66ca9d2f3519d57e18955a9006b2b07458e85",
    locale: "zh-CN",
    planned_platform: "doubao",
    planned_model: "豆包 快速",
    planned_surface: "doubao_web",
    region: "CN",
    planned_context: {},
  };
}

function runtimeContext() {
  return {
    actualPlatform: "doubao",
    actualModel: "豆包 快速",
    actualSurface: "doubao_web",
    executionContextSnapshot: { capability_version: "doubao-test/v1" },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function uuidWithSuffix(suffix: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${suffix.toString().padStart(12, "0")}`;
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function requestBodyText(body: BodyInit | null | undefined): string {
  if (typeof body !== "string") throw new Error("Expected a JSON string request body");
  return body;
}
