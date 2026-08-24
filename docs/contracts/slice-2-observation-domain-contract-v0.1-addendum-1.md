# GEO OS Slice 2 Observation Domain Contract V0.1 Addendum 1

- **Status:** WORKING ADDENDUM
- **Repository state:** IMPLEMENTED_IN_WORKTREE
- **Effective date:** 2026-08-24
- **Parent:** `slice-2-observation-domain-contract-v0.1.md`
- **Purpose:** Record later implementation progress without rewriting the parent contract's historical state.

## 1. DDL identity clarification

- Upstream DDL: `0001_slice_1_foundation.sql`;
- Current Slice 2 DDL: `0002_slice_2_observation.sql`;
- Combined implemented database baseline: FROZEN `0001 + 0002` under `slice-1-and-2-ddl-freeze-record-v1.0.md`.

This Addendum does not modify either migration or the Freeze Record.

## 2. Authenticated internal HTTP boundary

The parent contract's statement that Start and terminal commands were reserved for a future authenticated Query Engine boundary was accurate at its effective implementation point. That boundary has since been implemented in the current worktree at:

```text
/v1/internal/execution-runs/:executionRunId/assignment
/v1/internal/execution-runs/:executionRunId/start
/v1/internal/execution-runs/:executionRunId/capture-artifacts
/v1/internal/execution-runs/:executionRunId/observation-candidates
/v1/internal/execution-runs/:executionRunId/complete
/v1/internal/execution-runs/:executionRunId/fail
/v1/internal/execution-runs/:executionRunId/cancel
/v1/internal/execution-runs/:executionRunId/finalize
```

The detailed current boundary is defined by `core-bound-query-execution-contract-v0.1.md`. Its repository state remains `IMPLEMENTED_IN_WORKTREE`, not a committed or released baseline.

## 3. Remaining Slice 2 product work

- durable Outbox/queue dispatch and consumer idempotency;
- versioned production A1 detector;
- one real Core-bound Doubao run through PostgreSQL and object storage;
- ambiguous browser-side-effect recovery;
- Tenant operator and authorized project-member Execution/Observation inspection flow.

The existence of internal HTTP commands does not establish Slice 2 product completion.
