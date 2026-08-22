# GEO OS Slice 2 Observation Domain Contract V0.1

**Status:** ACTIVE IMPLEMENTATION CONTRACT — DDL FROZEN V1.0  
**Scope:** Question release、Monitoring plan、Sample slot、Execution、Capture evidence、Observation existence、RawObservation finalization、Correction  
**Effective version:** 0.1.0  
**Upstream DDL:** ZERO-FK FROZEN BASELINE — `0001_slice_1_foundation.sql`

## 1. Boundary

Slice 2 proves one industry-independent product chain:

```text
QuestionVersion
→ MonitoringPlanVersion
→ SampleBatch / SampleSlot
→ ExecutionRun
→ visible Response Outcome
→ ObservationCandidate
→ CaptureArtifact
→ RawObservation FINALIZED / IMMUTABLE
```

Slice 2 records what was planned, what actually ran, whether a user-visible response outcome existed, and the exact raw evidence. It does not decide Observation quality, metric eligibility, production inclusion, Mention/Recommendation/Citation KPI, Review, Resolution or Snapshot membership. Those are later-slice assessments and decisions.

Authoritative semantic inputs are Decision Pack A1 (Observation existence), A2 (quality and metric eligibility boundary) and A3 (immutability/review model), together with the active Product Object Map and Slice Implementation Map.

## 2. Contract decisions

### S2-D001 — Execution and Observation are different facts

- An `ExecutionRun` never creates an Observation merely because it started, completed or failed.
- One `SampleSlot` may have many `ExecutionRun` rows. A retry/re-execution appends a new run and does not increase Sample N.
- One `ExecutionRun` has zero or one `ObservationCandidate`.
- Operational outcome and response outcome are independent. A failed or timed-out run may still have a visible refusal, partial answer or no-information response and therefore may have a Candidate.
- `SampleSlot.current_effective_observation` is a future projection, never a source fact column.

### S2-D002 — Candidate creation uses the four A1 existence predicates

An `ObservationCandidate` may be inserted only when all are explicitly true:

1. target surface was reached;
2. the target QuestionVersion was submitted;
3. a user-visible AI Response Outcome appeared;
4. that outcome is associated with the ExecutionRun lifecycle.

CAPTCHA, authentication, quota/rate-limit, service-busy, page-load failure, search/thinking-only state and empty response containers do not satisfy predicate 3. Refusal, no-information, partial refusal and partial answer do satisfy it. Existence is not inferred from `ExecutionRun.operational_status`.

Correlation is recorded as `CONFIRMED | PROBABLE | UNCERTAIN`; uncertainty is preserved for later assessment and does not silently erase the captured fact.

The internal Candidate command records all four predicates as explicit `true` values and accepts only the A1 response-outcome kinds. It freezes a typed existence basis (`VISIBLE_TEXT_RESPONSE | VISIBLE_STRUCTURED_RESPONSE | VISIBLE_REFUSAL | VISIBLE_NO_INFORMATION | VISIBLE_PARTIAL_RESPONSE | OTHER_VISIBLE_RESPONSE`), detector version, Question submission time, response interval and optional same-Execution CaptureArtifact IDs. Operational notices are not valid command values.

Candidate creation locks the ExecutionRun. At the first visible response signal it may atomically set the previously empty `ExecutionRun.response_outcome_kind` while the run remains `RUNNING`, insert one `CAPTURING` Candidate, and append Audit/Outbox. A later terminal failure preserves that observed outcome. Same-semantic concurrent replay returns one Candidate/event; conflicting replay is rejected. Outbox failure rolls back both the Candidate and the newly recorded response outcome.

Creation-time target integrity is checked against the released MonitoringPlanVersion: actual platform and surface must match the planned target. The actual model is still frozen as execution fact, but model mismatch is not allowed to erase A1 existence and remains an A2 context-quality matter. A confirmed platform/surface mismatch before creation is rejected; later-discovered mismatch remains an A2/A3 assessment matter. Question submission and response timestamps must fall inside the started Execution lifecycle. No A2 validity or metric-eligibility field is accepted by the command.

### S2-D003 — Planned context and actual context are both retained

- `MonitoringPlanVersion` freezes planned platform/model/surface/locale/region and sampling configuration.
- `SampleSlot` binds one exact QuestionVersion and keeps its planned context.
- Tenant Queue supplies only SampleSlot, optional retry lineage and idempotency key. It cannot declare actual execution facts.
- Core API copies its assigned `policy_release_id` and optional `industry_policy_release_id` into the clean queued ExecutionRun.
- The authenticated Query Engine Start command writes the observed actual platform, model, surface and execution context snapshot exactly once while moving `QUEUED → RUNNING`.
- A later change to Project default bindings affects only future runs and cannot rewrite an existing ExecutionRun or RawObservation.

### S2-D004 — Capture evidence is append-only and content-addressed

- `CaptureArtifact` stores Tenant-scoped object-storage bucket/key, media type, byte size and SHA-256; PostgreSQL is the evidence manifest, not the large-object store.
- The Capture command accepts bytes and Query Engine metadata, but never accepts a caller-selected bucket/key. Core generates a deterministic Tenant/Project/Execution key from the Capture idempotency key and declared content hash.
- Core computes SHA-256 over received bytes, uploads to a private bucket, streams the stored object back for byte-size/hash verification, then inserts the immutable CaptureArtifact, Audit and Outbox records.
- Capture idempotency is scoped to Tenant + ExecutionRun. Same-semantic replay returns one manifest/event; conflicting reuse is rejected. A failed database registration never synchronously deletes the deterministic uploaded object because another same-idempotency request may still be waiting to register it.
- An uploaded object without a committed manifest is an orphan candidate, not immediate garbage. It is retained for at least 24 hours and may be deleted only by a separate maintenance workflow after the complete grace period and a fresh database reference check. The request path never performs this deletion.
- Object content is hash tamper-evident and Tenant references are isolated. V0.1 does not claim regulatory WORM retention or immunity from an object-storage root administrator; a mismatched object is rejected when verified or consumed.
- `EvidenceObjectStore` is a provider-neutral port. Local development uses the MinIO adapter; production must use the Tencent Cloud COS adapter. Provider selection cannot change the storage key, hash, idempotency, orphan-retention or Tenant-isolation semantics recorded by this contract.
- A production COS bucket is infrastructure-owned and pre-created with its APPID suffix. The application writes each object with private ACL and never creates a bucket or grants public access. CAM credentials are supplied only through production secrets; temporary session tokens are supported.
- Artifact identity and payload metadata are immutable after insert.
- Object keys must include Tenant context; an object-store authorization test is required before Slice 2 completion.
- Upload completion must precede Finalization. Failed upload leaves no RawObservation and may be retried idempotently.
- Published Question content hash is the SHA-256 of the UTF-8 PostgreSQL canonical `jsonb` representation of `{schema_version, prompt_text, locale, parameters}`. The database computes and validates it.
- Published MonitoringPlanVersion content hash uses the same representation and includes platform/model/surface/locale/region, sampling configuration and the ordered QuestionVersion ID list.
- Text raw-answer hash is SHA-256 over the exact UTF-8 text bytes. An artifact-only raw-answer hash must equal the referenced CaptureArtifact byte hash; that artifact must contain response bytes and belong to the same ExecutionRun.
- Capture Manifest V1 is `{schema_version: 1, artifact_ids: [...]}`. Every ID must belong to the same Tenant, Project and ExecutionRun; the raw-answer artifact must be included. `capture_hash` is the SHA-256 of the database canonical `jsonb` representation.
- The object uploader verifies file bytes before inserting CaptureArtifact. Core API computes Question/Plan/Manifest hashes through database functions so browser, Worker and Query Engine serializers cannot create divergent hashes.

### S2-D005 — Finalization is atomic, idempotent and irreversible

```text
ObservationCandidate.CAPTURING
→ FINALIZING
→ FINALIZED
```

- The Finalize command locks the Candidate.
- Candidate representation and `response_last_seen_at` remain the immutable first-detection snapshot. Finalize inherits the exact Candidate `response_started_at`, may extend `response_last_seen_at` to the completion-detected end of the response, and may expand `TEXT` or `STRUCTURED` to final `MIXED`; it cannot discard a form already observed at first detection.
- Finalize is forbidden while the ExecutionRun remains `RUNNING`. The run must first enter `COMPLETED`, `FAILED` or `CANCELLED` with a database-recorded `completed_at`; final response time cannot precede Candidate detection or exceed that terminal lifecycle boundary.
- A Partial Answer followed by timeout is recorded in this order: Candidate and CaptureArtifact are retained, Execution transitions to `FAILED` while preserving its Response Outcome, then Finalize creates the immutable RawObservation.
- Before any object-backed finalization, Core resolves every CaptureArtifact in the Candidate Tenant/Project/Execution scope and streams the stored bytes through `EvidenceObjectStore` to re-verify byte size and SHA-256. A missing or tampered object leaves Candidate and RawObservation unchanged.
- If a RawObservation already exists, same-semantic replay returns that same row; conflicting replay is rejected.
- Otherwise it changes the Candidate to `FINALIZING`, inserts exactly one RawObservation plus Audit/Outbox, then marks the Candidate `FINALIZED` in one transaction.
- Any error rolls back the whole transaction; no partial finalized fact remains.
- `RawObservation` stores exact QuestionVersion, ExecutionRun, representation, raw answer or artifact reference, capture manifest, raw-answer hash, capture hash, execution context snapshot and response timestamps.
- `raw_observation_version` is a schema/representation version, not a revision number.
- RawObservation, CaptureArtifact and CorrectionRecord are not hard-deleted.

### S2-D006 — Fact, assessment and correction remain separate

- Slice 2 does not write A2 quality or metric-eligibility fields onto RawObservation.
- Discovering after capture that the wrong target was used preserves Candidate and raw evidence; A2 may later mark it invalid.
- Reprocessing the same RawObservation does not create a new Observation or SampleSlot.
- Re-execution creates a new ExecutionRun and may create a new Candidate/RawObservation.
- A correction appends `CorrectionRecord`; it does not update the original raw fact and is not a Review or Resolution.

### S2-D007 — Tenant isolation and transaction coupling continue from Slice 1

- Every Slice 2 domain table is `TENANT_OWNED`, directly stores immutable `tenant_id` and has forced RLS.
- The physical schema contains zero foreign keys. Repository/Command Service must resolve every relationship using `tenant_id + project_id + relation_id`, validate parent state and perform the write in the same transaction.
- Material writes append AuditEvent and snake_case OutboxEvent in the same PostgreSQL transaction.
- Worker/Query Engine commands use stable idempotency keys. Redis and queues remain rebuildable delivery state, not business truth.

## 3. Logical schema

| Table                               | Semantics                    | Primary invariant                                                   |
| ----------------------------------- | ---------------------------- | ------------------------------------------------------------------- |
| `demand_themes`                     | MUTABLE_ENTITY               | Tenant-private project taxonomy; optional for a Question            |
| `questions`                         | MUTABLE_ENTITY               | Stable editing container under one Project                          |
| `question_versions`                 | RELEASED_ARTIFACT            | exact prompt/config; immutable after publish                        |
| `monitoring_plans`                  | MUTABLE_ENTITY               | stable editing container under one Project                          |
| `monitoring_plan_versions`          | RELEASED_ARTIFACT            | immutable planned execution configuration                           |
| `monitoring_plan_version_questions` | RELEASED_ARTIFACT membership | exact ordered QuestionVersion members; parent must be DRAFT to edit |
| `sample_batches`                    | PROJECT_FACT                 | one scheduled instance of one PlanVersion                           |
| `sample_slots`                      | PROJECT_FACT                 | one statistical sample unit; retries do not add rows                |
| `execution_runs`                    | PROJECT_FACT                 | one actual run/retry with actual releases and context               |
| `capture_artifacts`                 | PROJECT_FACT                 | immutable object-storage evidence manifest                          |
| `observation_candidates`            | PROJECT_FACT                 | at most one per run; four existence predicates required             |
| `raw_observations`                  | RELEASED_ARTIFACT            | exactly one immutable finalized fact per Candidate                  |
| `correction_records`                | PROJECT_FACT                 | append-only correction/projection; original fact unchanged          |

`execution_attempt` is not a separate business table in V0.1. Each real retry is a new `ExecutionRun`; queue delivery attempts remain Outbox/Inbox delivery metadata. This avoids two competing meanings of “attempt”.

## 4. State and event contract

| Object                | Allowed transition                                                           | Notes                                                  |
| --------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| Question/Plan release | `DRAFT → PUBLISHED → DEPRECATED`                                             | published business fields immutable                    |
| ExecutionRun          | `QUEUED → RUNNING → COMPLETED/FAILED/CANCELLED`; `QUEUED → FAILED/CANCELLED` | response outcome may coexist with failure              |
| ObservationCandidate  | `CAPTURING → FINALIZING → FINALIZED`                                         | no regression; FINALIZING is transaction-local in V0.1 |
| RawObservation        | insert once                                                                  | all UPDATE/DELETE rejected                             |

`ExecutionRun` must be inserted as a clean `QUEUED` row with no actual runtime context, response outcome or lifecycle timestamps. `ObservationCandidate` must be inserted as `CAPTURING` with no finalized timestamp. Importing historical terminal facts, if ever required, needs an explicit privileged migration path rather than bypassing the normal contract.

A non-null `response_outcome_kind` requires a non-null `started_at`. `QUEUED → FAILED/CANCELLED` remains valid for startup failure only when there is no visible response outcome. A visible Answer, refusal or no-information outcome must follow `QUEUED → RUNNING` and remain associated with that started execution lifecycle.

Execution relationship commands additionally enforce:

- the SampleSlot, SampleBatch, MonitoringPlanVersion, membership, QuestionVersion and Project form one Tenant/Project chain;
- the current system PolicyRelease and optional IndustryPolicyRelease are copied into the ExecutionRun as immutable Core-assigned release IDs;
- the Tenant queue command accepts no runtime-context fields; the internal start command writes Query Engine-confirmed actual platform/model/surface/context once, and neither replay with different values nor later mutation is allowed;
- one idempotency key with identical semantics returns the same ExecutionRun and emits no duplicate event;
- different first-attempt commands for one SampleSlot are serialized, so only one can succeed;
- a retry references the latest retryable terminal ExecutionRun and increments `attempt_no` without adding a SampleSlot;
- creation and every real lifecycle transition write Audit and Outbox in the same transaction.

The Tenant-facing V1 API currently exposes the queue command only, with `sampleSlotId`, optional `retryOfExecutionRunId` and `idempotencyKey`. Start and terminal commands exist at the Repository boundary but are not exposed as unauthenticated internal HTTP endpoints; they remain reserved for the future authenticated Query Engine command boundary.

Minimum events use the existing strict snake_case envelope:

- `QuestionVersionPublished`
- `MonitoringPlanVersionPublished`
- `SampleBatchScheduled`
- `ExecutionStarted`
- `ExecutionCompleted` or `ExecutionFailed`
- `ObservationCandidateCreated`
- `ObservationFinalized`
- `ObservationCorrectionRecorded`

## 5. Query Engine boundary

Core API owns commands, identities and business transactions. The independently deployable Real AI Query Engine owns platform adapters, browser/API execution and evidence capture. It must return a versioned result envelope containing:

```text
execution_run_id
idempotency_key
actual platform / model / surface
operational outcome
optional visible response outcome
response_started_at / response_last_seen_at
correlation status + existence evidence
capture artifact manifests
```

The Query Engine uses its authenticated Start command to establish actual runtime context before capture. It may report signals; it cannot directly declare A2 validity, metric eligibility or a customer KPI. The first real platform adapter and credentials are a separate Slice 2 completion item; a mock adapter cannot satisfy the product acceptance criterion “real query”.

## 6. DDL-candidate verification set

| Test ID     | Scenario                                                     | Required result                                                 |
| ----------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| `S2-CT-001` | cross-Tenant QuestionVersion/Plan/Slot relationship          | Command Service rejects without creating relation               |
| `S2-CT-002` | edit published QuestionVersion                               | rejected                                                        |
| `S2-CT-003` | edit Plan membership after publish                           | rejected                                                        |
| `S2-CT-004` | retry a SampleSlot                                           | new ExecutionRun; SampleSlot count unchanged                    |
| `S2-CT-005` | duplicate Execution idempotency key                          | same business command cannot create a second run                |
| `S2-CT-006` | run finishes without visible response                        | Candidate insertion rejected                                    |
| `S2-CT-007` | visible refusal on operational failure                       | Candidate permitted when all four predicates hold               |
| `S2-CT-008` | Candidate predicate false                                    | database rejects                                                |
| `S2-CT-009` | duplicate Candidate for one ExecutionRun                     | unique constraint rejects                                       |
| `S2-CT-010` | finalize Candidate twice                                     | returns one identical RawObservation                            |
| `S2-CT-011` | mutate/delete RawObservation or CaptureArtifact              | rejected                                                        |
| `S2-CT-012` | finalize without raw answer/artifact or with mismatched hash | rejected                                                        |
| `S2-CT-013` | finalization Outbox write fails                              | Candidate and RawObservation transaction rolls back             |
| `S2-CT-014` | Project default binding changes after execution              | historical actual release IDs remain unchanged                  |
| `S2-CT-015` | append CorrectionRecord                                      | original RawObservation bytes/hash unchanged                    |
| `S2-CT-016` | Tenant A guesses Tenant B observation/artifact ID            | no existence disclosure                                         |
| `S2-CT-017` | first TEXT detection later completes as MIXED                | Candidate snapshot unchanged; final fact uses later window/form |
| `S2-CT-018` | referenced object is missing or byte/hash mismatched         | Finalize rejected; Candidate remains CAPTURING                  |
| `S2-CT-019` | Finalize while ExecutionRun is still RUNNING                 | Repository and database reject; no RawObservation               |

Plan publication and Plan-membership mutation additionally require two real concurrency directions: delete queued before publish, and publish queued before delete. Both operations lock the same MonitoringPlanVersion row so no committed `PUBLISHED` release can have an empty or post-publication-mutated member set.

Current database tests verify the schema/state/hash portions of this set and the real Execution, Candidate and Finalize relationship commands, including lifecycle ownership, Repository/database rejection of RUNNING Finalize, first-detection/final-response separation, parent consistency, concurrency, idempotent replay, cross-Tenant denial and Audit/Outbox rollback. Capture integration tests verify real object bytes, SHA-256, private MinIO access, Tenant reference isolation, immutable/idempotent manifest registration, tamper rejection before terminal Finalize, young-orphan retention and the concurrent same-idempotency/one-Outbox-failure race. Internal Worker/Query Engine authentication remains open product work outside the DDL freeze decision.

## 7. Frozen baseline and product completion conditions

`0002_slice_2_observation.sql` is frozen at SHA-256 `9ac60051d0fb45868d2c1b0d84bd555eb105badf46e8eff46d19f320b8cce4e0` by `slice-1-and-2-ddl-freeze-record-v1.0.md`. It must not be modified in place. Every later database structure or constraint change requires a `0003+` forward migration.

Static write-entry isolation, the read-capability split, the explicit Repository whitelist and the current Observation Outbox atomic rollback proof are complete. Their present granularity is sufficient for the independent-development stage and is not a remaining freeze blocker.

The Execution, Capture, Candidate and Finalize relationship-command sets and their underlying `0001/0002` database structures form the approved frozen baseline.

Slice 2 is not product-complete until, in addition to the database contract:

1. one real AI platform adapter executes a real QuestionVersion;
2. evidence is persisted in Tenant-isolated object storage and hash-verified;
3. Core API → Query Engine → capture → Finalize works through the async/idempotent boundary;
4. the user can inspect Slot, Execution, raw evidence and immutable Observation;
5. failure/retry telemetry and operational runbook exist.

Subsequent reviews focus on end-to-end product closure, correctness of business semantics, trustworthy and immutable data, Tenant isolation, retry/concurrency/historical-snapshot behavior, and risks that could cause structural rework.
