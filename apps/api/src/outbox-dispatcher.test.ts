import { randomUUID } from "node:crypto";

import type { DomainEventEnvelope } from "@geo-os/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OutboxDispatcher,
  type OutboxDeliveryDisposition,
  type OutboxDispatchResult,
  type OutboxPublisher,
  type OutboxStore,
  type PendingOutboxEvent,
} from "./outbox-dispatcher.js";

const now = new Date("2026-08-24T03:30:00.000Z");

afterEach(() => {
  vi.useRealTimers();
});

describe("OutboxDispatcher", () => {
  it("publishes the immutable envelope with the event ID as the queue deduplication key", async () => {
    const event = pendingEvent();
    const store = new RecordingOutboxStore(event);
    const publish = vi.fn<OutboxPublisher["publish"]>().mockResolvedValue(undefined);
    const dispatcher = new OutboxDispatcher(store, { publish });

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
      { baseRetryDelayMs: 1_000, maxRetryDelayMs: 3_000 },
    );

    await expect(dispatcher.dispatchNext()).resolves.toEqual({
      kind: "retry_scheduled",
      eventId: event.id,
      attempts: 3,
      availableAt: new Date("2026-08-24T03:30:03.000Z"),
    });
    expect(store.disposition).toEqual({
      kind: "retry",
      retryDelayMs: 3_000,
      diagnostic: {
        category: "PUBLISHER",
        code: "OUTBOX_PUBLISH_FAILED",
        message: "Outbox publisher rejected delivery",
      },
    });
  });

  it("marks the event failed when the configured attempt budget is exhausted", async () => {
    const event = pendingEvent({ attempts: 2 });
    const store = new RecordingOutboxStore(event);
    const dispatcher = new OutboxDispatcher(
      store,
      { publish: vi.fn().mockRejectedValue(new Error("queue unavailable")) },
      { maxAttempts: 3 },
    );

    await expect(dispatcher.dispatchNext()).resolves.toEqual({
      kind: "failed",
      eventId: event.id,
      attempts: 3,
    });
    expect(store.disposition).toEqual({
      kind: "failed",
      diagnostic: {
        category: "PUBLISHER",
        code: "OUTBOX_PUBLISH_FAILED",
        message: "Outbox publisher rejected delivery",
      },
    });
  });

  it("does not publish an envelope that conflicts with immutable Outbox columns", async () => {
    const event = pendingEvent();
    const store = new RecordingOutboxStore({
      ...event,
      payload: { ...(event.payload as DomainEventEnvelope), event_type: "ConflictingEvent" },
    });
    const publish = vi.fn<OutboxPublisher["publish"]>();
    const dispatcher = new OutboxDispatcher(store, { publish });

    await expect(dispatcher.dispatchNext()).resolves.toMatchObject({
      kind: "retry_scheduled",
      eventId: event.id,
      attempts: 1,
    });
    expect(publish).not.toHaveBeenCalled();
    expect(store.disposition).toMatchObject({
      diagnostic: {
        category: "VALIDATION",
        code: "OUTBOX_EVENT_INVALID",
      },
    });
  });

  it("bounds a publisher that never settles and releases the Store callback", async () => {
    vi.useFakeTimers();
    const event = pendingEvent();
    const store = new RecordingOutboxStore(event);
    const publisherNeverSettles = vi.fn(() => new Promise<void>(() => undefined));
    const dispatcher = new OutboxDispatcher(
      store,
      { publish: publisherNeverSettles },
      { publishTimeoutMs: 50 },
    );

    const dispatch = dispatcher.dispatchNext();
    await vi.advanceTimersByTimeAsync(50);

    await expect(dispatch).resolves.toMatchObject({
      kind: "retry_scheduled",
      eventId: event.id,
      attempts: 1,
    });
    expect(store.disposition).toMatchObject({
      kind: "retry",
      retryDelayMs: 1_000,
      diagnostic: {
        category: "PUBLISH_TIMEOUT",
        code: "OUTBOX_PUBLISH_TIMEOUT",
      },
    });
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
        availableAt: new Date(now.getTime() + this.disposition.retryDelayMs),
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
