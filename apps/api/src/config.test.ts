import { describe, expect, it } from "vitest";

import { loadConfig, loadOutboxDispatcherConfig } from "./config.js";

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

describe("Outbox Dispatcher configuration", () => {
  it("requires a dedicated Outbox database URL and bounded pool defaults", () => {
    expect(
      loadOutboxDispatcherConfig({
        OUTBOX_DATABASE_URL: "postgresql://geo_os_outbox_dispatcher:secret@localhost:5432/geo_os",
      }),
    ).toMatchObject({
      OUTBOX_DATABASE_POOL_MAX: 2,
      OUTBOX_PUBLISH_TIMEOUT_MS: 5_000,
      OUTBOX_STATEMENT_TIMEOUT_MS: 5_000,
      OUTBOX_IDLE_IN_TRANSACTION_TIMEOUT_MS: 10_000,
    });
  });

  it("rejects an idle transaction timeout that cannot outlive publish timeout cleanup", () => {
    expect(() =>
      loadOutboxDispatcherConfig({
        OUTBOX_DATABASE_URL: "postgresql://geo_os_outbox_dispatcher:secret@localhost:5432/geo_os",
        OUTBOX_PUBLISH_TIMEOUT_MS: "5000",
        OUTBOX_IDLE_IN_TRANSACTION_TIMEOUT_MS: "5000",
      }),
    ).toThrow("OUTBOX_IDLE_IN_TRANSACTION_TIMEOUT_MS must exceed OUTBOX_PUBLISH_TIMEOUT_MS");
  });

  it("rejects reuse of the Core application database login", () => {
    expect(() =>
      loadOutboxDispatcherConfig({
        OUTBOX_DATABASE_URL: "postgresql://geo_os_app:secret@localhost:5432/geo_os",
      }),
    ).toThrow("OUTBOX_DATABASE_URL must use the geo_os_outbox_dispatcher login");
  });
});
