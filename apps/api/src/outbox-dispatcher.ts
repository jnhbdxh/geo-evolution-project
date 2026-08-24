import { domainEventEnvelopeSchema, type DomainEventEnvelope } from "@geo-os/contracts";
import { z } from "zod";

const outboxHeadersSchema = z.record(z.string(), z.unknown());

export interface PendingOutboxEvent {
  readonly id: string;
  readonly tenantId: string | null;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly payload: unknown;
  readonly headers: unknown;
  readonly traceId: string;
  readonly attempts: number;
  readonly availableAt: Date;
  readonly occurredAt: Date;
}

export interface OutboxDelivery {
  readonly deduplicationKey: string;
  readonly eventType: string;
  readonly envelope: DomainEventEnvelope;
  readonly headers: Readonly<Record<string, unknown>>;
}

export interface OutboxPublisher {
  publish(delivery: OutboxDelivery): Promise<void>;
}

export type OutboxDeliveryDisposition =
  | { readonly kind: "published" }
  | { readonly kind: "retry"; readonly availableAt: Date }
  | { readonly kind: "failed" };

export type OutboxDispatchResult =
  | { readonly kind: "idle" }
  | {
      readonly kind: "published" | "retry_scheduled" | "failed";
      readonly eventId: string;
      readonly attempts: number;
      readonly availableAt?: Date;
    };

export interface OutboxStore {
  processNextAvailable(
    now: Date,
    deliver: (event: PendingOutboxEvent) => Promise<OutboxDeliveryDisposition>,
  ): Promise<OutboxDispatchResult>;
}

export interface OutboxDispatcherOptions {
  readonly maxAttempts?: number;
  readonly baseRetryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  readonly clock?: () => Date;
}

export class OutboxDispatcher {
  private readonly maxAttempts: number;
  private readonly baseRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly clock: () => Date;

  public constructor(
    private readonly store: OutboxStore,
    private readonly publisher: OutboxPublisher,
    options: OutboxDispatcherOptions = {},
  ) {
    this.maxAttempts = positiveInteger(options.maxAttempts ?? 8, "maxAttempts");
    this.baseRetryDelayMs = positiveInteger(options.baseRetryDelayMs ?? 1_000, "baseRetryDelayMs");
    this.maxRetryDelayMs = positiveInteger(options.maxRetryDelayMs ?? 300_000, "maxRetryDelayMs");
    if (this.maxRetryDelayMs < this.baseRetryDelayMs) {
      throw new Error("maxRetryDelayMs must be greater than or equal to baseRetryDelayMs");
    }
    this.clock = options.clock ?? (() => new Date());
  }

  public async dispatchNext(): Promise<OutboxDispatchResult> {
    const now = this.clock();
    return this.store.processNextAvailable(now, async (event) => {
      const nextAttempt = event.attempts + 1;
      try {
        const envelope = domainEventEnvelopeSchema.parse(event.payload);
        assertEnvelopeMatchesOutbox(event, envelope);
        const headers = outboxHeadersSchema.parse(event.headers);
        await this.publisher.publish({
          deduplicationKey: event.id,
          eventType: event.eventType,
          envelope,
          headers,
        });
        return { kind: "published" };
      } catch {
        if (nextAttempt >= this.maxAttempts) {
          return { kind: "failed" };
        }
        return {
          kind: "retry",
          availableAt: new Date(now.getTime() + this.retryDelayMs(event.attempts)),
        };
      }
    });
  }

  private retryDelayMs(previousAttempts: number): number {
    const exponent = Math.min(previousAttempts, 30);
    return Math.min(this.maxRetryDelayMs, this.baseRetryDelayMs * 2 ** exponent);
  }
}

function assertEnvelopeMatchesOutbox(
  event: PendingOutboxEvent,
  envelope: DomainEventEnvelope,
): void {
  if (
    envelope.event_id !== event.id ||
    envelope.event_type !== event.eventType ||
    envelope.tenant_id !== event.tenantId ||
    envelope.aggregate_type !== event.aggregateType ||
    envelope.aggregate_id !== event.aggregateId ||
    envelope.schema_version !== event.schemaVersion ||
    envelope.trace_id !== event.traceId ||
    new Date(envelope.occurred_at).getTime() !== event.occurredAt.getTime()
  ) {
    throw new Error(`Outbox envelope does not match immutable columns for event ${event.id}`);
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}
