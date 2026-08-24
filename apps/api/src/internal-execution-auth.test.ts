import { describe, expect, it } from "vitest";

import { InternalExecutionAuth } from "./internal-execution-auth.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const executionRunId = "22222222-2222-4222-8222-222222222222";
const secret = "internal-token-secret-that-is-longer-than-32-bytes";

describe("InternalExecutionAuth", () => {
  it("issues a short-lived token bound to the Tenant and ExecutionRun", () => {
    const now = new Date("2026-08-22T08:00:00.000Z");
    const auth = new InternalExecutionAuth(secret, () => now);

    const principal = auth.verify(auth.issue({ tenantId, executionRunId }));

    expect(principal).toMatchObject({
      service: "QUERY_ENGINE",
      tenantId,
      executionRunId,
    });
  });

  it("rejects tokens signed with another internal secret", () => {
    const token = new InternalExecutionAuth(secret).issue({ tenantId, executionRunId });
    const verifier = new InternalExecutionAuth(
      "another-internal-secret-that-is-longer-than-32-bytes",
    );

    expect(() => verifier.verify(token)).toThrow("execution-scoped internal token");
  });

  it("rejects an expired token", () => {
    let now = new Date("2026-08-22T08:00:00.000Z");
    const auth = new InternalExecutionAuth(secret, () => now);
    const token = auth.issue({ tenantId, executionRunId, lifetimeSeconds: 1 });
    now = new Date("2026-08-22T08:00:02.000Z");

    expect(() => auth.verify(token)).toThrow("execution-scoped internal token");
  });
});
