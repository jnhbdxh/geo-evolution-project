# GEO OS

GEO OS is a multi-tenant GEO decision and action operating system. V1 supports platform-provisioned third-party Tenant Workspaces that manage their own customers, brands, projects, observations, measurements, diagnoses, interventions, and reports.

The Commercial MVP target is complete customer-facing product code with one anchor industry's minimum formal rule pack. Later industry expansion should add or upgrade versioned rules and strategies without rebuilding the core domain model.

## Product baseline

- [Commercial MVP Product Baseline](docs/product/GEO_OS_Commercial_MVP_Product_Baseline_V1.0.md)
- [Product Object Map](docs/product/GEO_OS_Product_Object_Map_V0.1.md)
- [Product Slice Implementation Map](docs/product/GEO_OS_Product_Slice_Implementation_Map_V0.1.md)

The delivery path is:

```text
Workspace
→ Real Query & Immutable Observation
→ Resolution, Measurement & Snapshot
→ Anchor-industry Formal KPI
→ GEO Intelligence
→ Intervention & Effect Evidence
```

## Architecture baseline

The current technical direction remains: modular monolith for core domain semantics, independent Real AI Query Engine and AI/Data Worker, PostgreSQL as the business fact store, object storage for large evidence, and Redis only for rebuildable runtime state.

## Current artifacts

- Technical baseline: `docs/architecture/GEO_OS_Technical_Architecture_Reconciliation_V1.1.docx`
- Historical product-alignment draft (not the active baseline): `outputs/product-v1.1/GEO_OS_产品方案对齐修订版_V1.1.docx`
- Product leadership deck: `outputs/leadership/GEO_OS_Product_Direction_Commercial_MVP_Decision_Deck_V1.0.pptx`
- Historical G0-01 review package: `outputs/g0-01/`

## Lightweight project control

This is currently a solo developer/product-owner project. Multi-person owner assignment, backup-owner nomination, meeting signatures, and approval-role completeness are not development blockers.

Only decisions that protect product integrity remain hard constraints:

- Tenant and identity boundaries;
- immutable observation lifecycle;
- Assessment/Review/Resolution semantics;
- actual policy-release binding;
- asynchronous idempotency;
- Snapshot membership and historical replacement.

For each material decision, record the decision, rationale, affected contracts/tests, and effective version. The earlier G0-01 documents remain historical review inputs; their multi-person workflow assumptions do not block implementation.

## Reproducible artifact builders

The scripts under `tools/artifact_builders/` are version-controlled build sources. Their runtime requirements, outputs, non-overwrite rule, and rendering limitations are documented in `tools/artifact_builders/README.md`.

## Slice 1 foundation and Slice 2 observation contract

- API modular-monolith skeleton: `apps/api/`
- Shared runtime contracts: `packages/contracts/`
- PostgreSQL migrations and local seed: `packages/database/`
- Slice 1 Domain Contract: `docs/contracts/slice-1-domain-contract-v0.1.md`
- Historical Slice 1 DDL Freeze Record (`SUPERSEDED`): `docs/contracts/slice-1-ddl-freeze-record-v1.0.md`
- Approved Slice 1 + Slice 2 DDL Freeze Record: `docs/contracts/slice-1-and-2-ddl-freeze-record-v1.0.md`
- Closed Zero-Foreign-Key Rebaseline Record: `docs/contracts/zero-foreign-key-rebaseline-v0.1.md`
- Slice 2 Observation Domain Contract: `docs/contracts/slice-2-observation-domain-contract-v0.1.md`
- Frozen Slice 2 DDL: `packages/database/migrations/0002_slice_2_observation.sql`

Implemented Slice 1 commands cover Tenant provisioning/suspension/deactivation, Membership creation/deactivation, Customer–Brand–Project creation/deactivation, and versioned Policy/Industry default Binding changes. Every actual state change uses explicit authorization, a PostgreSQL transaction, AuditEvent and the durable Outbox envelope; an idempotent no-op emits no event.

Production database writes are restricted to the explicit Repository boundary. Static architecture tests reject DML, write transactions or write-capable Database imports in Routes, Services, Workers and adapters; Query Engine and AI/Data Worker modules must submit commands/events and receive no PostgreSQL credentials.

This write-entry isolation, the current read-only interface and Repository whitelist, and the current Observation Outbox atomic rollback proof are accepted for the independent-development stage. The Execution relationship commands are also complete, including idempotency, retry, lifecycle, release binding, concurrency and transaction rollback. Tenant Queue cannot declare actual runtime facts: the internal Query Engine Start command writes actual platform/model/surface/context once and those values are then immutable. Capture is complete through the internal service boundary: real object bytes are hash-verified through the provider-neutral port, private Tenant references are enforced, and manifests are immutable/idempotent. A failed registration never synchronously deletes its deterministic object; an unreferenced object becomes cleanup-eligible only after the minimum grace period. The A1 Candidate command is complete with four explicit existence predicates, typed existence evidence, creation-time target/timeline checks, concurrent idempotency and atomic ResponseOutcome/Audit/Outbox writes. Finalize requires the ExecutionRun to be `COMPLETED`, `FAILED` or `CANCELLED`, preserves Candidate as the first-detection snapshot, records the later complete response window/form, re-verifies referenced object bytes, and commits one immutable RawObservation with Audit/Outbox atomically. `0001` and `0002` are formally frozen; all later schema changes must use `0003+` forward migrations.

Prerequisites: Node.js 24+, pnpm, and Docker Desktop for local PostgreSQL/Redis/MinIO.

```powershell
Copy-Item .env.example .env
pnpm install
docker compose up -d
pnpm db:migrate
pnpm db:seed:dev
pnpm dev
```

Verification:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Database contract and concurrency tests require an isolated, migrated `geo_os_test` database and explicit opt-in. The test service uses temporary storage and is separate from the normal development database:

```powershell
docker compose --profile database-test up -d postgres-test
$env:DATABASE_MIGRATION_URL = "postgresql://geo_os_migrator:geo_os_migrator@127.0.0.1:5433/geo_os_test"
pnpm db:migrate
$env:TEST_DATABASE_URL = "postgresql://geo_os_app:geo_os_app@127.0.0.1:5433/geo_os_test"
$env:TEST_DATABASE_MIGRATION_URL = "postgresql://geo_os_migrator:geo_os_migrator@127.0.0.1:5433/geo_os_test"
$env:ALLOW_DATABASE_INTEGRATION_TESTS = "true"
pnpm test:db
```

Capture tests additionally require the isolated MinIO service and explicit opt-in:

```powershell
docker compose --profile database-test --profile capture-test up -d postgres-test minio-test
$env:TEST_OBJECT_STORAGE_ENDPOINT = "http://127.0.0.1:9100"
$env:TEST_OBJECT_STORAGE_ACCESS_KEY = "geo_os_minio_test"
$env:TEST_OBJECT_STORAGE_SECRET_KEY = "geo_os_minio_test_secret"
$env:ALLOW_OBJECT_STORAGE_INTEGRATION_TESTS = "true"
pnpm test:capture
```

The test runner refuses any database name other than `geo_os_test`. Removing the `postgres-test` container discards its temporary database; no test records are written to the normal `geo_os` development database.

The original Slice 1 DDL freeze from 2026-08-22 is preserved as historical evidence but has been marked `SUPERSEDED`. Before any production or shared database existed, the product owner authorized a one-time rebaseline to adopt a zero-foreign-key physical schema. The replacement `0001` and Slice 2 `0002` passed final review and are frozen by `docs/contracts/slice-1-and-2-ddl-freeze-record-v1.0.md`.

### Evidence object storage

Capture depends only on the provider-neutral `EvidenceObjectStore` port. Local development and isolated integration tests use MinIO; production configuration is required to select Tencent Cloud COS through `OBJECT_STORAGE_PROVIDER=cos`. Both adapters use the same Tenant/Project/Execution key convention, real-byte SHA-256 verification, immutable manifest, idempotency and age-gated orphan-retention contract. Vendor SDK imports are restricted to their adapters.

The production COS bucket must be created by infrastructure in advance, remain private, include its APPID suffix, and grant the runtime identity only the required object operations. The application never creates a COS bucket or enables public access. See `.env.example` for the mutually exclusive MinIO and COS settings.

Slice 2 is now in active implementation on the frozen `0001/0002` baseline. The planning/execution/capture/Candidate/Finalize/immutable-Observation data chain has passed live PostgreSQL and MinIO contract tests. This database freeze does **not** satisfy Slice 2 product completion: the authenticated Core API/Query Engine async boundary and customer inspection flow remain to be implemented, and one real AI platform adapter must complete a real query before Slice 2 can be accepted.
