import { randomUUID } from "node:crypto";

import type { DomainEventEnvelope } from "@geo-os/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  OutboxDispatcher,
  type OutboxDeliveryDisposition,
  type OutboxDispatchResult,
  type OutboxPublisher,
  type OutboxStore,
  type PendingOutboxEvent,
} from "./outbox-dispatcher.js";

const now = new Date("2026-08-24T03:30:00.000Z");

describe("OutboxDispatcher", () => {
  it("publishes the immutable envelope with the event ID as the queue deduplication key", async () => {
    const event = pendingEvent();
    const store = new RecordingOutboxStore(event);
    const publish = vi.fn<OutboxPublisher["publish"]>().mockResolvedValue(undefined);
    const dispatcher = new OutboxDispatcher(store, { publish }, { clock: () => now });

    await expect(dispatcher.dispatchNext()).resolves.toEqual({
      kind: "published",
      eventId: event.id,
      attempts: 1,
    });
    expect(publish).toHaveBeenCalledWith({
      deduplicationKey: event.id,
      eventType: event.eventType,
      envelope: event.payload,
      headers: {},
    });
    expect(store.disposition).toEqual({ kind: "published" });
  });

  it("schedules bounded exponential retry after a publisher failure", async () => {
    const event = pendingEvent({ attempts: 2 });
    const store = new RecordingOutboxStore(event);
    const dispatcher = new OutboxDispatcher(
      store,
      { publish: vi.fn().mockRejectedValue(new Error("queue unavailable")) },
      { clock: () => now, baseRetryDelayMs: 1_000, maxRetryDelayMs: 3_000 },
    );

    await expect(dispatcher.dispatchNext()).resolves.toEqual({
      kind: "retry_scheduled",
      eventId: event.id,
      attempts: 3,
      availableAt: new Date("2026-08-24T03:30:03.000Z"),
    });
    expect(store.disposition).toEqual({
      kind: "retry",
      availableAt: new Date("2026-08-24T03:30:03.000Z"),
    });
  });

  it("marks the event failed when the configured attempt budget is exhausted", async () => {
    const event = pendingEvent({ attempts: 2 });
    const store = new RecordingOutboxStore(event);
    const dispatcher = new OutboxDispatcher(
      store,
      { publish: vi.fn().mockRejectedValue(new Error("queue unavailable")) },
      { clock: () => now, maxAttempts: 3 },
    );

    await expect(dispatcher.dispatchNext()).resolves.toEqual({
      kind: "failed",
      eventId: event.id,
      attempts: 3,
    });
    expect(store.disposition).toEqual({ kind: "failed" });
  });

  it("does not publish an envelope that conflicts with immutable Outbox columns", async () => {
    const event = pendingEvent();
    const store = new RecordingOutboxStore({
      ...event,
      payload: { ...(event.payload as DomainEventEnvelope), event_type: "ConflictingEvent" },
    });
    const publish = vi.fn<OutboxPublisher["publish"]>();
    const dispatcher = new OutboxDispatcher(store, { publish }, { clock: () => now });

    await expect(dispatcher.dispatchNext()).resolves.toMatchObject({
      kind: "retry_scheduled",
      eventId: event.id,
      attempts: 1,
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it("returns idle without invoking the publisher when no event is available", async () => {
    const publish = vi.fn<OutboxPublisher["publish"]>();
    const dispatcher = new OutboxDispatcher(new RecordingOutboxStore(), { publish });

    await expect(dispatcher.dispatchNext()).resolves.toEqual({ kind: "idle" });
    expect(publish).not.toHaveBeenCalled();
  });
});

class RecordingOutboxStore implements OutboxStore {
  public disposition: OutboxDeliveryDisposition | undefined;

  public constructor(private readonly event?: PendingOutboxEvent) {}

  public async processNextAvailable(
    _now: Date,
    deliver: (event: PendingOutboxEvent) => Promise<OutboxDeliveryDisposition>,
  ): Promise<OutboxDispatchResult> {
    if (!this.event) return { kind: "idle" };
    this.disposition = await deliver(this.event);
    const attempts = this.event.attempts + 1;
    if (this.disposition.kind === "retry") {
      return {
        kind: "retry_scheduled",
        eventId: this.event.id,
        attempts,
        availableAt: this.disposition.availableAt,
      };
    }
    return { kind: this.disposition.kind, eventId: this.event.id, attempts };
  }
}

function pendingEvent(overrides: Partial<PendingOutboxEvent> = {}): PendingOutboxEvent {
  const id = randomUUID();
  const tenantId = randomUUID();
  const aggregateId = randomUUID();
  const traceId = randomUUID();
  const occurredAt = new Date("2026-08-24T03:00:00.000Z");
  return {
    id,
    tenantId,
    aggregateType: "ExecutionRun",
    aggregateId,
    eventType: "ExecutionQueued",
    schemaVersion: 1,
    payload: {
      event_id: id,
      event_type: "ExecutionQueued",
      tenant_id: tenantId,
      aggregate_type: "ExecutionRun",
      aggregate_id: aggregateId,
      schema_version: 1,
      occurred_at: occurredAt.toISOString(),
      trace_id: traceId,
      data: { execution_run_id: aggregateId },
    },
    headers: {},
    traceId,
    attempts: 0,
    availableAt: new Date("2026-08-24T02:59:00.000Z"),
    occurredAt,
    ...overrides,
  };
}
