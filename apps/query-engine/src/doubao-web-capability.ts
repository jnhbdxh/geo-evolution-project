export interface DoubaoWebCapability {
  readonly capabilityVersion: string;
  readonly adapterVersion: string;
  readonly entryUrl: string;
  readonly platform: "doubao";
  readonly surface: "doubao_web";
  readonly supportedBrowserMode: "headed";
  readonly conversationMode: "fresh_entry_url";
  readonly undisclosedModelValue: string;
  readonly selectors: {
    readonly input: string;
    readonly send: string;
    readonly streamingMarker: string;
    readonly messageRoot: string;
    readonly userMessageMarker: string;
    readonly assistantMessageMarker: string;
    readonly humanVerificationMarkers: readonly string[];
    readonly visibleModelLabels: readonly string[];
  };
  readonly timing: {
    readonly navigationTimeoutMs: number;
    readonly responseStartTimeoutMs: number;
    readonly responseCompletionTimeoutMs: number;
    readonly responseQuietWindowMs: number;
    readonly pollIntervalMs: number;
  };
}

export const doubaoWebCapabilityV20260822: DoubaoWebCapability = {
  capabilityVersion: "doubao-web/2026-08-22-live.1",
  adapterVersion: "doubao-web-playwright/0.2.0",
  entryUrl: "https://www.doubao.com/chat/",
  platform: "doubao",
  surface: "doubao_web",
  supportedBrowserMode: "headed",
  conversationMode: "fresh_entry_url",
  undisclosedModelValue: "DOUBAO_WEB_ROUTING_UNDISCLOSED",
  selectors: {
    input: '[role="textbox"][contenteditable="true"]',
    send: 'button[class*="bg-g-send-msg-btn-bg"]',
    streamingMarker: '[data-streaming="true"]',
    messageRoot: "[data-message-id]",
    userMessageMarker: '[data-plugin-identifier="block_type:10000"].justify-end',
    assistantMessageMarker: ".md-box-root[data-streaming]",
    humanVerificationMarkers: ["text=请选择所有符合上述描述的图片", "text=请完成安全验证"],
    visibleModelLabels: ['button:has-text("豆包")'],
  },
  timing: {
    navigationTimeoutMs: 45_000,
    responseStartTimeoutMs: 60_000,
    responseCompletionTimeoutMs: 180_000,
    responseQuietWindowMs: 1_500,
    pollIntervalMs: 250,
  },
};
