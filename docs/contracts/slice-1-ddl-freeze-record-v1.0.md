# GEO OS Slice 1 DDL Freeze Record V1.0

**Status:** SUPERSEDED  
**Superseded at:** 2026-08-22 Asia/Shanghai  
**Superseded by:** GEO OS Slice 1 + Slice 2 DDL Freeze Record V1.0  
**Supersession reason:** the architecture baseline changed from database-enforced relational links to zero physical foreign keys with relationship validation owned by Repository/Command Service  
**Frozen at:** 2026-08-22 09:18 Asia/Shanghai  
**Scope:** Workspace、Identity、Customer–Brand–Project、Policy/Industry Binding、Audit、Outbox  
**Migration:** `0001_slice_1_foundation.sql`  
**SHA-256:** `99f852b81f88bedb197fcf448bcd2fa0b99c6a4f85605c7c1b9ad5e52ce4c5fa`

## 1. Freeze decision

This record preserves the evidence for the original Slice 1 freeze at the checksum above. It is no longer the active schema baseline and the current `0001_slice_1_foundation.sql` intentionally no longer matches this historical checksum.

The supersession was permitted only because no production or shared database had adopted the original baseline. The replacement proved zero physical foreign keys, rebuilt the disposable database from scratch, passed the complete contract suite and was frozen by `slice-1-and-2-ddl-freeze-record-v1.0.md`.

This freeze covers structural correctness and the agreed Slice 1 contracts. It does not claim production scale, performance capacity or completion of later product slices.

## 2. Execution environment

| Item                  | Verified value                                                   |
| --------------------- | ---------------------------------------------------------------- |
| Database              | PostgreSQL 17.11, Alpine Linux                                   |
| Container             | isolated `postgres-test` Compose service                         |
| Database name         | `geo_os_test`                                                    |
| Host port             | `5433`                                                           |
| Storage               | temporary `tmpfs`; isolated from the normal development database |
| Application role      | `geo_os_app`, `NOBYPASSRLS`                                      |
| Migration role        | `geo_os_migrator`                                                |
| Migration first run   | applied successfully                                             |
| Migration second run  | successful no-op; stored checksum matched                        |
| Default test suite    | 5 files, 23 tests passed                                         |
| Database test suite   | 2 files, 16 tests passed                                         |
| Formatting/type/build | Prettier, ESLint, TypeScript and Build passed                    |
| Dependency audit      | no known production dependency vulnerabilities                   |

## 3. Contract evidence

| Contract    | Live verification result                                                        |
| ----------- | ------------------------------------------------------------------------------- |
| `S1-CT-001` | cross-Tenant context denied                                                     |
| `S1-CT-002` | historical result: cross-Tenant Customer–Brand relation rejected                |
| `S1-CT-003` | Project `customer_id` input rejected                                            |
| `S1-CT-004` | cross-Tenant Brand selection for Project rejected                               |
| `S1-CT-005` | child creation under deactivated Customer/Brand rejected                        |
| `S1-CT-006` | no hard-delete API; referenced deletion rejected                                |
| `S1-CT-007` | Project creation without Industry Binding succeeded                             |
| `S1-CT-008` | missing system PolicyRelease rolled back Project creation                       |
| `S1-CT-009` | duplicate current Binding rejected                                              |
| `S1-CT-010` | old Binding interval closed and history retained                                |
| `S1-CT-011` | injected Outbox failure rolled back the domain write                            |
| `S1-CT-012` | inactive Membership denied despite an unexpired JWT                             |
| `S1-CT-013` | Customer deactivation/Brand creation serialized in both tested queue directions |
| `S1-CT-014` | Brand deactivation/Project creation serialized in both tested queue directions  |

The two concurrency contracts use four tests in total, which is why 14 contract scenarios produce 16 database tests.

## 4. Change rule after freeze

- Historical rule at the time of this record: never edit `0001_slice_1_foundation.sql` in place.
- Supersession exception: the solo product owner explicitly authorized a one-time pre-production rebaseline to implement the new zero-foreign-key architecture principle.
- Preserve historical Binding, Audit, Outbox and released artifact semantics.
- Run the default suite and the complete database suite for every later migration.
- A breaking change requires an explicit Domain Contract version change and migration impact note.

## 5. Known limitations outside this freeze

- Production identity-provider integration is not part of Slice 1.
- Query execution, immutable Observation, Assessment/Resolution, Measurement and Snapshot belong to later slices.
- Load, capacity and disaster-recovery validation are deployment-readiness work, not DDL-freeze evidence.
