# GEO OS Zero-Foreign-Key Rebaseline Record V0.1

**Status:** APPROVED REBASELINE / CLOSED  
**Authorized at:** 2026-08-22 Asia/Shanghai  
**Frozen at:** 2026-08-22 15:21 Asia/Shanghai  
**Frozen by:** `slice-1-and-2-ddl-freeze-record-v1.0.md`  
**Scope:** Slice 1 foundation + Slice 2 Observation DDL baseline  
**Reason:** adopt the new hard architecture principle that the PostgreSQL physical schema contains zero foreign keys

## 1. Superseded baseline

The original Slice 1 freeze remains preserved in `slice-1-ddl-freeze-record-v1.0.md` with historical SHA-256:

```text
99f852b81f88bedb197fcf448bcd2fa0b99c6a4f85605c7c1b9ad5e52ce4c5fa
```

That record is `SUPERSEDED`, not deleted or rewritten as if it never existed. Rebaselining is allowed because there is no production or shared database and the isolated test database is disposable.

## 2. Approved migration identities

| Migration                      | Frozen SHA-256                                                     | Status |
| ------------------------------ | ------------------------------------------------------------------ | ------ |
| `0001_slice_1_foundation.sql`  | `e52769e5a4a0521adef73ae96bf3fd723c078aa2077567636513352522678ab5` | FROZEN |
| `0002_slice_2_observation.sql` | `9ac60051d0fb45868d2c1b0d84bd555eb105badf46e8eff46d19f320b8cce4e0` | FROZEN |

These identities were formally frozen by `slice-1-and-2-ddl-freeze-record-v1.0.md`. Neither migration may be modified in place; all later schema changes start at `0003`.

## 3. Zero-foreign-key contract

- All migration text must contain no physical foreign-key declaration syntax.
- A freshly migrated PostgreSQL database must return `0` rows for `pg_constraint.contype = 'f'`.
- Relationship columns remain explicit UUID values and normally appear with `tenant_id` and, for project facts, `project_id`.
- Repository/Command Service validates related-object existence, Tenant/Project equality, allowed parent state and actor authorization before inserting or changing a relation.
- Relationship validation and the write occur in one transaction. Competing parent-state changes use the same explicit parent-row lock protocol.
- Application roles receive no hard-delete permission for domain facts. Domain history is stopped, deprecated, corrected or replaced rather than cascaded.
- Primary keys, unique indexes, NOT NULL/CHECK constraints, RLS, immutable triggers and lifecycle state machines remain database responsibilities.
- Triggers must not be introduced merely to recreate hidden foreign-key behavior.

## 4. Satisfied freeze evidence

1. Static test scans every migration and rejects physical foreign-key declaration syntax.
2. Live PostgreSQL test proves `count(*) = 0` for `pg_constraint WHERE contype = 'f'`.
3. Cross-Tenant Brand/Project and Slice 2 relationship tests call real Repository/Command methods rather than relying on direct invalid SQL.
4. Every relationship-bearing command has negative tests for missing, wrong-Tenant, wrong-Project and inactive parent records.
5. Hard-delete API absence and application-role permission denial are verified.
6. Complete migration, default, database, type, lint, format, build, Compose and dependency-audit suites pass.

## 5. Frozen baseline and remaining product work

- Slice 1 Repository commands already validate Customer–Brand–Project, Membership and Binding relationships.
- The first Slice 2 relationship command validates Plan–QuestionVersion through `PostgresObservationRepository`, including Tenant/Project/status checks, parent locking and transaction-coupled Audit/Outbox. Injected Outbox failure proves Membership, Audit and Outbox all roll back.
- Static write-entry isolation, the read-capability split, the explicit Repository whitelist and the current Observation Outbox atomic rollback proof are complete. Their current granularity is accepted for the independent-development stage and they are no longer freeze blockers.
- The Execution relationship commands are complete. They validate the full Slot/Batch/Plan/Question/Project chain, freeze Core-assigned release IDs at queue time, allow only the internal start command to write actual runtime context once, serialize idempotency and retry creation, enforce lifecycle ownership, and couple every real state change to Audit/Outbox.
- The Capture relationship command is complete. It computes and re-verifies real object bytes, uses a private Tenant/Project/Execution-scoped provider-neutral key, and registers an immutable/idempotent manifest with Audit/Outbox. Registration failure retains the deterministic object so a concurrent same-idempotency request cannot commit a missing reference.
- An unreferenced upload is retained for a minimum 24-hour grace period and is cleanup-eligible only through a separate maintenance workflow with a fresh reference check; the Capture request path never deletes it synchronously.
- Capture object storage is provider-neutral: MinIO remains the local/test implementation and Tencent Cloud COS is the mandatory production implementation. Both adapters preserve the same object-key, SHA-256, idempotency, orphan-retention and Tenant-isolation contract; provider SDK imports are statically confined to adapter modules.
- The Candidate relationship command is complete: it implements the four explicit A1 predicates, typed existence basis, creation-time target/timeline validation, same-Execution evidence references, concurrent idempotency, RUNNING-response ownership and Audit/Outbox atomic rollback without introducing A2 validity or KPI semantics.
- The Finalize relationship command now requires a terminal ExecutionRun, separates the immutable first-detection Candidate snapshot from the completed response fact, re-verifies referenced object bytes, serializes concurrent replay, rejects conflicting replay, and commits RawObservation, Audit, Outbox and Candidate final state atomically.
- Both migrations passed final independent review and were explicitly frozen at the identities above.
- Internal Worker/Query Engine authentication remains open Slice 2 product work. Current object storage is content-hash tamper-evident and private, but no compliance WORM/retention certification is claimed.

## 6. Current executable evidence

Verified from a newly rebuilt isolated PostgreSQL 17.11 `geo_os_test` database on 2026-08-22:

- migration first run applied `0001` and `0002`; second run was a successful no-op;
- migration text forbidden-token count: `0`;
- live `pg_constraint` rows with `contype = 'f'`: `0`;
- stored migration hashes equal the two frozen files listed above;
- database tests: 3 files, 53 tests passed;
- default tests: 11 files, 58 tests passed;
- TypeScript, ESLint, Prettier, Build and both Compose configurations passed;
- official npm Registry production dependency audit reported no known vulnerabilities;
- visible Response Outcome without `started_at` was rejected, while startup failure without a Response Outcome remained valid.
- cross-Tenant Plan–QuestionVersion selection was rejected through the real Observation Repository rather than by relying on a physical relationship constraint.
- production architecture tests allow domain DML and write transactions only in the explicit Repository boundary, give AccessControl only the read interface, and prohibit Query Engine/Worker/adapter modules from importing PostgreSQL or database credentials.
- an injected Observation Outbox failure rolled back Plan membership, Audit and Outbox rows together.
- the real Execution Repository passed missing/wrong-Tenant/wrong-Project/inactive-parent, policy-context freeze, idempotency reuse, same-key concurrency, same-Slot concurrency, retry, lifecycle and terminal-result tests.
- injected Execution Outbox failures rolled back both initial run creation and a queued-to-running transition together with their Audit records.
- the Tenant queue API rejects actual platform/model/surface/context fields; a clean `QUEUED` row stores them as null, the start command writes them once, mismatched replay is rejected, and later direct mutation is blocked.
- Capture integration tests against isolated MinIO passed real-byte SHA-256 verification, private anonymous access denial, Tenant reference isolation, idempotent concurrency, tamper detection, immutable database manifest, young-orphan retention and concurrent same-idempotency safety when one Outbox transaction fails.
- Capture/Finalize integration tests: 1 file, 7 tests passed; MinIO test buckets were removed after verification.
- Finalize command tests prove both Repository and database reject RUNNING finalization, Partial/Timeout flow reaches `FAILED` before Finalize, concurrent same-semantic replay creates one RawObservation/event, conflicting or cross-Tenant commands fail, a first TEXT Candidate can finalize as a later MIXED fact without rewriting the Candidate snapshot, referenced object bytes are re-verified, and injected Outbox failure restores Candidate to CAPTURING with no RawObservation/Audit/Outbox residue.
- Provider contract tests passed production COS selection, MinIO production rejection, COS APPID bucket validation, private object ACL, provider-neutral key compatibility, idempotent replay, real-byte tamper detection and pre-request cross-Tenant rejection.

This evidence closed the physical zero-foreign-key P0, the Execution lifecycle P1, the initial write-entry isolation proof, the Observation/Finalize Outbox rollback proofs, and the Execution, Capture, Candidate and Finalize relationship-command sets. The subsequent independent review approved the formal freeze record.

## 7. Current decision status

> `0001` and `0002` are APPROVED / FROZEN at the recorded SHA-256 identities. Static write-entry isolation, Observation/Finalize Outbox atomic rollback, and Execution, Capture, Candidate and Finalize relationship commands form the frozen database baseline.

This status includes the frozen `0002` revisions that moved actual runtime-context ownership from Tenant Queue to internal Query Engine Start, added Capture idempotency and required terminal Execution before Finalize. Its frozen SHA-256 is recorded above and matches the rebuilt isolated database. Later structure changes require `0003+`.

## 8. Review focus going forward

Subsequent reviews prioritize:

1. whether the end-to-end product loop is complete and demonstrable;
2. whether business semantics match the frozen decision packs and product intent;
3. whether data is trustworthy, reproducible and protected from mutation;
4. whether Tenant isolation is enforced across storage, commands, reads and artifacts;
5. whether retry, concurrency and historical-snapshot behavior preserves deterministic results;
6. whether any decision creates a material risk of structural rework.
