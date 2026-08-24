import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";

import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveBrowserExecutablePath } from "./browser-runtime.js";
import { DoubaoWebAdapter } from "./doubao-web-adapter.js";
import { doubaoWebCapabilityV20260822, type DoubaoWebCapability } from "./doubao-web-capability.js";
import { WebSurfaceExecutionError } from "./web-surface-adapter.js";

let browser: Browser | undefined;
let server: Server | undefined;
let origin: string;

beforeAll(async () => {
  const executablePath = resolveBrowserExecutablePath();
  browser = await chromium.launch({
    headless: true,
    ...(executablePath === undefined ? {} : { executablePath }),
  });
  const createdServer = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (request.url === "/login") {
      response.end('<button type="button">登录</button>');
      return;
    }
    response.end(
      fixtureHtml({
        contaminatedConversation: request.url === "/contaminated",
        formattedUserMessage: request.url === "/formatted-user-message",
        humanVerification: request.url === "/human-verification",
        humanVerificationBeforeUser: request.url === "/human-verification-before-user",
        noUserMessage: request.url === "/no-user-message",
        noResponse: request.url === "/no-response",
        secondUserBeforeAssistant: request.url === "/second-user-before-assistant",
        systemBeforeAssistant: request.url === "/system-before-assistant",
      }),
    );
  });
  server = createdServer;
  await new Promise<void>((resolve) => createdServer.listen(0, "127.0.0.1", resolve));
  const address = createdServer.address();
  if (address === null || typeof address === "string") throw new Error("Test server has no port");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await browser?.close();
  if (server !== undefined) {
    await new Promise<void>((resolve, reject) =>
      server?.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

describe("Doubao Web Playwright adapter", () => {
  it("submits in a new conversation and captures only visible UI truth", async () => {
    const context = await getBrowser().newContext({ viewport: { width: 900, height: 700 } });
    const page = await context.newPage();
    const adapter = new DoubaoWebAdapter({ page, capability: testCapability("/") });

    const result = await adapter.execute(executionRequest());

    expect(result).toMatchObject({
      actualPlatform: "doubao",
      actualModel: "DOUBAO_WEB_ROUTING_UNDISCLOSED",
      actualSurface: "doubao_web",
      questionResponseBinding: {
        submittedPromptRaw: executionRequest().promptText,
        submittedPromptSha256: createHash("sha256")
          .update(executionRequest().promptText, "utf8")
          .digest("hex"),
        visibleUserMessageText: executionRequest().promptText,
        userMessageId: "user-1",
        userMessageSequence: 1,
        assistantMessageId: "assistant-1",
        assistantMessageSequence: 2,
      },
      uiTruth: {
        responseText: "可见回答正文\n来源一",
        visibleLinkCandidates: [
          { visibleText: "来源一", observedHref: "https://source.example/article" },
        ],
      },
      executionContextSnapshot: {
        capability_version: "doubao-web/test-fixture",
        conversation_mode: "fresh_entry_url",
        model_disclosure: "UNDISCLOSED",
      },
    });
    expect(new TextDecoder().decode(result.uiTruth.responseHtmlBytes)).toContain(
      'data-response-kind="assistant"',
    );
    expect(result.uiTruth.responseScreenshotBytes.byteLength).toBeGreaterThan(1_000);
    expect(result.uiTruth.viewportScreenshotBytes.byteLength).toBeGreaterThan(1_000);
    expect(
      await page.locator('[data-plugin-identifier="block_type:10000"].justify-end').innerText(),
    ).toBe(executionRequest().promptText);
    expect(await page.locator("#conversation-title").innerText()).not.toBe(
      result.questionResponseBinding.submittedPromptRaw,
    );
    await context.close();
  });

  it("reports runtime context to Core before the visible question is submitted", async () => {
    const context = await getBrowser().newContext();
    const page = await context.newPage();
    const adapter = new DoubaoWebAdapter({ page, capability: testCapability("/") });
    let runtimeReady = false;

    await adapter.execute(executionRequest(), {
      onRuntimeReady: async (runtime) => {
        runtimeReady = true;
        expect(runtime).toMatchObject({
          actualPlatform: "doubao",
          actualSurface: "doubao_web",
          actualModel: "DOUBAO_WEB_ROUTING_UNDISCLOSED",
        });
        expect(await page.locator("[data-message-id]").count()).toBe(0);
        expect(await page.locator('[role="textbox"]').innerText()).toBe("");
      },
    });

    expect(runtimeReady).toBe(true);
    expect(await page.locator('[data-message-id="user-1"]').count()).toBe(1);
    await context.close();
  });

  it("preserves submitted prompt and formatted visible user-message facts separately", async () => {
    const context = await getBrowser().newContext();
    const page = await context.newPage();
    const adapter = new DoubaoWebAdapter({
      page,
      capability: testCapability("/formatted-user-message"),
    });

    const result = await adapter.execute(executionRequest());

    expect(result.questionResponseBinding).toMatchObject({
      submittedPromptRaw: "请回答这个测试问题",
      visibleUserMessageText: "请回答这个\n测试问题",
      userMessageId: "user-1",
      assistantMessageId: "assistant-1",
    });
    await context.close();
  });

  it("rejects submission when no new visible user message is created", async () => {
    const context = await getBrowser().newContext();
    const page = await context.newPage();
    const adapter = new DoubaoWebAdapter({
      page,
      capability: testCapability("/no-user-message"),
    });

    const error = await captureExecutionError(() => adapter.execute(executionRequest()));

    expect(error).toMatchObject({ kind: "USER_MESSAGE_NOT_OBSERVED", retryable: false });
    await context.close();
  });

  it("ignores an intervening system message and binds the later assistant response", async () => {
    const context = await getBrowser().newContext();
    const page = await context.newPage();
    const adapter = new DoubaoWebAdapter({
      page,
      capability: testCapability("/system-before-assistant"),
    });

    const result = await adapter.execute(executionRequest());

    expect(result.uiTruth.responseText).toBe("可见回答正文\n来源一");
    expect(result.questionResponseBinding).toMatchObject({
      userMessageSequence: 1,
      assistantMessageId: "assistant-1",
      assistantMessageSequence: 3,
    });
    expect(result.questionResponseBinding.assistantMessageSequence).toBeGreaterThan(
      result.questionResponseBinding.userMessageSequence,
    );
    await context.close();
  });

  it("rejects concurrent use of one adapter identity lease", async () => {
    const context = await getBrowser().newContext();
    const page = await context.newPage();
    const adapter = new DoubaoWebAdapter({ page, capability: testCapability("/") });

    const first = adapter.execute(executionRequest());
    const secondError = await captureExecutionError(() => adapter.execute(executionRequest()));

    expect(secondError).toMatchObject({ kind: "IDENTITY_BUSY", retryable: true });
    await first;
    await context.close();
  });

  it("distinguishes authentication from generic navigation failure", async () => {
    const context = await getBrowser().newContext();
    const page = await context.newPage();
    const adapter = new DoubaoWebAdapter({ page, capability: testCapability("/login") });

    const error = await captureExecutionError(() => adapter.execute(executionRequest()));

    expect(error).toMatchObject({ kind: "AUTHENTICATION_REQUIRED", retryable: false });
    await context.close();
  });

  it("keeps an execution without visible AI output as an operational failure", async () => {
    const context = await getBrowser().newContext();
    const page = await context.newPage();
    const adapter = new DoubaoWebAdapter({ page, capability: testCapability("/no-response") });

    const error = await captureExecutionError(() => adapter.execute(executionRequest()));

    expect(error).toMatchObject({ kind: "NO_VISIBLE_RESPONSE", retryable: true });
    await context.close();
  });

  it("classifies human verification as an operational boundary, not an AI response", async () => {
    const context = await getBrowser().newContext();
    const page = await context.newPage();
    const adapter = new DoubaoWebAdapter({
      page,
      capability: testCapability("/human-verification"),
    });

    const error = await captureExecutionError(() => adapter.execute(executionRequest()));

    expect(error).toMatchObject({ kind: "HUMAN_VERIFICATION_REQUIRED", retryable: false });
    await context.close();
  });

  it("classifies human verification before a user-message node instead of misreporting submission", async () => {
    const context = await getBrowser().newContext();
    const page = await context.newPage();
    const adapter = new DoubaoWebAdapter({
      page,
      capability: testCapability("/human-verification-before-user"),
    });

    const error = await captureExecutionError(() => adapter.execute(executionRequest()));

    expect(error).toMatchObject({ kind: "HUMAN_VERIFICATION_REQUIRED", retryable: false });
    await context.close();
  });

  it("rejects a second user message before the assistant response as ambiguous", async () => {
    const context = await getBrowser().newContext();
    const page = await context.newPage();
    const adapter = new DoubaoWebAdapter({
      page,
      capability: testCapability("/second-user-before-assistant"),
    });

    const error = await captureExecutionError(() => adapter.execute(executionRequest()));

    expect(error).toMatchObject({
      kind: "QUESTION_RESPONSE_BINDING_FAILED",
      retryable: false,
    });
    await context.close();
  });

  it("refuses to contaminate a formal execution when a new conversation cannot be proven", async () => {
    const context = await getBrowser().newContext();
    const page = await context.newPage();
    const adapter = new DoubaoWebAdapter({
      page,
      capability: testCapability("/contaminated"),
    });

    const error = await captureExecutionError(() => adapter.execute(executionRequest()));

    expect(error).toMatchObject({ kind: "CAPABILITY_DRIFT", retryable: false });
    await context.close();
  });
});

function testCapability(path: string): DoubaoWebCapability {
  return {
    ...doubaoWebCapabilityV20260822,
    capabilityVersion: "doubao-web/test-fixture",
    entryUrl: `${origin}${path}`,
    timing: {
      navigationTimeoutMs: 300,
      responseStartTimeoutMs: 300,
      responseCompletionTimeoutMs: 1_000,
      responseQuietWindowMs: 30,
      pollIntervalMs: 10,
    },
  };
}

function getBrowser(): Browser {
  if (browser === undefined) throw new Error("Browser did not start");
  return browser;
}

function executionRequest() {
  return {
    executionRunId: "1ee5b1b0-99f4-4c4e-8bb3-77118069fda9",
    questionVersionId: "f3dbd455-c334-41d2-94d2-3930aa33a58d",
    identityId: "doubao-test-identity",
    promptText: "请回答这个测试问题",
    locale: "zh-CN",
    region: "CN",
  } as const;
}

async function captureExecutionError(
  operation: () => Promise<unknown>,
): Promise<WebSurfaceExecutionError> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(WebSurfaceExecutionError);
    return error as WebSurfaceExecutionError;
  }
  throw new Error("Expected WebSurfaceExecutionError");
}

function fixtureHtml(options: {
  readonly contaminatedConversation: boolean;
  readonly formattedUserMessage: boolean;
  readonly humanVerification: boolean;
  readonly humanVerificationBeforeUser: boolean;
  readonly noUserMessage: boolean;
  readonly noResponse: boolean;
  readonly secondUserBeforeAssistant: boolean;
  readonly systemBeforeAssistant: boolean;
}): string {
  return `<!doctype html>
<html lang="zh-CN">
  <body>
    <aside id="conversation-title">问题的自动摘要标题</aside>
    <div role="textbox" contenteditable="true"></div>
    <button class="bg-g-send-msg-btn-bg" type="button">发送</button>
    <main id="messages">${
      options.contaminatedConversation
        ? '<section data-message-id="old-assistant">旧对话内容</section>'
        : ""
    }</main>
    <script>
      const messages = document.querySelector('#messages');
      const input = document.querySelector('[role="textbox"]');
      document.querySelector('button[class*="bg-g-send-msg-btn-bg"]').onclick = () => {
        ${
          options.humanVerificationBeforeUser
            ? `const earlyVerification = document.createElement('div');
        earlyVerification.textContent = '请选择所有符合上述描述的图片';
        document.body.appendChild(earlyVerification);
        return;`
            : ""
        }
        ${options.noUserMessage ? "return;" : ""}
        const user = document.createElement('section');
        user.dataset.messageId = 'user-1';
        user.innerHTML = '<div class="justify-end" data-plugin-identifier="block_type:10000"></div>';
        ${
          options.formattedUserMessage
            ? "user.firstElementChild.innerHTML = '请回答这个<br>测试问题';"
            : "user.firstElementChild.textContent = input.innerText;"
        }
        messages.appendChild(user);
        ${
          options.secondUserBeforeAssistant
            ? `const secondUser = document.createElement('section');
        secondUser.dataset.messageId = 'user-2';
        secondUser.innerHTML = '<div class="justify-end" data-plugin-identifier="block_type:10000">另一条用户消息</div>';
        messages.appendChild(secondUser);`
            : ""
        }
        ${
          options.humanVerification
            ? `const verification = document.createElement('div');
        verification.textContent = '请选择所有符合上述描述的图片';
        document.body.appendChild(verification);`
            : options.noResponse
              ? ""
              : `${
                  options.systemBeforeAssistant
                    ? `const system = document.createElement('section');
        system.dataset.messageId = 'system-1';
        system.textContent = '系统提示：正在处理';
        messages.appendChild(system);`
                    : ""
                }
        const assistant = document.createElement('section');
        assistant.dataset.messageId = 'assistant-1';
        assistant.dataset.responseKind = 'assistant';
        assistant.innerHTML = '<article class="md-box-root" data-streaming="true">可见回答正文<br><a href="https://source.example/article">来源一</a></article>';
        messages.appendChild(assistant);
        setTimeout(() => assistant.firstElementChild.dataset.streaming = 'false', 30);`
        }
      };
    </script>
  </body>
</html>`;
}
