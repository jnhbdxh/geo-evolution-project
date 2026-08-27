import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { chromium } from "playwright";

import { resolveBrowserExecutablePath } from "./browser-runtime.js";
import { loadQueryEngineConfig } from "./config.js";
import { doubaoWebCapabilityV20260825 } from "./doubao-web-capability.js";

const config = loadQueryEngineConfig();
const statePath = path.resolve(config.DOUBAO_STORAGE_STATE_PATH);
await mkdir(path.dirname(statePath), { recursive: true });
const browserExecutablePath = resolveBrowserExecutablePath(
  config.QUERY_ENGINE_BROWSER_EXECUTABLE_PATH,
);

const browser = await chromium.launch({
  headless: false,
  ...(browserExecutablePath === undefined ? {} : { executablePath: browserExecutablePath }),
});
const terminal = createInterface({ input: stdin, output: stdout });

try {
  const context = await browser.newContext({
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto(config.DOUBAO_ENTRY_URL, {
    waitUntil: "domcontentloaded",
    timeout: doubaoWebCapabilityV20260825.timing.navigationTimeoutMs,
  });

  await terminal.question(
    "请在打开的 Chromium 窗口中完成豆包登录并进入聊天页，然后回到此终端按 Enter：",
  );

  await context.storageState({ path: statePath });
  stdout.write(`豆包登录状态已保存至 ${statePath}\n`);

  const diagnosticPath = path.resolve(".codex-tmp/query-engine-auth/doubao-controls.json");
  await mkdir(path.dirname(diagnosticPath), { recursive: true });
  const controls = await page
    .locator('textarea, input, button, [role="button"], [contenteditable="true"]')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        tag: element.tagName.toLowerCase(),
        testid: element.getAttribute("data-testid"),
        role: element.getAttribute("role"),
        ariaLabel: element.getAttribute("aria-label"),
        placeholder: element.getAttribute("placeholder"),
        contenteditable: element.getAttribute("contenteditable"),
        type: element.getAttribute("type"),
      })),
    );
  await writeFile(
    diagnosticPath,
    `${JSON.stringify({ url: page.url(), controls }, null, 2)}\n`,
    "utf8",
  );

  const input = page.locator(doubaoWebCapabilityV20260825.selectors.input);
  await input.waitFor({
    state: "visible",
    timeout: doubaoWebCapabilityV20260825.timing.navigationTimeoutMs,
  });
  const messageCount = await page
    .locator(doubaoWebCapabilityV20260825.selectors.messageRoot)
    .count();
  if (
    new URL(page.url()).pathname !== new URL(config.DOUBAO_ENTRY_URL).pathname ||
    messageCount !== 0
  ) {
    throw new Error("豆包页面不是可验证的空白新对话，请返回 https://www.doubao.com/chat/ 后重试");
  }
  stdout.write("豆包聊天页 Capability 校验通过\n");
  await context.close();
} finally {
  terminal.close();
  await browser.close();
}
