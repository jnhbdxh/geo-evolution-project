import { readFile } from "node:fs/promises";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

let accessMigration = "";
let hardeningMigration = "";

beforeAll(async () => {
  accessMigration = await readFile(
    path.resolve(process.cwd(), "packages/database/migrations/0003_outbox_dispatcher_access.sql"),
    "utf8",
  );
  hardeningMigration = await readFile(
    path.resolve(
      process.cwd(),
      "packages/database/migrations/0004_outbox_dispatcher_hardening.sql",
    ),
    "utf8",
  );
});

describe("Outbox dispatcher access migration", () => {
  it("preserves 0003 as the unfrozen legacy context migration", () => {
    expect(accessMigration).toContain("CREATE POLICY outbox_dispatcher_select ON outbox_events");
    expect(accessMigration).toContain("CREATE POLICY outbox_dispatcher_update ON outbox_events");
    expect(accessMigration).toContain(
      "current_setting('app.outbox_dispatcher_context', true) = 'true'",
    );
    expect(accessMigration).not.toContain("DROP POLICY outbox_tenant_isolation");
    expect(accessMigration).not.toMatch(/CREATE\s+TABLE/iu);
  });

  it("replaces the shared context with role-bound Outbox policies", () => {
    expect(hardeningMigration).toContain("DROP POLICY outbox_dispatcher_select");
    expect(hardeningMigration).toContain("DROP POLICY outbox_dispatcher_update");
    expect(hardeningMigration).toMatch(
      /CREATE POLICY outbox_dispatcher_select[\s\S]+?TO geo_os_outbox_dispatcher[\s\S]+?USING \(true\)/u,
    );
    expect(hardeningMigration).toMatch(
      /CREATE POLICY outbox_dispatcher_update[\s\S]+?TO geo_os_outbox_dispatcher[\s\S]+?WITH CHECK \(true\)/u,
    );
    expect(hardeningMigration).not.toContain("app.outbox_dispatcher_context");
    expect(hardeningMigration).not.toContain("TO geo_os_app");
  });

  it("grants only Outbox delivery access and bounded diagnostics", () => {
    expect(hardeningMigration).toMatch(
      /REVOKE UPDATE \(status, attempts, available_at, published_at\)[\s\S]+?FROM geo_os_app/iu,
    );
    expect(hardeningMigration).toContain(
      "GRANT SELECT ON outbox_events TO geo_os_outbox_dispatcher",
    );
    expect(hardeningMigration).toContain("GRANT UPDATE (");
    expect(hardeningMigration).toContain("last_error_category");
    expect(hardeningMigration).toContain("last_error_code");
    expect(hardeningMigration).toContain("last_failed_at");
    expect(hardeningMigration).toContain("char_length(last_error_message) BETWEEN 1 AND 512");
    expect(hardeningMigration).not.toMatch(/GRANT\s+(?:INSERT|DELETE)/iu);
    expect(hardeningMigration).not.toMatch(/audit_events/iu);
  });
});
