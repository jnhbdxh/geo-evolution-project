import { describe, expect, it } from "vitest";

import { loadQueryEngineConfig, loadQueryEngineWorkerConfig } from "./config.js";

const validEnvironment = {
  DOUBAO_STORAGE_STATE_PATH: "D:/secrets/doubao-storage-state.json",
  ALLOW_REAL_AI_TESTS: "true",
};

describe("Query Engine configuration", () => {
  it("requires explicit real-execution opt-in and identity state", () => {
    expect(() => loadQueryEngineConfig({})).toThrow();
    expect(loadQueryEngineConfig(validEnvironment)).toMatchObject({
      DOUBAO_ENTRY_URL: "https://www.doubao.com/chat/",
      QUERY_ENGINE_HEADLESS: false,
    });
  });

  it("rejects false Doubao attribution through a production proxy", () => {
    expect(() =>
      loadQueryEngineConfig({
        ...validEnvironment,
        NODE_ENV: "production",
        DOUBAO_ENTRY_URL: "https://proxy.example.com/chat/",
      }),
    ).toThrow("Production Doubao Web execution must use https://www.doubao.com/chat/");
  });

  it("keeps interactive human verification out of production execution", () => {
    expect(() =>
      loadQueryEngineConfig({
        ...validEnvironment,
        NODE_ENV: "production",
        DOUBAO_INTERACTIVE_VERIFICATION_TIMEOUT_MS: "60000",
      }),
    ).toThrow("Production execution cannot wait for interactive human verification");
  });
});

describe("Query Engine Worker configuration", () => {
  it("requires an independent Worker credential and Redis connection", () => {
    expect(
      loadQueryEngineWorkerConfig({
        CORE_API_BASE_URL: "http://127.0.0.1:3000",
        QUERY_ENGINE_WORKER_TOKEN: "worker-secret-at-least-thirty-two-characters",
        QUERY_ENGINE_IDENTITY_ID: "authorized-doubao-identity",
        REDIS_URL: "redis://127.0.0.1:6379",
      }),
    ).toMatchObject({
      QUERY_EXECUTION_QUEUE_NAME: "geo-os-query-executions",
      QUERY_ENGINE_IDENTITY_ID: "authorized-doubao-identity",
    });
  });
});
