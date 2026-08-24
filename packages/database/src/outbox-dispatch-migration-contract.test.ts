import { readFile } from "node:fs/promises";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

let migration = "";

beforeAll(async () => {
  migration = await readFile(
    path.resolve(process.cwd(), "packages/database/migrations/0003_outbox_dispatcher_access.sql"),
    "utf8",
  );
});

describe("Outbox dispatcher access migration", () => {
  it("adds a dedicated cross-Tenant context only to the Outbox RLS policy", () => {
    expect(migration).toContain("CREATE POLICY outbox_dispatcher_select ON outbox_events");
    expect(migration).toContain("CREATE POLICY outbox_dispatcher_update ON outbox_events");
    expect(migration).toContain("FOR SELECT");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("current_setting('app.outbox_dispatcher_context', true) = 'true'");
    expect(migration).not.toContain("DROP POLICY outbox_tenant_isolation");
    expect(migration).not.toMatch(/CREATE\s+TABLE/iu);
    expect(migration).not.toMatch(/audit_events/iu);
  });
});
