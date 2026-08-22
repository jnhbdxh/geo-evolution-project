import { randomUUID } from "node:crypto";

import type {
  CreateBrandInput,
  CreateCustomerInput,
  CreateMembershipInput,
  CreateProjectInput,
  CreateTenantInput,
  DeactivateEntityInput,
  ReplaceIndustryBindingInput,
  ReplacePolicyBindingInput,
  TenantContext,
} from "@geo-os/contracts";
import { domainEventEnvelopeSchema } from "@geo-os/contracts";
import type { PoolClient } from "pg";

import type { Database } from "./database.js";
import { conflict, notFound } from "./errors.js";

const systemPolicyCode = "GEO_OS_SYSTEM_BASE";

interface TenantRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: string;
  readonly created_at: Date;
}

interface CustomerRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly name: string;
  readonly status: string;
  readonly created_at: Date;
}

interface BrandRow extends CustomerRow {
  readonly customer_id: string;
}

interface ProjectRow extends CustomerRow {
  readonly brand_id: string;
}

interface MembershipRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_identity_id: string;
  readonly status: string;
  readonly created_at: Date;
}

interface BindingRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly project_id: string;
  readonly effective_from: Date;
}

export interface WorkspaceRepository {
  provisionTenant(
    input: CreateTenantInput,
    actorUserIdentityId: string,
    traceId: string,
  ): Promise<unknown>;
  createCustomer(
    context: TenantContext,
    input: CreateCustomerInput,
    traceId: string,
  ): Promise<unknown>;
  createBrand(context: TenantContext, input: CreateBrandInput, traceId: string): Promise<unknown>;
  createProject(
    context: TenantContext,
    input: CreateProjectInput,
    traceId: string,
  ): Promise<unknown>;
  createMembership(
    context: TenantContext,
    input: CreateMembershipInput,
    traceId: string,
  ): Promise<unknown>;
  deactivateMembership(
    context: TenantContext,
    membershipId: string,
    input: DeactivateEntityInput,
    traceId: string,
  ): Promise<unknown>;
  deactivateCustomer(
    context: TenantContext,
    customerId: string,
    input: DeactivateEntityInput,
    traceId: string,
  ): Promise<unknown>;
  deactivateBrand(
    context: TenantContext,
    brandId: string,
    input: DeactivateEntityInput,
    traceId: string,
  ): Promise<unknown>;
  deactivateProject(
    context: TenantContext,
    projectId: string,
    input: DeactivateEntityInput,
    traceId: string,
  ): Promise<unknown>;
  suspendTenant(
    tenantId: string,
    input: DeactivateEntityInput,
    actorUserIdentityId: string,
    traceId: string,
  ): Promise<unknown>;
  deactivateTenant(
    tenantId: string,
    input: DeactivateEntityInput,
    actorUserIdentityId: string,
    traceId: string,
  ): Promise<unknown>;
  replacePolicyBinding(
    context: TenantContext,
    projectId: string,
    input: ReplacePolicyBindingInput,
    traceId: string,
  ): Promise<unknown>;
  replaceIndustryBinding(
    context: TenantContext,
    projectId: string,
    input: ReplaceIndustryBindingInput,
    traceId: string,
  ): Promise<unknown>;
}

export class PostgresWorkspaceRepository implements WorkspaceRepository {
  public constructor(private readonly database: Database) {}

  public async provisionTenant(
    input: CreateTenantInput,
    actorUserIdentityId: string,
    traceId: string,
  ): Promise<unknown> {
    return this.database.withPlatformTransaction(async (client) => {
      const identity = await client.query(
        "SELECT id FROM user_identities WHERE id = $1 AND status = 'ACTIVE'",
        [input.initialAdminUserIdentityId],
      );
      if (identity.rowCount !== 1) throw notFound("Initial admin identity not found");

      const tenantId = randomUUID();
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const tenant = await client.query<TenantRow>(
        `INSERT INTO tenants(id, slug, name)
         VALUES ($1, $2, $3)
         RETURNING id, slug, name, status, created_at`,
        [tenantId, input.slug, input.name],
      );
      const membershipId = randomUUID();
      await client.query(
        `INSERT INTO memberships(id, tenant_id, user_identity_id)
         VALUES ($1, $2, $3)`,
        [membershipId, tenantId, input.initialAdminUserIdentityId],
      );
      await client.query(
        `INSERT INTO tenant_role_assignments(tenant_id, membership_id, role)
         VALUES ($1, $2, 'TENANT_ADMIN')`,
        [tenantId, membershipId],
      );
      await writeAuditAndOutbox(client, {
        tenantId,
        actorUserIdentityId,
        traceId,
        action: "TENANT_PROVISIONED",
        targetType: "Tenant",
        targetId: tenantId,
        eventType: "TenantProvisioned",
        payload: {
          tenantId,
          slug: input.slug,
          initialAdminUserIdentityId: input.initialAdminUserIdentityId,
        },
      });
      const row = tenant.rows[0];
      if (!row) throw notFound("Provisioned Tenant was not returned");
      return row;
    });
  }

  public async createCustomer(
    context: TenantContext,
    input: CreateCustomerInput,
    traceId: string,
  ): Promise<unknown> {
    return this.database.withTenantTransaction(context.tenantId, async (client) => {
      const customer = await client.query<CustomerRow>(
        `INSERT INTO customers(tenant_id, name)
         VALUES ($1, $2)
         RETURNING id, tenant_id, name, status, created_at`,
        [context.tenantId, input.name],
      );
      const row = customer.rows[0];
      if (!row) throw notFound("Created Customer was not returned");
      await writeAuditAndOutbox(client, {
        tenantId: context.tenantId,
        actorUserIdentityId: context.userIdentityId,
        traceId,
        action: "CUSTOMER_CREATED",
        targetType: "Customer",
        targetId: row.id,
        eventType: "CustomerCreated",
        payload: { customerId: row.id, name: input.name },
      });
      return row;
    });
  }

  public async createBrand(
    context: TenantContext,
    input: CreateBrandInput,
    traceId: string,
  ): Promise<unknown> {
    return this.database.withTenantTransaction(context.tenantId, async (client) => {
      const parent = await client.query(
        `SELECT id
           FROM customers
          WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE'
          FOR UPDATE`,
        [context.tenantId, input.customerId],
      );
      if (parent.rowCount !== 1) throw notFound("Active customer not found");

      const brand = await client.query<BrandRow>(
        `INSERT INTO brands(tenant_id, customer_id, name)
         VALUES ($1, $2, $3)
         RETURNING id, tenant_id, customer_id, name, status, created_at`,
        [context.tenantId, input.customerId, input.name],
      );
      const row = brand.rows[0];
      if (!row) throw notFound("Created Brand was not returned");
      await writeAuditAndOutbox(client, {
        tenantId: context.tenantId,
        actorUserIdentityId: context.userIdentityId,
        traceId,
        action: "BRAND_CREATED",
        targetType: "Brand",
        targetId: row.id,
        eventType: "BrandCreated",
        payload: { brandId: row.id, customerId: input.customerId, name: input.name },
      });
      return row;
    });
  }

  public async createProject(
    context: TenantContext,
    input: CreateProjectInput,
    traceId: string,
  ): Promise<unknown> {
    return this.database.withTenantTransaction(context.tenantId, async (client) => {
      const brand = await client.query(
        `SELECT b.id
           FROM brands b
           JOIN customers c ON c.tenant_id = b.tenant_id AND c.id = b.customer_id
          WHERE b.tenant_id = $1
            AND b.id = $2
            AND b.status = 'ACTIVE'
            AND c.status = 'ACTIVE'
          FOR UPDATE OF b, c`,
        [context.tenantId, input.brandId],
      );
      if (brand.rowCount !== 1) throw notFound("Active brand not found");

      const systemRelease = await client.query<{
        policy_definition_id: string;
        policy_release_id: string;
      }>(
        `SELECT pd.id AS policy_definition_id, pr.id AS policy_release_id
           FROM policy_definitions pd
           JOIN policy_releases pr ON pr.policy_definition_id = pd.id
          WHERE pd.code = $1 AND pr.status = 'PUBLISHED'
          ORDER BY pr.published_at DESC
          LIMIT 1`,
        [systemPolicyCode],
      );
      const release = systemRelease.rows[0];
      if (!release) throw conflict("Published system PolicyRelease is missing");

      const project = await client.query<ProjectRow>(
        `INSERT INTO projects(tenant_id, brand_id, name)
         VALUES ($1, $2, $3)
         RETURNING id, tenant_id, brand_id, name, status, created_at`,
        [context.tenantId, input.brandId, input.name],
      );
      const row = project.rows[0];
      if (!row) throw notFound("Created Project was not returned");
      await client.query(
        `INSERT INTO project_policy_bindings(
           tenant_id,
           project_id,
           policy_definition_id,
           policy_release_id,
           reason,
           created_by_user_identity_id
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          context.tenantId,
          row.id,
          release.policy_definition_id,
          release.policy_release_id,
          "Initial system policy binding",
          context.userIdentityId,
        ],
      );
      await writeAuditAndOutbox(client, {
        tenantId: context.tenantId,
        actorUserIdentityId: context.userIdentityId,
        traceId,
        action: "PROJECT_CREATED",
        targetType: "Project",
        targetId: row.id,
        eventType: "ProjectCreated",
        payload: {
          projectId: row.id,
          brandId: input.brandId,
          actualDefaultPolicyReleaseId: release.policy_release_id,
        },
      });
      return row;
    });
  }

  public async createMembership(
    context: TenantContext,
    input: CreateMembershipInput,
    traceId: string,
  ): Promise<unknown> {
    return this.database.withTenantTransaction(context.tenantId, async (client) => {
      const identity = await client.query(
        "SELECT id FROM user_identities WHERE id = $1 AND status = 'ACTIVE'",
        [input.userIdentityId],
      );
      if (identity.rowCount !== 1) throw notFound("Active UserIdentity not found");

      const membership = await client.query<MembershipRow>(
        `INSERT INTO memberships(tenant_id, user_identity_id)
         VALUES ($1, $2)
         ON CONFLICT (tenant_id, user_identity_id) DO NOTHING
         RETURNING id, tenant_id, user_identity_id, status, created_at`,
        [context.tenantId, input.userIdentityId],
      );
      const row = membership.rows[0];
      if (!row) throw conflict("UserIdentity already has a Membership in this Tenant");

      for (const role of input.roles) {
        await client.query(
          `INSERT INTO tenant_role_assignments(tenant_id, membership_id, role)
           VALUES ($1, $2, $3)`,
          [context.tenantId, row.id, role],
        );
      }
      await writeAuditAndOutbox(client, {
        tenantId: context.tenantId,
        actorUserIdentityId: context.userIdentityId,
        traceId,
        action: "MEMBERSHIP_CREATED",
        targetType: "Membership",
        targetId: row.id,
        eventType: "MembershipCreated",
        payload: {
          membership_id: row.id,
          user_identity_id: input.userIdentityId,
          roles: input.roles,
        },
      });
      return { ...row, roles: input.roles };
    });
  }

  public async deactivateMembership(
    context: TenantContext,
    membershipId: string,
    input: DeactivateEntityInput,
    traceId: string,
  ): Promise<unknown> {
    return this.database.withTenantTransaction(context.tenantId, async (client) => {
      const activeMemberships = await client.query<{ id: string }>(
        `SELECT id
           FROM memberships
          WHERE tenant_id = $1 AND status = 'ACTIVE'
          ORDER BY id
          FOR UPDATE`,
        [context.tenantId],
      );
      if (!activeMemberships.rows.some((row) => row.id === membershipId)) {
        throw notFound("Active Membership not found");
      }

      const activeAdmins = await client.query<{ id: string }>(
        `SELECT DISTINCT m.id
           FROM memberships m
           JOIN tenant_role_assignments tra
             ON tra.tenant_id = m.tenant_id AND tra.membership_id = m.id
          WHERE m.tenant_id = $1
            AND m.status = 'ACTIVE'
            AND tra.role = 'TENANT_ADMIN'
            AND tra.deactivated_at IS NULL`,
        [context.tenantId],
      );
      if (
        activeAdmins.rows.some((row) => row.id === membershipId) &&
        activeAdmins.rows.length === 1
      ) {
        throw conflict("The last active TENANT_ADMIN Membership cannot be deactivated");
      }

      const membership = await client.query<MembershipRow>(
        `UPDATE memberships
            SET status = 'DEACTIVATED', deactivated_at = clock_timestamp(), deactivation_reason = $3
          WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE'
          RETURNING id, tenant_id, user_identity_id, status, created_at`,
        [context.tenantId, membershipId, input.reason],
      );
      await client.query(
        `UPDATE tenant_role_assignments
            SET deactivated_at = clock_timestamp()
          WHERE tenant_id = $1 AND membership_id = $2 AND deactivated_at IS NULL`,
        [context.tenantId, membershipId],
      );
      const row = membership.rows[0];
      if (!row) throw notFound("Active Membership not found");
      await writeAuditAndOutbox(client, {
        tenantId: context.tenantId,
        actorUserIdentityId: context.userIdentityId,
        traceId,
        action: "MEMBERSHIP_DEACTIVATED",
        targetType: "Membership",
        targetId: row.id,
        eventType: "MembershipDeactivated",
        payload: { membership_id: row.id, reason: input.reason },
      });
      return row;
    });
  }

  public deactivateCustomer(
    context: TenantContext,
    customerId: string,
    input: DeactivateEntityInput,
    traceId: string,
  ): Promise<unknown> {
    return this.deactivateWorkspaceRecord(context, "Customer", customerId, input, traceId);
  }

  public deactivateBrand(
    context: TenantContext,
    brandId: string,
    input: DeactivateEntityInput,
    traceId: string,
  ): Promise<unknown> {
    return this.deactivateWorkspaceRecord(context, "Brand", brandId, input, traceId);
  }

  public deactivateProject(
    context: TenantContext,
    projectId: string,
    input: DeactivateEntityInput,
    traceId: string,
  ): Promise<unknown> {
    return this.deactivateWorkspaceRecord(context, "Project", projectId, input, traceId);
  }

  public suspendTenant(
    tenantId: string,
    input: DeactivateEntityInput,
    actorUserIdentityId: string,
    traceId: string,
  ): Promise<unknown> {
    return this.changeTenantStatus(tenantId, "SUSPENDED", input, actorUserIdentityId, traceId);
  }

  public deactivateTenant(
    tenantId: string,
    input: DeactivateEntityInput,
    actorUserIdentityId: string,
    traceId: string,
  ): Promise<unknown> {
    return this.changeTenantStatus(tenantId, "DEACTIVATED", input, actorUserIdentityId, traceId);
  }

  public async replacePolicyBinding(
    context: TenantContext,
    projectId: string,
    input: ReplacePolicyBindingInput,
    traceId: string,
  ): Promise<unknown> {
    return this.database.withTenantTransaction(context.tenantId, async (client) => {
      await requireActiveProject(client, context.tenantId, projectId);
      const releaseResult = await client.query<{
        policy_definition_id: string;
        policy_release_id: string;
      }>(
        `SELECT policy_definition_id, id AS policy_release_id
           FROM policy_releases
          WHERE id = $1 AND status = 'PUBLISHED'`,
        [input.policyReleaseId],
      );
      const release = releaseResult.rows[0];
      if (!release) throw notFound("Published PolicyRelease not found");

      const currentResult = await client.query<{
        id: string;
        policy_release_id: string;
      }>(
        `SELECT id, policy_release_id
           FROM project_policy_bindings
          WHERE tenant_id = $1
            AND project_id = $2
            AND policy_definition_id = $3
            AND effective_to IS NULL
          FOR UPDATE`,
        [context.tenantId, projectId, release.policy_definition_id],
      );
      const current = currentResult.rows[0];
      if (current?.policy_release_id === release.policy_release_id) {
        throw conflict("PolicyRelease is already the current default");
      }
      const changedAt = await databaseTimestamp(client);
      if (current) {
        await client.query(`UPDATE project_policy_bindings SET effective_to = $2 WHERE id = $1`, [
          current.id,
          changedAt,
        ]);
      }
      const binding = await client.query<BindingRow>(
        `INSERT INTO project_policy_bindings(
           tenant_id, project_id, policy_definition_id, policy_release_id,
           effective_from, reason, created_by_user_identity_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, tenant_id, project_id, effective_from`,
        [
          context.tenantId,
          projectId,
          release.policy_definition_id,
          release.policy_release_id,
          changedAt,
          input.reason,
          context.userIdentityId,
        ],
      );
      const row = binding.rows[0];
      if (!row) throw notFound("Created ProjectPolicyBinding was not returned");
      await writeAuditAndOutbox(client, {
        tenantId: context.tenantId,
        actorUserIdentityId: context.userIdentityId,
        traceId,
        action: "PROJECT_POLICY_BINDING_CHANGED",
        targetType: "Project",
        targetId: projectId,
        eventType: "ProjectPolicyBindingChanged",
        payload: {
          project_id: projectId,
          policy_definition_id: release.policy_definition_id,
          policy_release_id: release.policy_release_id,
          binding_id: row.id,
          reason: input.reason,
        },
      });
      return { ...row, policy_release_id: release.policy_release_id };
    });
  }

  public async replaceIndustryBinding(
    context: TenantContext,
    projectId: string,
    input: ReplaceIndustryBindingInput,
    traceId: string,
  ): Promise<unknown> {
    return this.database.withTenantTransaction(context.tenantId, async (client) => {
      await requireActiveProject(client, context.tenantId, projectId);
      const currentResult = await client.query<{
        id: string;
        industry_policy_release_id: string;
      }>(
        `SELECT id, industry_policy_release_id
           FROM project_industry_bindings
          WHERE tenant_id = $1 AND project_id = $2 AND effective_to IS NULL
          FOR UPDATE`,
        [context.tenantId, projectId],
      );
      const current = currentResult.rows[0];

      if (input.industryPolicyReleaseId === null) {
        if (!current) return { project_id: projectId, industry_policy_release_id: null };
        const changedAt = await databaseTimestamp(client);
        await client.query(`UPDATE project_industry_bindings SET effective_to = $2 WHERE id = $1`, [
          current.id,
          changedAt,
        ]);
        await writeAuditAndOutbox(client, {
          tenantId: context.tenantId,
          actorUserIdentityId: context.userIdentityId,
          traceId,
          action: "PROJECT_INDUSTRY_BINDING_CLEARED",
          targetType: "Project",
          targetId: projectId,
          eventType: "ProjectIndustryBindingChanged",
          payload: {
            project_id: projectId,
            industry_policy_release_id: null,
            reason: input.reason,
          },
        });
        return { project_id: projectId, industry_policy_release_id: null };
      }

      const releaseResult = await client.query<{
        industry_policy_definition_id: string;
        industry_policy_release_id: string;
      }>(
        `SELECT industry_policy_definition_id, id AS industry_policy_release_id
           FROM industry_policy_releases
          WHERE id = $1 AND status = 'PUBLISHED'`,
        [input.industryPolicyReleaseId],
      );
      const release = releaseResult.rows[0];
      if (!release) throw notFound("Published IndustryPolicyRelease not found");
      if (current?.industry_policy_release_id === release.industry_policy_release_id) {
        throw conflict("IndustryPolicyRelease is already the current default");
      }
      const changedAt = await databaseTimestamp(client);
      if (current) {
        await client.query(`UPDATE project_industry_bindings SET effective_to = $2 WHERE id = $1`, [
          current.id,
          changedAt,
        ]);
      }
      const binding = await client.query<BindingRow>(
        `INSERT INTO project_industry_bindings(
           tenant_id, project_id, industry_policy_definition_id, industry_policy_release_id,
           effective_from, reason, created_by_user_identity_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, tenant_id, project_id, effective_from`,
        [
          context.tenantId,
          projectId,
          release.industry_policy_definition_id,
          release.industry_policy_release_id,
          changedAt,
          input.reason,
          context.userIdentityId,
        ],
      );
      const row = binding.rows[0];
      if (!row) throw notFound("Created ProjectIndustryBinding was not returned");
      await writeAuditAndOutbox(client, {
        tenantId: context.tenantId,
        actorUserIdentityId: context.userIdentityId,
        traceId,
        action: "PROJECT_INDUSTRY_BINDING_CHANGED",
        targetType: "Project",
        targetId: projectId,
        eventType: "ProjectIndustryBindingChanged",
        payload: {
          project_id: projectId,
          industry_policy_definition_id: release.industry_policy_definition_id,
          industry_policy_release_id: release.industry_policy_release_id,
          binding_id: row.id,
          reason: input.reason,
        },
      });
      return { ...row, industry_policy_release_id: release.industry_policy_release_id };
    });
  }

  private async deactivateWorkspaceRecord(
    context: TenantContext,
    resourceType: "Customer" | "Brand" | "Project",
    resourceId: string,
    input: DeactivateEntityInput,
    traceId: string,
  ): Promise<unknown> {
    return this.database.withTenantTransaction(context.tenantId, async (client) => {
      if (resourceType === "Customer") {
        await lockActiveWorkspaceParent(client, "customers", context.tenantId, resourceId);
        const children = await client.query(
          `SELECT 1 FROM brands WHERE tenant_id = $1 AND customer_id = $2 AND status = 'ACTIVE' LIMIT 1`,
          [context.tenantId, resourceId],
        );
        if (children.rowCount) throw conflict("Deactivate active Brands before the Customer");
      }
      if (resourceType === "Brand") {
        await lockActiveWorkspaceParent(client, "brands", context.tenantId, resourceId);
        const children = await client.query(
          `SELECT 1 FROM projects WHERE tenant_id = $1 AND brand_id = $2 AND status = 'ACTIVE' LIMIT 1`,
          [context.tenantId, resourceId],
        );
        if (children.rowCount) throw conflict("Deactivate active Projects before the Brand");
      }

      const updateQuery =
        resourceType === "Customer"
          ? `UPDATE customers
                SET status = 'DEACTIVATED', deactivated_at = clock_timestamp(), deactivation_reason = $3
              WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE'
              RETURNING id, status`
          : resourceType === "Brand"
            ? `UPDATE brands
                  SET status = 'DEACTIVATED', deactivated_at = clock_timestamp(), deactivation_reason = $3
                WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE'
                RETURNING id, status`
            : `UPDATE projects
                  SET status = 'DEACTIVATED', deactivated_at = clock_timestamp(), deactivation_reason = $3
                WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE'
                RETURNING id, status`;
      const result = await client.query<{ id: string; status: string }>(updateQuery, [
        context.tenantId,
        resourceId,
        input.reason,
      ]);
      const row = result.rows[0];
      if (!row) throw notFound(`Active ${resourceType} not found`);
      const eventStem = resourceType.toUpperCase();
      await writeAuditAndOutbox(client, {
        tenantId: context.tenantId,
        actorUserIdentityId: context.userIdentityId,
        traceId,
        action: `${eventStem}_DEACTIVATED`,
        targetType: resourceType,
        targetId: resourceId,
        eventType: `${resourceType}Deactivated`,
        payload: { [`${resourceType.toLowerCase()}_id`]: resourceId, reason: input.reason },
      });
      return row;
    });
  }

  private async changeTenantStatus(
    tenantId: string,
    targetStatus: "SUSPENDED" | "DEACTIVATED",
    input: DeactivateEntityInput,
    actorUserIdentityId: string,
    traceId: string,
  ): Promise<unknown> {
    return this.database.withTenantTransaction(tenantId, async (client) => {
      const result = await client.query<TenantRow>(
        targetStatus === "SUSPENDED"
          ? `UPDATE tenants SET status = 'SUSPENDED'
               WHERE id = $1 AND status = 'ACTIVE'
               RETURNING id, slug, name, status, created_at`
          : `UPDATE tenants
                SET status = 'DEACTIVATED', deactivated_at = clock_timestamp(), deactivation_reason = $2
              WHERE id = $1 AND status IN ('ACTIVE', 'SUSPENDED')
              RETURNING id, slug, name, status, created_at`,
        targetStatus === "SUSPENDED" ? [tenantId] : [tenantId, input.reason],
      );
      const row = result.rows[0];
      if (!row) throw notFound(`Tenant cannot transition to ${targetStatus}`);
      await writeAuditAndOutbox(client, {
        tenantId,
        actorUserIdentityId,
        traceId,
        action: `TENANT_${targetStatus}`,
        targetType: "Tenant",
        targetId: tenantId,
        eventType: targetStatus === "SUSPENDED" ? "TenantSuspended" : "TenantDeactivated",
        payload: { tenant_id: tenantId, status: targetStatus, reason: input.reason },
      });
      return row;
    });
  }
}

async function requireActiveProject(
  client: PoolClient,
  tenantId: string,
  projectId: string,
): Promise<void> {
  const project = await client.query(
    `SELECT id FROM projects WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE' FOR UPDATE`,
    [tenantId, projectId],
  );
  if (project.rowCount !== 1) throw notFound("Active Project not found");
}

async function lockActiveWorkspaceParent(
  client: PoolClient,
  tableName: "customers" | "brands",
  tenantId: string,
  resourceId: string,
): Promise<void> {
  const query =
    tableName === "customers"
      ? `SELECT id FROM customers
          WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE'
          FOR UPDATE`
      : `SELECT id FROM brands
          WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE'
          FOR UPDATE`;
  const parent = await client.query(query, [tenantId, resourceId]);
  if (parent.rowCount !== 1) {
    throw notFound(`Active ${tableName === "customers" ? "Customer" : "Brand"} not found`);
  }
}

async function databaseTimestamp(client: PoolClient): Promise<Date> {
  const result = await client.query<{ changed_at: Date }>("SELECT clock_timestamp() AS changed_at");
  const changedAt = result.rows[0]?.changed_at;
  if (!changedAt) throw new Error("Database timestamp was not returned");
  return changedAt;
}

interface DomainEventInput {
  readonly tenantId: string;
  readonly actorUserIdentityId: string;
  readonly traceId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

async function writeAuditAndOutbox(client: PoolClient, input: DomainEventInput): Promise<void> {
  const eventId = randomUUID();
  const occurredAt = new Date().toISOString();
  const envelope = domainEventEnvelopeSchema.parse({
    event_id: eventId,
    event_type: input.eventType,
    tenant_id: input.tenantId,
    aggregate_type: input.targetType,
    aggregate_id: input.targetId,
    schema_version: 1,
    occurred_at: occurredAt,
    trace_id: input.traceId,
    data: input.payload,
  });
  await client.query(
    `INSERT INTO audit_events(
       tenant_id, actor_user_identity_id, action, target_type, target_id, trace_id, details
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      input.tenantId,
      input.actorUserIdentityId,
      input.action,
      input.targetType,
      input.targetId,
      input.traceId,
      JSON.stringify(input.payload),
    ],
  );
  await client.query(
    `INSERT INTO outbox_events(
       id, tenant_id, aggregate_type, aggregate_id, event_type, payload, trace_id, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [
      eventId,
      input.tenantId,
      input.targetType,
      input.targetId,
      input.eventType,
      JSON.stringify(envelope),
      input.traceId,
      occurredAt,
    ],
  );
}
