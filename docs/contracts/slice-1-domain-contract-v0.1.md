# GEO OS Slice 1 Domain Contract V0.1

**Status:** ACTIVE IMPLEMENTATION CONTRACT — ZERO-FK DDL FROZEN V1.0  
**Scope:** Workspace、Identity、Customer–Brand–Project、默认 Binding、Audit、Outbox  
**Effective version:** 0.2.0  
**DDL baseline:** FROZEN — `0001_slice_1_foundation.sql`, SHA-256 `e52769e5a4a0521adef73ae96bf3fd723c078aa2077567636513352522678ab5`; see `slice-1-and-2-ddl-freeze-record-v1.0.md`

## 1. Contract decisions

### S1-D001 — Object classification uses two independent axes

- Access Scope: `PLATFORM_PRIVATE | TENANT_ROOT | TENANT_OWNED | GLOBAL_IDENTITY_WITH_TENANT_CONTEXT`.
- Record Semantics: `MUTABLE_ENTITY | PROJECT_FACT | RELEASED_ARTIFACT`.
- Every persisted domain object declares both axes.
- `TENANT_OWNED` tables directly store immutable `tenant_id`; relationship IDs are validated inside the owning Repository/Command transaction.
- The physical schema contains zero foreign keys. PostgreSQL enforces scalar/row invariants, uniqueness, RLS and state machines; it does not infer domain relationships.

### S1-D002 — Platform identity and Tenant membership are separate

- `UserIdentity` is a platform-level login identity and has no `tenant_id`.
- `Membership` links one UserIdentity to one Tenant.
- Platform roles and Tenant roles use separate tables and enums.
- V1 fixed platform role: `PLATFORM_ADMIN`.
- Slice 1 fixed Tenant roles: `TENANT_ADMIN`, `TENANT_MEMBER`.
- `CLIENT_READONLY` is not a Slice 1 role. It is reconsidered in Slice 3.

### S1-D003 — Tenant is the access root, not its own owner

- `Tenant` has Access Scope `TENANT_ROOT`.
- Tenant is provisioned only by a Platform Admin in V1.
- Tenant ID and slug are never reused.
- `SUSPENDED` blocks Tenant business access but preserves data.
- `DEACTIVATED` is terminal in V1 and never causes hard deletion.

### S1-D004 — Customer–Brand–Project is a single chain

```text
Tenant → Customer → Brand → Project
```

- Brand stores `customer_id`.
- Project stores `brand_id` and does not store `customer_id`.
- Customer is obtained through Project → Brand → Customer.
- Brand is Tenant-private in V1. No global `BrandIdentity` is introduced.
- Brand and Project commands query parents by `(tenant_id, relation_id)`, require an active parent and lock the parent row before writing.

### S1-D005 — Fixed lifecycle and no hard deletion

- Customer, Brand and Project use `ACTIVE | DEACTIVATED`.
- Deactivation records `deactivated_at` and optional `deactivation_reason`.
- IDs are never reused and referenced records are not hard deleted.
- A deactivated parent rejects creation of new active children.
- A Customer with an active Brand, or a Brand with an active Project, must deactivate its active children first.
- The last active `TENANT_ADMIN` Membership in a Tenant cannot be deactivated.
- Historical facts may continue to reference deactivated entities.

### S1-D006 — Policy and industry bindings reference immutable releases

- Slice 1 seeds one system `PolicyDefinition` and one immutable `PolicyRelease` (`GEO_OS_SYSTEM_BASE@1.0.0`).
- Every Project receives that system PolicyRelease as its initial current default binding.
- Industry Binding is optional until an anchor-industry `IndustryPolicyRelease` exists.
- A Project has at most one current binding for each PolicyDefinition.
- A Project has at most one current Industry Binding.
- Binding changes close the previous validity interval and append a new row in one transaction.
- Binding is only a future default. Execution, Assessment, Resolution and Snapshot store the actual release IDs used.

### S1-D007 — Tenant context is enforced at every boundary

- Tenant business routes require authenticated UserIdentity plus `X-Tenant-Id`.
- The server resolves an active UserIdentity, active Tenant, active Membership and fixed Tenant roles from PostgreSQL; JWT role claims are not authoritative and a deactivated identity is denied even if its Token has not expired.
- Repository transactions set PostgreSQL `app.tenant_id` locally.
- Tenant tables use Row Level Security; Repository queries always bind both Tenant ID and relation ID.
- Tenant root access uses `tenants.id = current_tenant_id()`; Platform operations require an explicit Platform Context.
- Cache keys, object paths, jobs, events and logs include tenant context.
- A denied lookup returns `404` when revealing object existence would leak cross-tenant information.

### S1-D008 — Audit and Outbox are transaction-coupled

- A material state change writes its domain row, AuditEvent and OutboxEvent in the same PostgreSQL transaction.
- Outbox payload contains `event_id`, `event_type`, `aggregate_type`, `aggregate_id`, `tenant_id`, `occurred_at`, `trace_id`, `schema_version` and domain data.
- The formal wire schema is the strict snake_case `domainEventEnvelopeSchema` in `packages/contracts`; camelCase envelope aliases are rejected.
- Redis/BullMQ delivery may be retried and is never the source of the event fact.
- Duplicate publication is handled by downstream Inbox/idempotency in later slices.
- Audit events are append-only. Outbox business payload/identity is immutable; only delivery status, attempts and delivery timestamps may change.
- Binding history only permits closing the current interval. Closed rows and published Release business fields are immutable.

## 2. Logical schema

| Table                         | Access Scope                     | Record Semantics  | Tenant column | Primary invariant                                             |
| ----------------------------- | -------------------------------- | ----------------- | ------------- | ------------------------------------------------------------- |
| `user_identities`             | PLATFORM_PRIVATE                 | MUTABLE_ENTITY    | No            | unique normalized login subject                               |
| `platform_role_assignments`   | PLATFORM_PRIVATE                 | MUTABLE_ENTITY    | No            | fixed role per identity                                       |
| `tenants`                     | TENANT_ROOT                      | MUTABLE_ENTITY    | No            | unique non-reusable slug                                      |
| `memberships`                 | TENANT_OWNED                     | MUTABLE_ENTITY    | Yes           | unique tenant + user identity                                 |
| `tenant_role_assignments`     | TENANT_OWNED                     | MUTABLE_ENTITY    | Yes           | fixed role per membership                                     |
| `customers`                   | TENANT_OWNED                     | MUTABLE_ENTITY    | Yes           | parent Tenant must match                                      |
| `brands`                      | TENANT_OWNED                     | MUTABLE_ENTITY    | Yes           | Command requires and locks same-tenant active Customer        |
| `projects`                    | TENANT_OWNED                     | MUTABLE_ENTITY    | Yes           | Command requires same-tenant active Brand; no customer_id     |
| `policy_definitions`          | PLATFORM_PRIVATE                 | MUTABLE_ENTITY    | No            | unique stable policy code                                     |
| `policy_releases`             | PLATFORM_PRIVATE                 | RELEASED_ARTIFACT | No            | unique definition + semantic version; immutable after publish |
| `industry_policy_definitions` | PLATFORM_PRIVATE                 | MUTABLE_ENTITY    | No            | unique stable industry code                                   |
| `industry_policy_releases`    | PLATFORM_PRIVATE                 | RELEASED_ARTIFACT | No            | unique definition + semantic version                          |
| `project_policy_bindings`     | TENANT_OWNED                     | PROJECT_FACT      | Yes           | one open interval per project + policy definition             |
| `project_industry_bindings`   | TENANT_OWNED                     | PROJECT_FACT      | Yes           | one open interval per project                                 |
| `audit_events`                | PLATFORM_PRIVATE or TENANT_OWNED | PROJECT_FACT      | Nullable      | immutable actor/action/target/trace record                    |
| `outbox_events`               | PLATFORM_PRIVATE or TENANT_OWNED | PROJECT_FACT      | Nullable      | immutable domain event fact with delivery state               |

## 3. Status transitions

| Entity                  | Allowed transitions                                             | Rejected transitions                     |
| ----------------------- | --------------------------------------------------------------- | ---------------------------------------- |
| Tenant                  | `ACTIVE → SUSPENDED → ACTIVE`; `ACTIVE/SUSPENDED → DEACTIVATED` | `DEACTIVATED → *`                        |
| Membership              | `ACTIVE → DEACTIVATED`                                          | `DEACTIVATED → ACTIVE` in Slice 1        |
| Customer/Brand/Project  | `ACTIVE → DEACTIVATED`                                          | `DEACTIVATED → ACTIVE` in Slice 1        |
| Policy/Industry Release | `DRAFT → PUBLISHED → DEPRECATED`                                | mutation of a PUBLISHED manifest/version |
| Binding                 | open interval → closed interval                                 | reopening or modifying a closed interval |

## 4. API contract

All endpoints use `/v1`. Success responses use `{ "data": ... }`; errors use `{ "error": { "code", "message", "traceId", "details?" } }`.

### Platform context

| Method | Endpoint                                  | Authorization  | Result                                        |
| ------ | ----------------------------------------- | -------------- | --------------------------------------------- |
| `POST` | `/platform/tenants`                       | PLATFORM_ADMIN | provision Tenant and initial admin Membership |
| `POST` | `/platform/tenants/{tenantId}/suspend`    | PLATFORM_ADMIN | suspend Tenant access                         |
| `POST` | `/platform/tenants/{tenantId}/deactivate` | PLATFORM_ADMIN | terminal deactivation                         |

### Tenant context

| Method | Endpoint                                 | Minimum role      | Result                                                               |
| ------ | ---------------------------------------- | ----------------- | -------------------------------------------------------------------- |
| `GET`  | `/context`                               | active Membership | resolved identity, Tenant and roles                                  |
| `POST` | `/memberships`                           | TENANT_ADMIN      | add an existing UserIdentity to Tenant                               |
| `POST` | `/memberships/{id}/deactivate`           | TENANT_ADMIN      | deactivate Membership; preserve one active Tenant admin              |
| `POST` | `/customers`                             | TENANT_MEMBER     | create Customer                                                      |
| `POST` | `/brands`                                | TENANT_MEMBER     | create Brand under same-tenant Customer                              |
| `POST` | `/projects`                              | TENANT_MEMBER     | create Project under same-tenant Brand and bind system PolicyRelease |
| `POST` | `/projects/{projectId}/policy-bindings`  | TENANT_ADMIN      | replace future default PolicyRelease                                 |
| `POST` | `/projects/{projectId}/industry-binding` | TENANT_ADMIN      | set/replace or clear future default IndustryPolicyRelease            |
| `POST` | `/{resource}/{id}/deactivate`            | TENANT_ADMIN      | deactivate Customer, Brand or Project                                |

List endpoints are paginated and always apply Tenant Context. Resource IDs alone never authorize access.

## 5. Transaction contracts

### Create Project

1. Resolve active UserIdentity, Tenant and Membership.
2. Load Brand through `(tenant_id, brand_id)` and require `ACTIVE`.
3. Insert Project with the request Tenant ID.
4. Resolve published system PolicyRelease.
5. Insert initial current ProjectPolicyBinding.
6. Insert AuditEvent and `ProjectCreated` OutboxEvent.
7. Commit atomically.

### Replace Project Policy Binding

1. Lock current binding for project + policy definition.
2. Validate target release is `PUBLISHED` and belongs to that definition.
3. Close current binding with `effective_to`.
4. Append new current binding with `effective_from`.
5. Insert AuditEvent and `ProjectPolicyBindingChanged` OutboxEvent.
6. Commit atomically.

## 6. Required contract tests

The following 14 scenarios are the required DDL-freeze set. All were executed successfully against an isolated PostgreSQL 17.11 `geo_os_test` database on 2026-08-22. The two concurrency scenarios each use two queue-direction tests, producing 16 live database tests in total.

| Test ID     | Scenario                                             | Required result                                          |
| ----------- | ---------------------------------------------------- | -------------------------------------------------------- |
| `S1-CT-001` | Tenant A identity requests Tenant B context          | denied without revealing Tenant B data                   |
| `S1-CT-002` | Brand in Tenant A selects Customer in Tenant B       | Repository returns not found and writes no Brand         |
| `S1-CT-003` | Project request supplies customer_id                 | API rejects unknown field; schema has no column          |
| `S1-CT-004` | Project uses Brand from another Tenant               | database/repository rejects                              |
| `S1-CT-005` | create child under deactivated parent                | domain service rejects                                   |
| `S1-CT-006` | delete Customer/Brand/Project                        | no hard-delete endpoint; application role lacks DELETE   |
| `S1-CT-007` | create Project without Industry Binding              | succeeds                                                 |
| `S1-CT-008` | create Project without system PolicyRelease          | transaction fails clearly; no partial Project            |
| `S1-CT-009` | two current bindings for same project + policy type  | partial unique index rejects                             |
| `S1-CT-010` | change default Binding                               | old interval closes; new interval opens; history remains |
| `S1-CT-011` | domain insert succeeds but Outbox insert fails       | whole transaction rolls back                             |
| `S1-CT-012` | JWT claims Tenant role but DB Membership is inactive | denied; DB state wins                                    |
| `S1-CT-013` | deactivate Customer races with create Brand          | parent row lock serializes; no active child under parent |
| `S1-CT-014` | deactivate Brand races with create Project           | parent row lock serializes; no active child under parent |

`S1-CT-013` and `S1-CT-014` each cover the lock semantics and the opposite queue order with both competing sides calling their real repository methods. They run only against an explicitly enabled, isolated `geo_os_test` database.

## 7. Deferred from Slice 1

- Client direct login and `CLIENT_READONLY` role;
- global Brand identity and cross-tenant brand deduplication;
- self-service Tenant signup, agency hierarchy, white-label, billing and open API;
- anchor-industry rules, formal KPI, attribution, strategy and intervention contracts;
- dynamic RBAC/permission editor;
- actual BullMQ publisher/consumer (only durable Outbox fact is established now).
