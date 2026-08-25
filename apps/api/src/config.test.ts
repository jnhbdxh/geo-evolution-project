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
  const outboxEnvironment: NodeJS.ProcessEnv = {
    OUTBOX_DATABASE_URL: "postgresql://geo_os_outbox_dispatcher:secret@localhost:5432/geo_os",
    REDIS_URL: "redis://localhost:6379",
  };

  it("requires a dedicated Outbox database URL and bounded pool defaults", () => {
    expect(loadOutboxDispatcherConfig(outboxEnvironment)).toMatchObject({
      OUTBOX_DATABASE_POOL_MAX: 2,
      OUTBOX_PUBLISH_TIMEOUT_MS: 5_000,
      OUTBOX_STATEMENT_TIMEOUT_MS: 5_000,
      OUTBOX_IDLE_IN_TRANSACTION_TIMEOUT_MS: 10_000,
      OUTBOX_QUEUE_NAME: "geo-os-domain-events",
      OUTBOX_REDIS_STARTUP_TIMEOUT_MS: 5_000,
      OUTBOX_REDIS_COMMAND_TIMEOUT_MS: 3_000,
      OUTBOX_POLL_INTERVAL_MS: 250,
      OUTBOX_ERROR_DELAY_MS: 1_000,
      OUTBOX_MAX_ATTEMPTS: 8,
      OUTBOX_BASE_RETRY_DELAY_MS: 1_000,
      OUTBOX_MAX_RETRY_DELAY_MS: 300_000,
    });
  });

  it("rejects an idle transaction timeout that cannot outlive publish timeout cleanup", () => {
    expect(() =>
      loadOutboxDispatcherConfig({
        ...outboxEnvironment,
        OUTBOX_PUBLISH_TIMEOUT_MS: "5000",
        OUTBOX_IDLE_IN_TRANSACTION_TIMEOUT_MS: "5000",
      }),
    ).toThrow("OUTBOX_IDLE_IN_TRANSACTION_TIMEOUT_MS must exceed OUTBOX_PUBLISH_TIMEOUT_MS");
  });

  it("rejects reuse of the Core application database login", () => {
    expect(() =>
      loadOutboxDispatcherConfig({
        OUTBOX_DATABASE_URL: "postgresql://geo_os_app:secret@localhost:5432/geo_os",
        REDIS_URL: "redis://localhost:6379",
      }),
    ).toThrow("OUTBOX_DATABASE_URL must use the geo_os_outbox_dispatcher login");
  });

  it("requires a Redis URL and command timeout bounded by the publish timeout", () => {
    expect(() =>
      loadOutboxDispatcherConfig({
        ...outboxEnvironment,
        REDIS_URL: "https://localhost:6379",
      }),
    ).toThrow("REDIS_URL must use redis:// or rediss://");

    expect(() =>
      loadOutboxDispatcherConfig({
        ...outboxEnvironment,
        OUTBOX_PUBLISH_TIMEOUT_MS: "1000",
        OUTBOX_REDIS_COMMAND_TIMEOUT_MS: "1001",
      }),
    ).toThrow("OUTBOX_REDIS_COMMAND_TIMEOUT_MS must not exceed OUTBOX_PUBLISH_TIMEOUT_MS");
  });

  it("rejects a retry maximum lower than the base delay", () => {
    expect(() =>
      loadOutboxDispatcherConfig({
        ...outboxEnvironment,
        OUTBOX_BASE_RETRY_DELAY_MS: "2000",
        OUTBOX_MAX_RETRY_DELAY_MS: "1999",
      }),
    ).toThrow("OUTBOX_MAX_RETRY_DELAY_MS must not be lower than OUTBOX_BASE_RETRY_DELAY_MS");
  });
});
