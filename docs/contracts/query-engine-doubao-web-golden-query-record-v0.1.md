# GEO OS Query Engine — Doubao Web Golden Query Record V0.1

- **Status:** PASSED
- **Executed at:** 2026-08-22 16:57 CST
- **Surface:** `doubao_web`
- **Capability:** `doubao-web/2026-08-22-live.1`
- **Adapter:** `doubao-web-playwright/0.2.0`
- **Authorization basis:** product owner confirmed written Doubao authorization

## 1. Acceptance scope

This record accepts the first real AI Web surface adapter against the visible Doubao product UI. It proves real UI submission, response detection and UI Truth capture. It does not claim that the future authenticated Core/Query Engine asynchronous boundary, CaptureService registration or production Canary is complete.

## 2. Accepted run

```text
Prompt: 请只回答：GEO_OS_DOUBAO_WEB_GOLDEN_QUERY_OK
Visible response: GEO_OS_DOUBAO_WEB_GOLDEN_QUERY_OK
Actual platform: doubao
Actual surface: doubao_web
Visible model label: 豆包 快速
Browser mode: headed
Visible link candidates: 0
```

```text
question_submitted_at: 2026-08-22T08:57:17.257Z
response_started_at:   2026-08-22T08:57:20.327Z
response_last_seen_at: 2026-08-22T08:57:20.334Z
completed_at:          2026-08-22T08:57:21.884Z
```

The first calibration submission triggered Doubao human verification. The authorized operator completed it manually. That challenge was treated as an operational boundary and was not recorded as an AI response. The accepted run occurred afterward and returned the expected visible response.

## 3. Evidence identity

Evidence remains under the Git-ignored local path `.codex-tmp/query-engine-smoke/doubao-live-2/` because the viewport can contain account-adjacent UI. Credentials, cookies and StorageState are not present in the repository or this record.

| Artifact                  | Bytes | SHA-256                                                            |
| ------------------------- | ----: | ------------------------------------------------------------------ |
| `manifest.json`           |   840 | `43C4464784AE950D5DA43ED0BBFF1EAEDEBF813732082AB8173317D3FDE6E6E8` |
| `response.html`           |  2834 | `70855829ADB7C4C87A11731F9B80C431E4E5345D057D9CF2D9D00454968DD063` |
| `response-screenshot.png` |  2561 | `84FFCD7A45EEBF36DBA6FA0314B795A7FF35B6F23B731683DF03A027AA8E7580` |
| `viewport-screenshot.png` | 58602 | `F78C50BCF2B61860CBF2346F5072806516E2FF4456DD8D202AD6C1280411EC9B` |

The accepted standalone smoke manifest predates the added manifest-level Execution/Question IDs and per-artifact hash fields. Those fields are now mandatory for all later runs. This does not weaken the adapter Golden Query result because this record pins the complete accepted evidence set by byte size and SHA-256; it does mean the run is not eligible to stand in for a Core-bound ExecutionRun.

## 4. Live findings incorporated into the Capability

- The authenticated production DOM did not expose the `data-testid` values found in delivered static bundles.
- The prompt editor is `[role="textbox"][contenteditable="true"]`.
- A fresh formal conversation is the exact `/chat/` route with zero `[data-message-id]` roots.
- Both user and assistant blocks use `block_type:10000`; the user message is distinguished by its `.justify-end` marker.
- Response completion uses `data-streaming="true"` plus a DOM quiet window.
- The visible UI disclosed `豆包 快速`; no hidden model identifier was inferred.
- A headless follow-up produced no visible AI response and was rejected. Capability `live.1` therefore supports headed Chromium only.

## 5. Decision

The authorized Doubao Web Golden Query is accepted. Acceptance items 1–6 in the Doubao Web Contract are closed, including explicit submitted-prompt → visible-user-message → later-assistant-message binding. Sidebar conversation titles are excluded from this binding. The execution-scoped Query Engine/Core command boundary and CaptureService transport have since been implemented under `core-bound-query-execution-contract-v0.1.md`; the next acceptance evidence is one real Core-bound run plus a scheduled UI-drift Canary.
