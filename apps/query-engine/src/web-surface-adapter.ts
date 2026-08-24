export interface WebSurfaceExecutionRequest {
  readonly executionRunId: string;
  readonly questionVersionId: string;
  readonly identityId: string;
  readonly promptText: string;
  readonly locale: string;
  readonly region: string;
}

export interface VisibleLinkCandidate {
  readonly visibleText: string;
  readonly observedHref: string;
}

export interface UiTruthCapture {
  readonly responseText: string;
  readonly responseHtmlBytes: Uint8Array;
  readonly responseScreenshotBytes: Uint8Array;
  readonly viewportScreenshotBytes: Uint8Array;
  readonly visibleLinkCandidates: readonly VisibleLinkCandidate[];
}

export interface QuestionResponseBinding {
  readonly submittedPromptRaw: string;
  readonly submittedPromptSha256: string;
  readonly visibleUserMessageText: string;
  readonly userMessageId: string;
  readonly userMessageSequence: number;
  readonly assistantMessageId: string;
  readonly assistantMessageSequence: number;
}

export interface WebSurfaceExecutionResult {
  readonly executionRunId: string;
  readonly questionVersionId: string;
  readonly actualPlatform: string;
  readonly actualModel: string;
  readonly actualSurface: string;
  readonly questionSubmittedAt: Date;
  readonly responseStartedAt: Date;
  readonly responseLastSeenAt: Date;
  readonly completedAt: Date;
  readonly questionResponseBinding: QuestionResponseBinding;
  readonly uiTruth: UiTruthCapture;
  readonly executionContextSnapshot: Readonly<Record<string, unknown>>;
}

export interface WebSurfaceRuntimeContext {
  readonly actualPlatform: string;
  readonly actualModel: string;
  readonly actualSurface: string;
  readonly executionContextSnapshot: Readonly<Record<string, unknown>>;
}

export interface WebSurfaceExecutionLifecycle {
  onRuntimeReady(context: WebSurfaceRuntimeContext): Promise<void>;
}

export interface WebSurfaceAdapter {
  readonly platform: string;
  readonly surface: string;
  execute(
    request: WebSurfaceExecutionRequest,
    lifecycle?: WebSurfaceExecutionLifecycle,
  ): Promise<WebSurfaceExecutionResult>;
}

export type WebSurfaceExecutionErrorKind =
  | "AUTHENTICATION_REQUIRED"
  | "CAPABILITY_DRIFT"
  | "HUMAN_VERIFICATION_REQUIRED"
  | "IDENTITY_BUSY"
  | "NAVIGATION_FAILED"
  | "SUBMISSION_FAILED"
  | "USER_MESSAGE_NOT_OBSERVED"
  | "QUESTION_RESPONSE_BINDING_FAILED"
  | "NO_VISIBLE_RESPONSE"
  | "RESPONSE_TIMEOUT";

export class WebSurfaceExecutionError extends Error {
  public readonly kind: WebSurfaceExecutionErrorKind;
  public readonly retryable: boolean;

  public constructor(
    kind: WebSurfaceExecutionErrorKind,
    message: string,
    retryable: boolean,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WebSurfaceExecutionError";
    this.kind = kind;
    this.retryable = retryable;
  }
}
