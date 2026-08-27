import { createHash } from "node:crypto";

import type { Locator, Page } from "playwright";

import { doubaoWebCapabilityV20260825, type DoubaoWebCapability } from "./doubao-web-capability.js";
import {
  type VisibleLinkOccurrence,
  type WebSurfaceAdapter,
  type WebSurfaceExecutionRequest,
  type WebSurfaceExecutionLifecycle,
  type WebSurfaceExecutionResult,
  WebSurfaceExecutionError,
} from "./web-surface-adapter.js";

export interface DoubaoWebAdapterDependencies {
  readonly page: Page;
  readonly capability?: DoubaoWebCapability;
  readonly now?: () => Date;
  readonly interactiveVerificationTimeoutMs?: number;
}

export class DoubaoWebAdapter implements WebSurfaceAdapter {
  public readonly platform = "doubao";
  public readonly surface = "doubao_web";

  private readonly page: Page;
  private readonly capability: DoubaoWebCapability;
  private readonly now: () => Date;
  private readonly interactiveVerificationTimeoutMs: number;
  private activeIdentityId: string | null = null;

  public constructor(dependencies: DoubaoWebAdapterDependencies) {
    this.page = dependencies.page;
    this.capability = dependencies.capability ?? doubaoWebCapabilityV20260825;
    this.now = dependencies.now ?? (() => new Date());
    this.interactiveVerificationTimeoutMs = dependencies.interactiveVerificationTimeoutMs ?? 0;
  }

  public async execute(
    request: WebSurfaceExecutionRequest,
    lifecycle?: WebSurfaceExecutionLifecycle,
  ): Promise<WebSurfaceExecutionResult> {
    if (this.activeIdentityId !== null) {
      throw new WebSurfaceExecutionError(
        "IDENTITY_BUSY",
        `Doubao identity '${this.activeIdentityId}' already has an active execution`,
        true,
      );
    }
    this.activeIdentityId = request.identityId;
    try {
      return await this.executeWithIdentityLease(request, lifecycle);
    } finally {
      this.activeIdentityId = null;
    }
  }

  private async executeWithIdentityLease(
    request: WebSurfaceExecutionRequest,
    lifecycle?: WebSurfaceExecutionLifecycle,
  ): Promise<WebSurfaceExecutionResult> {
    if (request.promptText.trim().length === 0) {
      throw new WebSurfaceExecutionError(
        "SUBMISSION_FAILED",
        "Doubao Web question must not be empty",
        false,
      );
    }
    await this.openSurface();
    await this.startNewConversation();
    const actualModel = await this.readVisibleModelLabel();
    const executionContextSnapshot = this.executionContextSnapshot(request, actualModel);
    await lifecycle?.onRuntimeReady({
      actualPlatform: this.platform,
      actualModel,
      actualSurface: this.surface,
      executionContextSnapshot,
    });

    const messageIdsBeforeSubmission = await this.readMessageIds();
    await this.prepareQuestion(request.promptText);
    const questionSubmittedAt = this.now();
    await this.submitPreparedQuestion();
    const userMessage = await this.waitForSubmittedUserMessage(messageIdsBeforeSubmission);
    const assistantMessage = await this.waitForVisibleResponse(userMessage);
    const responseRoot = assistantMessage.root;
    const responseStartedAt = this.now();
    const { text, responseLastSeenAt } = await this.waitForCompleteResponse(responseRoot);
    const completedAt = this.now();
    const responseHtml = await responseRoot.evaluate((element) => element.outerHTML);
    const visibleLinkOccurrences = await extractVisibleLinkOccurrences(
      responseRoot,
      this.capability.selectors.answerBodyMarker,
      this.capability.selectors.sourceAreaMarkers,
    );
    const responseScreenshotBytes = new Uint8Array(
      await responseRoot.screenshot({ animations: "disabled" }),
    );
    const viewportScreenshotBytes = new Uint8Array(
      await this.page.screenshot({ fullPage: false, animations: "disabled" }),
    );

    return {
      executionRunId: request.executionRunId,
      questionVersionId: request.questionVersionId,
      actualPlatform: this.platform,
      actualModel,
      actualSurface: this.surface,
      questionSubmittedAt,
      responseStartedAt,
      responseLastSeenAt,
      completedAt,
      questionResponseBinding: {
        submittedPromptRaw: request.promptText,
        submittedPromptSha256: sha256Text(request.promptText),
        visibleUserMessageText: userMessage.visibleText,
        userMessageId: userMessage.id,
        userMessageSequence: userMessage.sequence,
        assistantMessageId: assistantMessage.id,
        assistantMessageSequence: assistantMessage.sequence,
      },
      uiTruth: {
        responseText: text,
        responseHtmlBytes: new TextEncoder().encode(responseHtml),
        responseScreenshotBytes,
        viewportScreenshotBytes,
        visibleLinkOccurrences,
      },
      executionContextSnapshot,
    };
  }

  private executionContextSnapshot(
    request: WebSurfaceExecutionRequest,
    actualModel: string,
  ): Readonly<Record<string, unknown>> {
    return {
      adapter_version: this.capability.adapterVersion,
      capability_version: this.capability.capabilityVersion,
      entry_url: this.capability.entryUrl,
      browser_mode: this.capability.supportedBrowserMode,
      conversation_mode: this.capability.conversationMode,
      identity_id: request.identityId,
      locale: request.locale,
      region: request.region,
      model_disclosure:
        actualModel === this.capability.undisclosedModelValue ? "UNDISCLOSED" : "UI_VISIBLE",
    };
  }

  private async openSurface(): Promise<void> {
    try {
      await this.page.goto(this.capability.entryUrl, {
        waitUntil: "domcontentloaded",
        timeout: this.capability.timing.navigationTimeoutMs,
      });
      await this.page.locator(this.capability.selectors.input).waitFor({
        state: "visible",
        timeout: this.capability.timing.navigationTimeoutMs,
      });
    } catch (error) {
      const loginVisible = await this.page
        .getByText("登录", { exact: true })
        .isVisible()
        .catch(() => false);
      throw new WebSurfaceExecutionError(
        loginVisible ? "AUTHENTICATION_REQUIRED" : "NAVIGATION_FAILED",
        loginVisible
          ? "Doubao Web requires an authenticated browser identity"
          : "Doubao Web did not expose the contracted chat input",
        !loginVisible,
        error,
      );
    }
  }

  private async startNewConversation(): Promise<void> {
    try {
      const entryPath = new URL(this.capability.entryUrl).pathname;
      const currentPath = new URL(this.page.url()).pathname;
      const messageCount = await this.page.locator(this.capability.selectors.messageRoot).count();
      if (currentPath !== entryPath || messageCount !== 0) {
        throw new Error(
          `Expected fresh entry path '${entryPath}' with zero messages; got '${currentPath}' and ${messageCount}`,
        );
      }
    } catch (error) {
      throw new WebSurfaceExecutionError(
        "CAPABILITY_DRIFT",
        "Doubao Web could not establish a new conversation",
        false,
        error,
      );
    }
  }

  private async prepareQuestion(promptText: string): Promise<void> {
    const input = this.page.locator(this.capability.selectors.input);
    try {
      await input.fill(promptText);
    } catch (error) {
      throw new WebSurfaceExecutionError(
        "SUBMISSION_FAILED",
        "Doubao Web question preparation failed",
        true,
        error,
      );
    }
  }

  private async submitPreparedQuestion(): Promise<void> {
    const send = this.page.locator(this.capability.selectors.send);
    try {
      await send.click();
    } catch (error) {
      throw new WebSurfaceExecutionError(
        "SUBMISSION_FAILED",
        "Doubao Web question submission failed",
        true,
        error,
      );
    }
  }

  private async readMessageIds(): Promise<ReadonlySet<string>> {
    const ids = await this.page
      .locator(this.capability.selectors.messageRoot)
      .evaluateAll((messages) =>
        messages
          .map((message) => message.getAttribute("data-message-id"))
          .filter((id): id is string => id !== null && id.length > 0),
      );
    return new Set(ids);
  }

  private async waitForSubmittedUserMessage(
    messageIdsBeforeSubmission: ReadonlySet<string>,
  ): Promise<ObservedUserMessage> {
    const { messageRoot, userMessageMarker } = this.capability.selectors;
    const deadline = Date.now() + this.capability.timing.responseStartTimeoutMs;
    while (Date.now() < deadline) {
      await this.handleHumanVerificationIfPresent();
      const messages = this.page.locator(messageRoot);
      const messageCount = await messages.count();
      for (let index = 0; index < messageCount; index += 1) {
        const message = messages.nth(index);
        const id = await message.getAttribute("data-message-id");
        if (id === null || id.length === 0 || messageIdsBeforeSubmission.has(id)) continue;
        if ((await message.locator(userMessageMarker).count()) === 0) continue;
        const visibleText = await message.innerText();
        if (visibleText.trim().length === 0) continue;
        return { id, sequence: index + 1, visibleText };
      }
      await this.page.waitForTimeout(this.capability.timing.pollIntervalMs);
    }
    throw new WebSurfaceExecutionError(
      "USER_MESSAGE_NOT_OBSERVED",
      "Doubao Web did not expose a new user message after visible submission",
      false,
    );
  }

  private async waitForVisibleResponse(
    userMessage: ObservedUserMessage,
  ): Promise<ObservedAssistantMessage> {
    const { assistantMessageMarker, messageRoot, userMessageMarker } = this.capability.selectors;
    const deadline = Date.now() + this.capability.timing.responseStartTimeoutMs;
    while (Date.now() < deadline) {
      await this.handleHumanVerificationIfPresent();
      const messages = this.page.locator(messageRoot);
      const messageCount = await messages.count();
      let userIndex = -1;
      for (let index = 0; index < messageCount; index += 1) {
        if ((await messages.nth(index).getAttribute("data-message-id")) === userMessage.id) {
          userIndex = index;
          break;
        }
      }
      if (userIndex < 0) {
        throw new WebSurfaceExecutionError(
          "QUESTION_RESPONSE_BINDING_FAILED",
          "The submitted Doubao user message disappeared before response binding",
          false,
        );
      }
      for (let index = userIndex + 1; index < messageCount; index += 1) {
        const message = messages.nth(index);
        if ((await message.locator(userMessageMarker).count()) > 0) {
          throw new WebSurfaceExecutionError(
            "QUESTION_RESPONSE_BINDING_FAILED",
            "Another user message appeared before the assistant response",
            false,
          );
        }
        if ((await message.locator(assistantMessageMarker).count()) === 0) continue;
        const id = await message.getAttribute("data-message-id");
        const visibleText = (await message.innerText().catch(() => "")).trim();
        if (id !== null && id.length > 0 && visibleText.length > 0) {
          return { id, sequence: index + 1, root: message };
        }
      }
      await this.page.waitForTimeout(this.capability.timing.pollIntervalMs);
    }
    throw new WebSurfaceExecutionError(
      "NO_VISIBLE_RESPONSE",
      "Doubao Web produced no user-visible response within the start window",
      true,
    );
  }

  private async waitForCompleteResponse(
    responseRoot: Locator,
  ): Promise<{ readonly text: string; readonly responseLastSeenAt: Date }> {
    const deadline = Date.now() + this.capability.timing.responseCompletionTimeoutMs;
    let lastText = "";
    let lastHtml = "";
    let lastChangedAt = Date.now();
    let lastSeenAt = this.now();
    while (Date.now() < deadline) {
      const currentText = (await responseRoot.innerText()).trim();
      const currentHtml = await responseRoot.evaluate((element) => element.outerHTML);
      if (currentText !== lastText || currentHtml !== lastHtml) {
        lastText = currentText;
        lastHtml = currentHtml;
        lastChangedAt = Date.now();
        lastSeenAt = this.now();
      }
      const streaming =
        (await responseRoot.locator(this.capability.selectors.streamingMarker).count()) > 0;
      if (
        lastText.length > 0 &&
        !streaming &&
        Date.now() - lastChangedAt >= this.capability.timing.responseQuietWindowMs
      ) {
        return { text: lastText, responseLastSeenAt: lastSeenAt };
      }
      await this.page.waitForTimeout(this.capability.timing.pollIntervalMs);
    }
    throw new WebSurfaceExecutionError(
      "RESPONSE_TIMEOUT",
      "Doubao Web response did not reach a stable completed state",
      true,
    );
  }

  private async isHumanVerificationVisible(): Promise<boolean> {
    for (const marker of this.capability.selectors.humanVerificationMarkers) {
      if (
        await this.page
          .locator(marker)
          .isVisible()
          .catch(() => false)
      )
        return true;
    }
    return false;
  }

  private async handleHumanVerificationIfPresent(): Promise<void> {
    if (!(await this.isHumanVerificationVisible())) return;
    if (this.interactiveVerificationTimeoutMs <= 0) {
      throw new WebSurfaceExecutionError(
        "HUMAN_VERIFICATION_REQUIRED",
        "Doubao Web requires human verification before message binding can continue",
        false,
      );
    }
    await this.waitForHumanVerification(this.interactiveVerificationTimeoutMs);
  }

  private async waitForHumanVerification(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!(await this.isHumanVerificationVisible())) return;
      await this.page.waitForTimeout(this.capability.timing.pollIntervalMs);
    }
    throw new WebSurfaceExecutionError(
      "HUMAN_VERIFICATION_REQUIRED",
      "Doubao Web human verification was not completed within the interactive window",
      false,
    );
  }

  private async readVisibleModelLabel(): Promise<string> {
    for (const selector of this.capability.selectors.visibleModelLabels) {
      const label = this.page.locator(selector).last();
      if (await label.isVisible().catch(() => false)) {
        const text = (await label.innerText()).trim();
        if (text.length > 0) return text;
      }
    }
    return this.capability.undisclosedModelValue;
  }
}

interface ObservedUserMessage {
  readonly id: string;
  readonly sequence: number;
  readonly visibleText: string;
}

interface ObservedAssistantMessage {
  readonly id: string;
  readonly sequence: number;
  readonly root: Locator;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function extractVisibleLinkOccurrences(
  responseRoot: Locator,
  answerBodyMarker: string,
  sourceAreaMarkers: readonly string[],
): Promise<readonly VisibleLinkOccurrence[]> {
  return responseRoot.locator("a[href]").evaluateAll(
    (links, selectors) => {
      const isActuallyVisible = (link: HTMLAnchorElement): boolean => {
        if (!Array.from(link.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0)) {
          return false;
        }
        for (
          let element: HTMLElement | null = link;
          element !== null;
          element = element.parentElement
        ) {
          const style = window.getComputedStyle(element);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            style.opacity === "0"
          ) {
            return false;
          }
        }
        return true;
      };
      const visibleRegion = (link: HTMLAnchorElement) => {
        if (selectors.sourceAreaMarkers.some((selector) => link.closest(selector) !== null)) {
          return "SOURCE_AREA" as const;
        }
        if (link.closest(selectors.answerBodyMarker) !== null) return "ANSWER_BODY" as const;
        return "OTHER_VISIBLE_AREA" as const;
      };

      return links
        .filter((link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement)
        .filter(isActuallyVisible)
        .map((link, index) => ({
          visibleText: link.innerText.trim(),
          observedHref: link.href,
          occurrenceOrdinal: index + 1,
          visibleRegion: visibleRegion(link),
        }));
    },
    { answerBodyMarker, sourceAreaMarkers },
  );
}
