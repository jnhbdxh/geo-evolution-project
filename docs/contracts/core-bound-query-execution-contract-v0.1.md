# GEO OS Core-bound Query Execution Contract V0.1

- **Status:** ACTIVE IMPLEMENTATION CONTRACT
- **Implementation state:** COMMITTED
- **Content baseline:** `c1e3b573b81ac9a7b78261f46d8cd6c268ed8cc7`
- **Activation record:** `THIS_DOCUMENT_COMMIT`
- **Repository baseline:** `3a980cd13336675819c8df04744b8992d7dae90a`
- **Database baseline:** frozen `0001` / `0002`; no DDL change
- **First product surface:** `doubao_web`

## 1. Boundary

The Query Engine has no PostgreSQL credential and cannot write a business fact directly. It receives an execution-scoped Core token and invokes only the internal command API:

```text
Core assignment
→ Web runtime ready
→ Start ExecutionRun
→ submit canonical QuestionVersion
→ Capture UI Truth
→ create A1 Candidate
→ terminal ExecutionRun
→ byte-verified Finalize
```

`CaptureService` remains the only CaptureArtifact registration path. `ObservationFinalizationService` re-reads every referenced object and verifies byte size and SHA-256 before the Repository may create RawObservation.

## 2. Internal identity

Internal bearer tokens are signed with a secret distinct from the user JWT secret. A token fixes:

- issuer `geo-os-control-plane`;
- audience `geo-os-core-internal`;
- subject `query-engine`;
- one `tenant_id`;
- one `execution_run_id`;
- unique token ID, issued time and expiry.

Maximum lifetime is 15 minutes; the default is 10 minutes. A token for one ExecutionRun cannot start, upload evidence, create a Candidate, terminate or finalize another run. Internal commands use `actor_user_identity_id = null` and add `actor_service = QUERY_ENGINE` to Audit details; they never impersonate the Tenant user who queued the run.

Production must inject `INTERNAL_SERVICE_TOKEN_SECRET` from secret management. It must not be shared with Query Engine code as a signing key: the control-plane dispatcher issues the scoped token and the Query Engine only presents it.

## 3. Canonical assignment

Before opening the Web product, the Query Engine obtains the assignment from Core. Core resolves the queued ExecutionRun under Tenant RLS and returns:

- ExecutionRun and QuestionVersion IDs;
- exact `prompt_text` and its UTF-8 SHA-256;
- locale;
- planned platform, model and surface;
- region and planned context.

The Query Engine rejects the command before submission if the supplied request differs in ExecutionRun, QuestionVersion, exact prompt, prompt hash, locale, platform, surface or non-null region. A sidebar title or other Web metadata never participates in this comparison.

## 4. Two-phase Web execution

The Doubao adapter first establishes a fresh page and reads the model label actually disclosed by the ready UI. It then invokes `onRuntimeReady`; Core must successfully and idempotently transition the run from `QUEUED` to `RUNNING` before the adapter clicks Send.

The runtime context is frozen once at Start. If the UI does not disclose an exact model, the adapter records `DOUBAO_WEB_ROUTING_UNDISCLOSED` rather than a requested or inferred model.

## 5. Evidence set

The Core-bound runner uploads five independently hashed artifacts:

1. visible raw answer text (`RAW_RESPONSE`);
2. final response subtree HTML (`TRACE`);
3. response-element PNG (`SCREENSHOT`);
4. viewport PNG (`SCREENSHOT`);
5. deterministic JSON UI Truth manifest (`STRUCTURED_RESPONSE`).

The UI Truth Manifest contains execution identity, actual surface context, question-response binding, timestamps, visible link candidates and per-artifact hashes. Its minimum actual-context contract is actual platform, disclosed-or-undisclosed model, actual surface, locale, region, question-submission time, response interval, completion time, adapter version and capability version. It is distinct from the database-canonical `RawObservation.capture_manifest`, which records the finalized CaptureArtifact membership used by Observation finalization. Uploads use deterministic idempotency keys. The current internal JSON transport limits each decoded artifact to 10 MiB; larger evidence requires a later pre-signed streaming upload contract.

Every visible-link occurrence must remain distinct and preserve at least visible text, observed URL, one-based visible occurrence order and visible region (`ANSWER_BODY | SOURCE_AREA | OTHER_VISIBLE_AREA`). Response-message binding must remain unambiguous: when one Manifest contains exactly one assistant response message, every occurrence inherits the Manifest-level binding without duplicating the same message ID; a future Manifest that permits multiple response messages must bind each occurrence explicitly. UI Truth Manifest V1 already preserves text, URL, candidate-array order and one Manifest-level assistant-message binding, but it lacks an explicit occurrence ordinal and visible-region field. Those additions require a new versioned UI Truth Manifest schema and remain an implementation gap. A later qualifier may normalize, merge or reject occurrences, but capture must not overwrite the originally observed values or order.

The raw answer text, final response HTML and their visible ordering must remain sufficient to re-run versioned Mention, Consideration, Recommendation, Citation and competitor-related evaluators. Those conclusions are not Web-adapter facts and must not be inserted into the Core-bound evidence manifest as final KPI values.

Local object storage is MinIO. Production remains Tencent COS through the provider-neutral `EvidenceObjectStore`; the Core API does not expose provider credentials to Query Engine.

## 6. Candidate and Finalize

The runner requires a versioned A1 Candidate decision provider. The Web adapter itself does not decide A2 validity, metric eligibility or KPI contribution. Candidate evidence references the registered CaptureArtifact IDs and the bound user/assistant message markers.

The sequence is deliberately:

```text
Capture → Candidate → Execution terminal → Finalize
```

Finalize is scoped again to the token ExecutionRun. A Candidate from another run is rejected before object verification. The frozen database trigger still independently requires a terminal ExecutionRun and enforces the final response time boundary.

## 7. Current completion boundary

Implemented and automatically tested:

- execution-scoped authentication and cross-run rejection;
- canonical Core assignment and prompt/hash comparison;
- two-phase Start-before-submit hook;
- provider-neutral evidence upload through CaptureService;
- Candidate, terminal and scoped Finalize command transport;
- Query Engine prohibition on PostgreSQL imports and credentials;
- happy-path command ordering and operational failure reporting.

Still required before Slice 2 product completion:

- durable Outbox/queue dispatcher and token delivery;
- versioned production A1 outcome detector beyond the injected decision contract;
- one real Core-bound Doubao execution through PostgreSQL + MinIO/COS-compatible Capture;
- a versioned UI Truth Manifest that adds an explicit visible-link occurrence ordinal and visible region while retaining the existing Manifest-level response-message binding;
- recovery policy for ambiguous browser side effects after process loss;
- Tenant-operator/authorized-project-member execution and observation inspection UI.
