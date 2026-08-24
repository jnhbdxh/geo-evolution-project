import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

const baseEnvironment: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://geo_os_app:secret@localhost:5432/geo_os",
  JWT_SECRET: "test-secret-at-least-thirty-two-characters",
  INTERNAL_SERVICE_TOKEN_SECRET: "distinct-internal-test-secret-at-least-32-characters",
};

describe("API configuration", () => {
  it("fails startup when production accidentally defaults to development auth", () => {
    expect(() => loadConfig({ ...baseEnvironment, NODE_ENV: "production" })).toThrow(
      "AUTH_MODE=development is forbidden when NODE_ENV=production",
    );
  });

  it("accepts production only with non-development auth", () => {
    expect(
      loadConfig({ ...baseEnvironment, NODE_ENV: "production", AUTH_MODE: "oidc" }).AUTH_MODE,
    ).toBe("oidc");
  });
});
