# GEO OS G0-02 Tenant & Identity Preparation

Status: `DRAFT / NON-BINDING PREPARATION`

Depends on: `G0-01 OPEN / PENDING REVIEW`

## Purpose

Prepare evidence, terminology, threat scenarios, and decision questions for G0-02 without closing the Gate or freezing any contract that depends on G0-01.

This document is an input inventory only. It is not an ADR, domain contract, database design, API contract, or authorization policy.

## Work allowed before G0-01 closes

- Inventory user and organization actors: platform operator, controlled third party, tenant administrator, tenant member, customer contact, and service account.
- Inventory workspace use cases for controlled third parties managing their own customers.
- Classify candidate object scopes: platform-global identity, tenant-owned object, tenant-context evidence/relationship, project-owned object, and public reference data.
- Collect identity-provider, authentication, invitation, suspension, audit, and offboarding requirements.
- Document cross-tenant threat scenarios and information-side-channel risks.
- Record identifier requirements: stability, non-reuse, public exposure, import/export, and historical references.
- Produce open questions, candidate ADR topics, and test scenarios.

## Work prohibited before dependency closure

- Do not mark G0-02 `CLOSED`, `APPROVED`, or `FROZEN`.
- Do not freeze tenant, identity, membership, customer, brand, project, or access-control schemas.
- Do not finalize PostgreSQL DDL, row-level-security rules, API payloads, or authorization middleware contracts.
- Do not make the global identity directory directly tenant-visible.
- Do not infer self-service registration, agency hierarchy, white-label, billing, or open API from tenant isolation.
- Do not use this draft to justify irreversible core-table implementation.

## Evidence inventory

| Evidence area | Questions to answer | Expected preparation output | Binding status |
|---|---|---|---|
| Tenant boundary | What data is owned by a tenant, referenced in tenant context, or platform-global? | Object-scope inventory | Non-binding |
| Third-party workspace | How is a third party opened, administered, suspended, and limited to its own customers? | Actor/use-case list | Non-binding |
| Identity lifecycle | How are users invited, activated, disabled, merged, or replaced without ID reuse? | Lifecycle scenarios | Non-binding |
| Customer hierarchy | Which relationships are access boundaries versus reporting convenience? | Relationship questions | Non-binding |
| Global identity | Which canonical objects may be deduplicated globally, and how is tenant evidence isolated? | Leakage threat scenarios | Non-binding |
| Authorization | Which actions require tenant role, project role, platform role, or explicit grant? | Permission scenario catalog | Non-binding |
| Audit | Which access, administration, impersonation, export, and policy changes must be recorded? | Audit-event inventory | Non-binding |
| Migration | How are identifiers and ownership preserved during import, correction, merge, or tenant closure? | Migration scenarios | Non-binding |

## Required threat scenarios

1. A tenant attempts to infer whether another tenant has referenced the same source or customer.
2. A third-party administrator attempts to access a customer belonging to another workspace.
3. A suspended user retains a token, background job, export link, or cached permission.
4. A service account receives broader access than its tenant/project assignment.
5. A canonical global identity is merged or corrected while historical tenant evidence must remain reproducible.
6. A project is moved, archived, or deleted while observations and snapshots remain immutable.
7. Support personnel access a tenant workspace for troubleshooting without explicit audit evidence.

## Candidate G0-02 decision topics

- Tenant and workspace terminology.
- Ownership scope classification and `tenant_id` placement rule.
- Stable identifier and non-reuse policy.
- Membership, invitation, suspension, and offboarding lifecycle.
- Tenant-context reference pattern for global canonical identity.
- Authorization enforcement layers and mandatory negative tests.
- Administrative access and impersonation audit policy.
- Import, merge, correction, and historical-reference rules.

These topics remain candidates until G0-01 confirms scope, authority, and named decision owners.

## Dependency handoff from G0-01

G0-02 contract work may begin only after the following G0-01 evidence is available:

- Approved Scope Matrix version and Gate Closure Record.
- Named product, architecture, security, data, and QA owners.
- Confirmed status of controlled third-party workspace and excluded agency/white-label capabilities.
- Approved authority and change-control ADR.
- Resolved or explicitly carried Open Decisions affecting Tenant, Identity, Customer, Brand, Project, or global identity.

## Preparation completion criteria

Preparation is complete when the evidence inventory, threat scenarios, stakeholder list, and candidate decision questions are ready for review. Preparation completion does not change the G0-02 Gate status.
