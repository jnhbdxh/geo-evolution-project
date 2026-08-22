import type { TenantContext, TenantRole } from "@geo-os/contracts";

import type { ReadDatabase, SqlExecutor } from "./database.js";

interface MembershipRow {
  membership_id: string;
  tenant_id: string;
  user_identity_id: string;
  role: TenantRole | null;
}

export const activeMembershipQuery = `SELECT m.id AS membership_id,
            m.tenant_id,
            m.user_identity_id,
            tra.role
       FROM memberships m
       JOIN tenants t ON t.id = m.tenant_id
       JOIN user_identities ui ON ui.id = m.user_identity_id
       LEFT JOIN tenant_role_assignments tra
         ON tra.tenant_id = m.tenant_id
        AND tra.membership_id = m.id
        AND tra.deactivated_at IS NULL
      WHERE m.tenant_id = $1
        AND m.user_identity_id = $2
        AND m.status = 'ACTIVE'
        AND t.status = 'ACTIVE'
        AND ui.status = 'ACTIVE'`;

export interface AccessControl {
  resolveTenantContext(userIdentityId: string, tenantId: string): Promise<TenantContext | null>;
  isPlatformAdmin(userIdentityId: string): Promise<boolean>;
}

export class PostgresAccessControl implements AccessControl {
  public constructor(private readonly database: ReadDatabase) {}

  public async resolveTenantContext(
    userIdentityId: string,
    tenantId: string,
  ): Promise<TenantContext | null> {
    return this.database.withTenantRead(tenantId, async (client) => {
      const result = await queryMembership(client, userIdentityId, tenantId);
      const first = result[0];
      if (!first) return null;

      return {
        tenantId: first.tenant_id,
        membershipId: first.membership_id,
        userIdentityId: first.user_identity_id,
        roles: result.flatMap((row) => (row.role ? [row.role] : [])),
      };
    });
  }

  public async isPlatformAdmin(userIdentityId: string): Promise<boolean> {
    return this.database.withPlatformRead(async (client) => {
      const result = await client.query(
        `SELECT 1
           FROM user_identities ui
           JOIN platform_role_assignments pra ON pra.user_identity_id = ui.id
          WHERE ui.id = $1
            AND ui.status = 'ACTIVE'
            AND pra.role = 'PLATFORM_ADMIN'
            AND pra.deactivated_at IS NULL`,
        [userIdentityId],
      );
      return result.rowCount === 1;
    });
  }
}

async function queryMembership(
  executor: SqlExecutor,
  userIdentityId: string,
  tenantId: string,
): Promise<MembershipRow[]> {
  const result = await executor.query<MembershipRow>(activeMembershipQuery, [
    tenantId,
    userIdentityId,
  ]);
  return result.rows;
}
