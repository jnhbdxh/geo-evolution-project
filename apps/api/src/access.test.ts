import { describe, expect, it } from "vitest";

import { activeMembershipQuery } from "./access.js";

describe("active Tenant membership query", () => {
  it("requires UserIdentity, Membership, and Tenant to all be active", () => {
    expect(activeMembershipQuery).toContain("JOIN user_identities ui");
    expect(activeMembershipQuery).toContain("ui.status = 'ACTIVE'");
    expect(activeMembershipQuery).toContain("m.status = 'ACTIVE'");
    expect(activeMembershipQuery).toContain("t.status = 'ACTIVE'");
  });
});
