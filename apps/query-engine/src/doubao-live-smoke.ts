import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import { resolveBrowserExecutablePath } from "./browser-runtime.js";
import { loadQueryEngineConfig } from "./config.js";
import { DoubaoWebAdapter } from "./doubao-web-adapter.js";
import { doubaoWebCapabilityV20260822 } from "./doubao-web-capability.js";

const promptText = process.env.DOUBAO_TEST_PROMPT?.trim();
if (!promptText) throw new Error("DOUBAO_TEST_PROMPT is required");

const outputDirectory = path.resolve(
  process.env.QUERY_ENGINE_SMOKE_OUTPUT_DIR ?? ".codex-tmp/query-engine-smoke/doubao",
);
const config = loadQueryEngineConfig();
await readFile(config.DOUBAO_STORAGE_STATE_PATH);
const browserExecutablePath = resolveBrowserExecutablePath(
  config.QUERY_ENGINE_BROWSER_EXECUTABLE_PATH,
);

const browser = await chromium.launch({
  headless: config.QUERY_ENGINE_HEADLESS,
  ...(browserExecutablePath === undefined ? {} : { executablePath: browserExecutablePath }),
});
try {
  const context = await browser.newContext({
    storageState: config.DOUBAO_STORAGE_STATE_PATH,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const adapter = new DoubaoWebAdapter({
    page,
    interactiveVerificationTimeoutMs: config.DOUBAO_INTERACTIVE_VERIFICATION_TIMEOUT_MS,
    capability: {
      ...doubaoWebCapabilityV20260822,
      entryUrl: config.DOUBAO_ENTRY_URL,
    },
  });
  const request = {
    executionRunId: crypto.randomUUID(),
    questionVersionId: crypto.randomUUID(),
    identityId: "authorized-doubao-smoke-identity",
    promptText,
    locale: "zh-CN",
    region: "CN",
  } as const;
  const result = await adapter.execute(request);
  const promptBytes = new TextEncoder().encode(promptText);
  const responseTextBytes = new TextEncoder().encode(result.uiTruth.responseText);

  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDirectory, "response.html"), result.uiTruth.responseHtmlBytes),
    writeFile(
      path.join(outputDirectory, "response-screenshot.png"),
      result.uiTruth.responseScreenshotBytes,
    ),
    writeFile(
      path.join(outputDirectory, "viewport-screenshot.png"),
      result.uiTruth.viewportScreenshotBytes,
    ),
    writeFile(
      path.join(outputDirectory, "manifest.json"),
      `${JSON.stringify(
        {
          manifest_schema_version: "doubao-web-golden-query/1.0",
          execution_run_id: result.executionRunId,
          question_version_id: result.questionVersionId,
          actual_platform: result.actualPlatform,
          actual_model: result.actualModel,
          actual_surface: result.actualSurface,
          question_submitted_at: result.questionSubmittedAt.toISOString(),
          response_started_at: result.responseStartedAt.toISOString(),
          response_last_seen_at: result.responseLastSeenAt.toISOString(),
          completed_at: result.completedAt.toISOString(),
          question_response_binding: {
            submitted_prompt_raw: result.questionResponseBinding.submittedPromptRaw,
            submitted_prompt_sha256: result.questionResponseBinding.submittedPromptSha256,
            visible_user_message_text: result.questionResponseBinding.visibleUserMessageText,
            user_message_id: result.questionResponseBinding.userMessageId,
            user_message_sequence: result.questionResponseBinding.userMessageSequence,
            assistant_message_id: result.questionResponseBinding.assistantMessageId,
            assistant_message_sequence: result.questionResponseBinding.assistantMessageSequence,
          },
          prompt: {
            byte_size: promptBytes.byteLength,
            sha256: sha256(promptBytes),
          },
          ui_truth: {
            response_text: {
              byte_size: responseTextBytes.byteLength,
              sha256: sha256(responseTextBytes),
            },
            response_html: {
              byte_size: result.uiTruth.responseHtmlBytes.byteLength,
              sha256: sha256(result.uiTruth.responseHtmlBytes),
            },
            response_screenshot: {
              byte_size: result.uiTruth.responseScreenshotBytes.byteLength,
              sha256: sha256(result.uiTruth.responseScreenshotBytes),
            },
            viewport_screenshot: {
              byte_size: result.uiTruth.viewportScreenshotBytes.byteLength,
              sha256: sha256(result.uiTruth.viewportScreenshotBytes),
            },
          },
          visible_link_candidates: result.uiTruth.visibleLinkCandidates,
          execution_context_snapshot: result.executionContextSnapshot,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
  ]);
  process.stdout.write(`Doubao Web UI Truth written to ${outputDirectory}\n`);
  await context.close();
} finally {
  await browser.close();
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
