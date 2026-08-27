import { describe, expect, it } from "vitest";

import {
  DOUBAO_GOLDEN_QUERY_MANIFEST_SCHEMA_VERSION,
  doubaoWebCapabilityV20260825,
} from "./doubao-web-capability.js";

describe("Doubao Web capability", () => {
  it("freezes the real product surface instead of a model API", () => {
    expect(doubaoWebCapabilityV20260825).toMatchObject({
      capabilityVersion: "doubao-web/2026-08-25-live.2",
      adapterVersion: "doubao-web-playwright/0.3.0",
      entryUrl: "https://www.doubao.com/chat/",
      platform: "doubao",
      surface: "doubao_web",
      supportedBrowserMode: "headed",
      conversationMode: "fresh_entry_url",
    });
    expect(DOUBAO_GOLDEN_QUERY_MANIFEST_SCHEMA_VERSION).toBe("doubao-web-golden-query/2.0");
    expect(doubaoWebCapabilityV20260825.entryUrl).not.toContain("api");
  });

  it("centralizes the current official UI contract signals", () => {
    expect(doubaoWebCapabilityV20260825.selectors).toEqual({
      input: '[role="textbox"][contenteditable="true"]',
      send: 'button[class*="bg-g-send-msg-btn-bg"]',
      streamingMarker: '[data-streaming="true"]',
      messageRoot: "[data-message-id]",
      userMessageMarker: '[data-plugin-identifier="block_type:10000"].justify-end',
      assistantMessageMarker: ".md-box-root[data-streaming]",
      answerBodyMarker: ".md-box-root[data-streaming]",
      sourceAreaMarkers: [
        '[data-testid*="source" i]',
        '[data-testid*="reference" i]',
        '[aria-label*="来源"]',
        '[aria-label*="参考"]',
        '[aria-label*="source" i]',
        '[aria-label*="reference" i]',
      ],
      humanVerificationMarkers: ["text=请选择所有符合上述描述的图片", "text=请完成安全验证"],
      visibleModelLabels: ['button:has-text("豆包")'],
    });
  });
});
