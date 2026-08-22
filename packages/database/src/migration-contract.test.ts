import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

let migration = "";
let allMigrations = "";
const migrationsDirectory = path.resolve(process.cwd(), "packages/database/migrations");
const frozenMigrationIdentities = new Map([
  [
    "0001_slice_1_foundation.sql",
    "e52769e5a4a0521adef73ae96bf3fd723c078aa2077567636513352522678ab5",
  ],
  [
    "0002_slice_2_observation.sql",
    "9ac60051d0fb45868d2c1b0d84bd555eb105badf46e8eff46d19f320b8cce4e0",
  ],
] as const);

beforeAll(async () => {
  migration = await readFile(path.join(migrationsDirectory, "0001_slice_1_foundation.sql"), "utf8");
  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql"));
  allMigrations = (
    await Promise.all(
      files.map(async (file) => readFile(path.join(migrationsDirectory, file), "utf8")),
    )
  ).join("\n");
});

describe("Slice 1 migration contract", () => {
  it("preserves the approved frozen migration identities", async () => {
    for (const [fileName, expectedSha256] of frozenMigrationIdentities) {
      const bytes = await readFile(path.join(migrationsDirectory, fileName));
      const actualSha256 = createHash("sha256").update(bytes).digest("hex");
      expect(actualSha256, fileName).toBe(expectedSha256);
    }
  });

  it("keeps Tenant as a root without a self-owned tenant_id", () => {
    expect(tableDefinition("tenants")).not.toContain("tenant_id");
  });

  it("stores brand_id but not customer_id on Project", () => {
    const project = tableDefinition("projects");
    expect(project).toContain("brand_id uuid NOT NULL");
    expect(project).not.toContain("customer_id");
  });

  it("uses relation IDs without database foreign keys", () => {
    expect(tableDefinition("brands")).toContain("customer_id uuid NOT NULL");
    expect(tableDefinition("projects")).toContain("brand_id uuid NOT NULL");
    expect(allMigrations).not.toMatch(/\bFOREIGN\s+KEY\b|\bREFERENCES\b|\bON\s+DELETE\b/iu);
  });

  it("seeds the system PolicyRelease and allows no Industry Binding row", () => {
    expect(migration).toContain("GEO_OS_SYSTEM_BASE");
    expect(migration).toContain("1.0.0");
    expect(tableDefinition("projects")).not.toContain("industry_policy_release_id");
  });

  it("allows only one current binding", () => {
    expect(migration).toContain("project_policy_bindings_one_current");
    expect(migration).toContain("project_industry_bindings_one_current");
    expect(migration.match(/WHERE effective_to IS NULL;/gu)).toHaveLength(2);
  });

  it("enables database-level Tenant isolation", () => {
    expect(migration).toContain("ALTER TABLE %I FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("tenant_id = current_tenant_id()");
    expect(migration).toContain("ALTER TABLE tenants FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("id = current_tenant_id()");
    expect(migration).toContain("current_setting('app.platform_context', true) = 'true'");
  });

  it("makes Audit append-only and limits Outbox delivery updates", () => {
    expect(migration).toContain("CREATE TRIGGER audit_events_immutable");
    expect(migration).toContain("GRANT SELECT, INSERT ON audit_events TO geo_os_app");
    expect(migration).toContain(
      "GRANT UPDATE (status, attempts, available_at, published_at) ON outbox_events",
    );
    expect(migration).toContain("outbox event identity, payload, headers, trace");
    expect(tableDefinition("outbox_events")).toContain(
      "CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL))",
    );
  });

  it("only permits closing the current Binding interval", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION close_binding_interval_only()");
    expect(migration).toContain("closed binding history is immutable");
    expect(migration).toContain(
      "GRANT UPDATE (effective_to) ON project_policy_bindings, project_industry_bindings",
    );
  });

  it("protects published Release artifacts", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION protect_release_artifact()");
    expect(migration).toContain("policy_releases_immutable_after_publish");
    expect(migration).toContain("industry_policy_releases_immutable_after_publish");
    expect(migration).toContain("OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT', 'PUBLISHED')");
    expect(migration).toContain("draft releases may only remain draft or become published");
  });
});

function tableDefinition(tableName: string): string {
  const expression = new RegExp(`CREATE TABLE ${tableName} \\(([\\s\\S]*?)\\n\\);`, "u");
  const match = migration.match(expression);
  if (!match?.[1]) throw new Error(`Table ${tableName} not found in migration`);
  return match[1];
}
