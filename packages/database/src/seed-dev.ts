import "dotenv/config";

import pg from "pg";

if (process.env.NODE_ENV === "production") {
  throw new Error("Development identity seeding is disabled in production");
}

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
if (!migrationUrl) throw new Error("DATABASE_MIGRATION_URL is required");

const { Client } = pg;
const client = new Client({ connectionString: migrationUrl });

try {
  await client.connect();
  await client.query("BEGIN");
  const identity = await client.query<{ id: string }>(
    `INSERT INTO user_identities(issuer, subject, email, display_name)
     VALUES ('geo-os-development', 'local-platform-admin', 'admin@geo-os.local', 'Local Platform Admin')
     ON CONFLICT (issuer, subject) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           email = EXCLUDED.email
     RETURNING id`,
  );
  const userIdentityId = identity.rows[0]?.id;
  if (!userIdentityId) throw new Error("Development identity was not returned");

  await client.query(
    `INSERT INTO platform_role_assignments(user_identity_id, role)
     SELECT $1, 'PLATFORM_ADMIN'
      WHERE NOT EXISTS (
        SELECT 1
          FROM platform_role_assignments
         WHERE user_identity_id = $1
           AND role = 'PLATFORM_ADMIN'
           AND deactivated_at IS NULL
      )`,
    [userIdentityId],
  );
  await client.query("COMMIT");
  process.stdout.write(`Development PLATFORM_ADMIN UserIdentity: ${userIdentityId}\n`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
