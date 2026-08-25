import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { BullMqOutboxPublisher, type OutboxQueueJobData } from "./bullmq-outbox-publisher.js";
import type { OutboxDelivery } from "./outbox-dispatcher.js";

describe("BullMQ Outbox publisher", () => {
  it("uses the immutable event ID as the retained BullMQ job ID", async () => {
    const queue = {
      waitUntilReady: vi.fn(async () => undefined),
      add: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const disconnect = vi.fn();
    const publisher = new BullMqOutboxPublisher(queue, disconnect);
    const delivery = createDelivery();

    await publisher.initialize(100);
    await publisher.publish(delivery);

    expect(queue.waitUntilReady).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledWith(
      "ExecutionQueued",
      {
        envelope: delivery.envelope,
        headers: delivery.headers,
      } satisfies OutboxQueueJobData,
      {
        jobId: delivery.deduplicationKey,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );
    await publisher.close();
    expect(queue.close).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("cannot publish after startup readiness times out and later resolves", async () => {
    let resolveReadiness: (() => void) | undefined;
    const readiness = new Promise<void>((resolve) => {
      resolveReadiness = resolve;
    });
    const queue = {
      waitUntilReady: vi.fn(() => readiness),
      add: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const disconnect = vi.fn();
    const publisher = new BullMqOutboxPublisher(queue, disconnect);

    await expect(publisher.initialize(10)).rejects.toThrow(
      "BullMQ Publisher failed to initialize within 10ms",
    );
    await expect(publisher.publish(createDelivery())).rejects.toThrow(
      "BullMQ Publisher must be initialized before publishing",
    );

    resolveReadiness?.();
    await readiness;
    expect(queue.add).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

function createDelivery(): OutboxDelivery {
  const eventId = randomUUID();
  return {
    deduplicationKey: eventId,
    eventType: "ExecutionQueued",
    envelope: {
      event_id: eventId,
      event_type: "ExecutionQueued",
      tenant_id: randomUUID(),
      aggregate_type: "ExecutionRun",
      aggregate_id: randomUUID(),
      schema_version: 1,
      trace_id: randomUUID(),
      occurred_at: new Date().toISOString(),
      data: { execution_run_id: randomUUID() },
    },
    headers: { source: "core" },
  };
}
