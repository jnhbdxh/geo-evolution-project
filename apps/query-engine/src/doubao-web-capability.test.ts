import { describe, expect, it } from "vitest";

import { doubaoWebCapabilityV20260822 } from "./doubao-web-capability.js";

describe("Doubao Web capability", () => {
  it("freezes the real product surface instead of a model API", () => {
    expect(doubaoWebCapabilityV20260822).toMatchObject({
      capabilityVersion: "doubao-web/2026-08-22-live.1",
      entryUrl: "https://www.doubao.com/chat/",
      platform: "doubao",
      surface: "doubao_web",
      supportedBrowserMode: "headed",
      conversationMode: "fresh_entry_url",
    });
    expect(doubaoWebCapabilityV20260822.entryUrl).not.toContain("api");
  });

  it("centralizes the current official UI contract signals", () => {
    expect(doubaoWebCapabilityV20260822.selectors).toEqual({
      input: '[role="textbox"][contenteditable="true"]',
      send: 'button[class*="bg-g-send-msg-btn-bg"]',
      streamingMarker: '[data-streaming="true"]',
      messageRoot: "[data-message-id]",
      userMessageMarker: '[data-plugin-identifier="block_type:10000"].justify-end',
      assistantMessageMarker: ".md-box-root[data-streaming]",
      humanVerificationMarkers: ["text=请选择所有符合上述描述的图片", "text=请完成安全验证"],
      visibleModelLabels: ['button:has-text("豆包")'],
    });
  });
});
