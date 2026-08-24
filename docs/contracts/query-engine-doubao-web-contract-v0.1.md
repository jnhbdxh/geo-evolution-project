# GEO OS Query Engine — Doubao Web Contract V0.1

- **Status:** ACTIVE IMPLEMENTATION CONTRACT — LIVE GOLDEN QUERY PASSED
- **Implementation state:** COMMITTED
- **Repository baseline:** `3a980cd13336675819c8df04744b8992d7dae90a`
- **Platform:** `doubao`
- **Surface:** `doubao_web`
- **Execution provider:** Playwright + Chromium
- **Authorization:** product owner confirms written Doubao authorization

## 1. Product boundary

The adapter observes what a user can see at `https://www.doubao.com/chat/`. A Doubao model API, internal HTTP response or Model Gateway output cannot satisfy this surface.

```text
QuestionVersion
→ new Doubao Web conversation
→ submit exact visible prompt
→ detect visible response node
→ wait for completion and a quiet UI window
→ capture response text + response HTML + screenshot + visible links
→ return execution facts through the authenticated Core boundary
```

The adapter produces execution and UI evidence only. It does not decide A2 validity, metric eligibility, Mention, Recommendation, Citation qualification or KPI contribution.

## 2. Versioned capability

Capability `doubao-web/2026-08-22-live.1` centralizes UI signals verified against an authorized, authenticated Doubao Web session. Static bundle `data-testid` values are not used because the live production DOM did not expose them:

| Purpose            | Contract signal                                           |
| ------------------ | --------------------------------------------------------- |
| Fresh conversation | exact `/chat/` entry path with zero message roots         |
| Prompt input       | `[role="textbox"][contenteditable="true"]`                |
| Submit             | `button[class*="bg-g-send-msg-btn-bg"]`                   |
| Generating         | `[data-streaming="true"]` within the response root        |
| Message identity   | `[data-message-id]`                                       |
| User bubble        | `[data-plugin-identifier="block_type:10000"].justify-end` |
| Assistant content  | `.md-box-root[data-streaming]`                            |
| Human verification | visible verification instruction markers                  |

Selectors cannot be scattered through business services. Any Doubao UI change produces a new Capability version and must pass Adapter Contract Tests and an authorized Golden Query before release.

## 3. Execution semantics

- One formal QuestionVersion must use the exact `/chat/` fresh-entry route with zero message roots. Any redirect into an existing conversation or existing message root is Capability drift.
- Capability `live.1` supports headed Chromium only. Headless execution is not an accepted substitute until a separate live Golden Query passes in that mode.
- One adapter identity permits only one active execution in-process. Cross-process identity concurrency will additionally require the Query Engine lease boundary.
- `question_submitted_at` is recorded immediately before visible submission.
- After submission, the adapter must first observe a new user message ID and visible text. It only accepts an assistant-marked message that follows that exact user message in DOM order.
- The original QuestionVersion text/hash and visible user-message text are separate facts. Normal line-break, whitespace or Unicode presentation differences are preserved rather than overwritten.
- A sidebar conversation title is non-authoritative page metadata. It never participates in QuestionVersion equality or question-response binding.
- A response starts only after a non-user message node with visible text appears.
- Completion requires the response streaming marker to be absent and the response DOM to remain unchanged for the configured quiet window. Visible response text remains the canonical user-visible textual fact.
- Missing visible output remains an Execution failure and does not create an Observation by itself.
- CAPTCHA/human verification, login, service failure and selector drift are operational errors, not AI Response Outcomes. Production execution stops at human verification; an explicitly headed Golden Query may wait for the authorized operator to complete it.

## 4. Effective model disclosure

The Web surface may route models without disclosing an exact model identifier. The adapter must not copy a requested/assumed model into the actual fact.

If no model label is visibly available, it records:

```text
actual_model = DOUBAO_WEB_ROUTING_UNDISCLOSED
model_disclosure = UNDISCLOSED
```

This preserves truthful execution context. Later A2/Comparability policy may restrict comparisons that require a disclosed exact model.

## 5. UI Truth capture

The adapter returns:

- submitted prompt raw text and UTF-8 SHA-256;
- visible user-message text, user/assistant message IDs and their one-based DOM sequence;
- exact visible response text;
- UTF-8 bytes of the final visible response DOM subtree;
- response-element screenshot bytes plus viewport screenshot bytes;
- user-visible link candidates extracted from visible anchors;
- platform, surface, effective model disclosure and Capability/Adapter version;
- submission, first-visible, last-change and completion timestamps.

Visible links are `Occurrence` candidates only. Redirect resolution, source qualification, completeness and LogicalCitation/SourceBinding remain Pack C responsibilities. Network data may support debugging but cannot replace visible UI evidence.

The adapter returns bytes to the Query Engine orchestration layer. Only the existing Core CaptureService may register Tenant/Project/Execution-scoped CaptureArtifacts and write Audit/Outbox.

## 6. Identity and security

- StorageState/Cookies never enter Git, PostgreSQL plaintext, logs or execution context.
- Local live smoke accepts a StorageState path outside the repository.
- Production must obtain and decrypt identity state through the future secret/identity broker into an ephemeral runtime location.
- Identity ID may appear in execution context; credentials and cookie values may not.
- Browser Worker receives no PostgreSQL credentials and submits commands/evidence through authenticated Core boundaries.

## 7. Error contract

| Error                              | Meaning                                      | Retryable |
| ---------------------------------- | -------------------------------------------- | --------- |
| `AUTHENTICATION_REQUIRED`          | Login/session unavailable                    | no        |
| `CAPABILITY_DRIFT`                 | Contracted UI operation changed              | no        |
| `HUMAN_VERIFICATION_REQUIRED`      | Doubao requires human verification           | no        |
| `IDENTITY_BUSY`                    | Same adapter identity already executing      | yes       |
| `NAVIGATION_FAILED`                | Surface failed before input became available | yes       |
| `SUBMISSION_FAILED`                | Visible prompt could not be submitted        | yes       |
| `USER_MESSAGE_NOT_OBSERVED`        | No new visible user message followed submit  | no        |
| `QUESTION_RESPONSE_BINDING_FAILED` | Message order became ambiguous               | no        |
| `NO_VISIBLE_RESPONSE`              | No qualifying AI response appeared           | yes       |
| `RESPONSE_TIMEOUT`                 | Response did not reach stable completion     | yes       |

Retryability is a scheduling hint. A retry must create/target the correct new ExecutionRun under the frozen SampleSlot contract; the adapter never silently retries inside one execution.

## 8. Acceptance evidence

Current candidate requires:

1. static Capability identity and selector tests;
2. local Playwright fixture test proving new conversation, exact prompt, response/HTML/screenshot/link capture and undisclosed-model handling;
3. concurrent identity rejection;
4. login and no-visible-response failure tests;
5. authorized live Doubao Golden Query using a real StorageState — **PASSED 2026-08-22**;
6. submitted prompt → visible user message → later assistant message binding tests;
7. CaptureService registration and byte/hash verification through the authenticated Core boundary;
8. a UI-drift Canary before production enablement.

Items 1–6 have passed. Item 7 now has an execution-scoped API, canonical QuestionVersion assignment, Core client and automated orchestration contract; one real Core-bound Doubao run remains required. The live evidence identity and limits are recorded in `query-engine-doubao-web-golden-query-record-v0.1.md`. Item 8 remains a production-enablement requirement.

## 9. Core-bound integration

The adapter now exposes a two-phase lifecycle hook. It opens the fresh product surface and reads the actually disclosed runtime context, then waits for Core to idempotently start the ExecutionRun before clicking Send. The Query Engine first obtains the exact QuestionVersion prompt and UTF-8 hash from Core and refuses a mismatched assignment.

The internal token is limited to one Tenant and one ExecutionRun. Query Engine uses it to upload five UI Truth artifacts through CaptureService, submit the versioned A1 Candidate decision, close the ExecutionRun and request byte-verified Finalize. Full rules and remaining limits are in `core-bound-query-execution-contract-v0.1.md`.
