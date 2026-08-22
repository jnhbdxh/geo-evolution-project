# GEO OS Slice 1 + Slice 2 DDL Freeze Record V1.0

**Status:** APPROVED / FROZEN  
**Approved at:** 2026-08-22 15:21 Asia/Shanghai  
**Approved by:** Product Owner / Independent Developer  
**Scope:** Slice 1 multi-tenant foundation + Slice 2 planning, execution, capture, Candidate and immutable RawObservation  
**Database architecture:** PostgreSQL physical zero-foreign-key baseline  
**Supersedes:** Zero-Foreign-Key Rebaseline Candidate V0.1  
**Historical predecessor:** Slice 1 DDL Freeze Record V1.0 (`SUPERSEDED`)

## 1. Freeze decision

The following migrations are the approved database and core relationship-command baseline:

| Migration                      | Frozen SHA-256                                                     |
| ------------------------------ | ------------------------------------------------------------------ |
| `0001_slice_1_foundation.sql`  | `e52769e5a4a0521adef73ae96bf3fd723c078aa2077567636513352522678ab5` |
| `0002_slice_2_observation.sql` | `9ac60051d0fb45868d2c1b0d84bd555eb105badf46e8eff46d19f320b8cce4e0` |

These files must not be modified in place after this approval. Every later database structure or constraint change must use `0003` or a later forward-only migration. A later migration must not rewrite the recorded identity or history of an already applied migration.

This approval freezes the database structure and the implemented relationship-command contracts. It does not declare Slice 2 product-complete or production-deployment-ready.

## 2. Verified environment

| Item                    | Frozen verification result                                         |
| ----------------------- | ------------------------------------------------------------------ |
| Database                | PostgreSQL 17.11, Alpine Linux                                     |
| Test database           | isolated `geo_os_test` on `postgres-test:5433`                     |
| Storage                 | disposable `tmpfs`; normal development database `geo_os` untouched |
| First migration run     | `0001 → 0002` applied successfully                                 |
| Second migration run    | successful no-op                                                   |
| Database tests          | 3 files, 53 tests passed                                           |
| Capture/Finalize tests  | 1 file, 7 tests passed                                             |
| Default tests           | 11 files, 58 tests passed                                          |
| Static and build checks | TypeScript, ESLint, Prettier and Build passed                      |
| Compose                 | default and database/capture profiles passed                       |
| Dependency audit        | no known production dependency vulnerabilities                     |
| Physical foreign keys   | `0`                                                                |
| Temporary test objects  | `0`                                                                |
| MinIO test buckets      | `0`                                                                |

The migration files, the empty-database `schema_migrations` records and this freeze record contain the same SHA-256 values.

## 3. Frozen invariants

- PostgreSQL contains no physical foreign keys. Repository/Command Service owns relationship existence, Tenant/Project consistency, parent-state validation and concurrency locking.
- Tenant-owned facts use forced RLS. `CaptureArtifact`, `ObservationCandidate` and `RawObservation` have both RLS and FORCE RLS enabled.
- Query Queue cannot declare actual platform/model/surface/context. Internal Execution Start writes the actual context once, after which it is immutable.
- Candidate records the first visible-response detection fact under A1 and remains independent of A2 quality, metric eligibility and customer KPI semantics.
- CaptureArtifact freezes the Tenant/Project/Execution-scoped object reference, byte size and SHA-256; provider-neutral storage preserves MinIO/COS compatibility.
- RawObservation finalization re-verifies referenced object bytes and preserves Candidate as the immutable first-detection snapshot.
- Finalize is permitted only after ExecutionRun reaches `COMPLETED`, `FAILED` or `CANCELLED` with `completed_at`; `response_last_seen_at` cannot exceed that terminal boundary.
- Same-semantic concurrent Finalize returns one RawObservation. Conflicting replay is rejected.
- Candidate final state, RawObservation, Audit and Outbox commit atomically. Failure restores Candidate to `CAPTURING` and leaves no partial fact.
- RawObservation and CaptureArtifact reject update and deletion. Later correction is append-only and does not rewrite the original fact.

## 4. Executable evidence

The frozen test set includes:

- zero forbidden foreign-key syntax and zero live `pg_constraint.contype = 'f'` rows;
- fixed SHA-256 regression checks for both frozen migration files;
- Tenant isolation and forced RLS for relational facts and object references;
- parent-state and wrong-Tenant/wrong-Project relationship rejection;
- Execution queue/start/terminal lifecycle, release binding, retry, idempotency and concurrency;
- A1 Candidate existence predicates, first-response ownership and Outbox rollback;
- real MinIO object upload, private access, SHA-256 read-back, tamper rejection and orphan-retention behavior;
- Candidate first `TEXT` detection finalizing as the later complete `MIXED` response without Candidate mutation;
- Repository and direct-database rejection of RUNNING Finalize;
- Partial/Timeout sequencing as Candidate/Capture → Execution `FAILED` → RawObservation Finalize;
- Finalize idempotency, conflicting replay, cross-Tenant hiding and Outbox atomic rollback.

## 5. Change rule after freeze

1. Never edit either frozen migration in place.
2. Start all later schema work at `0003` and apply it forward only.
3. Record the affected domain contract, backward-compatibility impact and new migration SHA-256.
4. Re-run empty-database migration, repeated-migration no-op, default, database, object-storage, type, lint, format, build, Compose and dependency-audit checks.
5. Preserve historical observations and released artifacts; use new versions, corrections, resolutions or forward migrations rather than rewriting facts.
6. Any future decision to supersede this baseline requires an explicit new freeze record. It cannot silently alter this record or the two frozen files.

## 6. Product work outside this freeze

The following remain planned Slice 2 product work and are not defects in this frozen database baseline:

- one real AI platform adapter executing a real QuestionVersion;
- authenticated internal Core API ↔ Query Engine command boundary;
- end-to-end asynchronous execution, capture and Finalize delivery;
- customer-visible Slot, Execution, evidence and immutable Observation views;
- operational retry telemetry, capacity, disaster recovery and production runbooks;
- compliance-grade WORM or retention certification, if later required.

The next development stage must consume this baseline without modifying `0001` or `0002`.
