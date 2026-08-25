import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { CoreWorkerClient } from "./core-worker-client.js";

describe("CoreWorkerClient", () => {
  it("propagates the queued event trace when claiming an execution", async () => {
    const executionRunId = randomUUID();
    const traceId = randomUUID();
    const fetch = vi.fn(async () =>
      Response.json({
        data: {
          execution_run_id: executionRunId,
          operational_status: "QUEUED",
          response_outcome_kind: null,
          completed_at: null,
          observation_candidate_id: null,
          raw_observation_id: null,
          token: "scoped-execution-token",
        },
      }),
    );
    const client = new CoreWorkerClient({
      baseUrl: "http://core.example",
      workerToken: "w".repeat(32),
      fetch,
    });

    await client.claim({
      tenantId: randomUUID(),
      executionRunId,
      eventId: randomUUID(),
      traceId,
    });

    expect(fetch).toHaveBeenCalledWith(
      `http://core.example/v1/internal/query-engine/execution-runs/${executionRunId}/claim`,
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: `Bearer ${"w".repeat(32)}`,
          "x-geo-os-trace-id": traceId,
        }),
      }),
    );
  });
});
