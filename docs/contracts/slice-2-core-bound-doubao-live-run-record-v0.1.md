# GEO OS Slice 2 — Core-bound Doubao Live Run Record V0.1

- **Status:** PASSED
- **Repository state:** IMPLEMENTED_IN_WORKTREE
- **Committed implementation base:** `811e0271148caaa8f9e8e68c1ea31fbf92b909a9`
- **Executed at:** 2026-08-25 12:38 CST
- **Environment:** isolated PostgreSQL 17, Redis 7, BullMQ, MinIO and headed Chromium
- **Authorization basis:** product owner completed and authorized the Doubao Web login

## 1. Acceptance scope

This record closes Slice 2 runtime-contract milestone A for one single-instance live run. It
proves that an Execution queued through Core reaches BullMQ and Query Engine, uses the
Core-bound command surface, stores evidence, finalizes a Candidate and produces one
RawObservation. It does not accept milestone B production enablement, production A1,
multi-instance lease/fencing or ambiguous-side-effect recovery.

## 2. Accepted run

| Field                                 | Accepted value                                                     |
| ------------------------------------- | ------------------------------------------------------------------ |
| ExecutionRun                          | `564fc8d5-6311-4d5b-85f1-38c615c8f0bc`                             |
| ExecutionQueued event / BullMQ Job    | `8cb5c358-7a7c-401c-8c9c-375eac02537c`                             |
| Trace                                 | `dddddddd-dddd-4ddd-8ddd-dddddddddddd`                             |
| Prompt                                | `请只回答：GEO OS Trace 垂直链联调成功`                            |
| Operational status / response outcome | `COMPLETED / ANSWER`                                               |
| Actual platform / model / surface     | `doubao / 豆包 快速 / doubao_web`                                  |
| ObservationCandidate                  | `4c9eb03e-52b6-417c-8cf5-af4e946000af` (`FINALIZED`)               |
| RawObservation                        | `c855d6cf-8a29-4e90-82b1-8fa71867ec4b`                             |
| Raw answer SHA-256                    | `38d6dc7fb66dfa69d94f8a0dcf6cfe36bf865b4238e5a460143018fdb99d7efb` |

The test fixture and service credentials existed only in the isolated local environment.
Doubao StorageState remained outside the repository and is not part of this evidence.

## 3. Evidence identity

Five CaptureArtifacts were registered through Core and verified during finalization:

| Kind                  |  Bytes | SHA-256                                                            |
| --------------------- | -----: | ------------------------------------------------------------------ |
| `RAW_RESPONSE`        |     34 | `38d6dc7fb66dfa69d94f8a0dcf6cfe36bf865b4238e5a460143018fdb99d7efb` |
| `SCREENSHOT`          | 69,462 | `3c35b11b97c627a8c7b828aa854b0c1484b1e8c20c22eb824391c245f71f9a65` |
| `SCREENSHOT`          |  2,501 | `05ac51e10793aa1fc7a0185c3b8dc3aa61f84ae50771db8d1a8c0a50d22fe945` |
| `STRUCTURED_RESPONSE` |  1,548 | `d69224d3dd84c5258d12617144d1456457beef0b6b7499ec6981384feb02abce` |
| `TRACE`               |  2,835 | `81d5ac6dcf8027b76efcfda424342504549d9b4fb8640c2383c2887465d949e1` |

All ten related Outbox events reached `PUBLISHED`. The ten related AuditEvents and all
related Outbox events used the accepted Trace ID. API request logs also retained that ID
from Execution creation through Claim, assignment, start, Capture, complete and Finalize.

## 4. Milestone A decision

The seven `VERTICAL_CHAIN_READY` conditions in the active asynchronous runtime contract
are satisfied for the declared single-instance environment:

1. Dispatcher identity, RLS, shared-role rejection, dedicated pool and bounded publication
   are covered by committed database and queue tests.
2. PostgreSQL Outbox to BullMQ delivery and recoverable Redis failure are covered by the
   committed dispatcher integration.
3. A real PostgreSQL + BullMQ test executes the first delivery once, closes the Consumer,
   redelivers the same event after restart and reuses the single durable terminal result
   without repeating the execution side effect
   (`tests/slice-2-consumer-restart.queue.integration.ts`).
4. Query Engine has no PostgreSQL credentials and writes only through scoped Core commands.
5. The accepted live run produced evidence, a finalized Candidate, a terminal ExecutionRun
   and a RawObservation.
6. Post-submit ambiguity is fenced from automatic replay and remains an explicit operator
   recovery gap for milestone B.
7. One Trace correlates API, Outbox, Job, Execution, evidence and Observation facts.

`VERTICAL_CHAIN_READY` is accepted. `PRODUCTION_ENABLEMENT_READY` remains
`NOT_STARTED`.
