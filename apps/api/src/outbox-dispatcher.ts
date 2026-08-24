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

export interface OutboxFailureDiagnostic {
  readonly category: "VALIDATION" | "PUBLISH_TIMEOUT" | "PUBLISHER";
  readonly code: "OUTBOX_EVENT_INVALID" | "OUTBOX_PUBLISH_TIMEOUT" | "OUTBOX_PUBLISH_FAILED";
  readonly message: string;
}

export type OutboxDeliveryDisposition =
  | { readonly kind: "published" }
  | {
      readonly kind: "retry";
      readonly retryDelayMs: number;
      readonly diagnostic: OutboxFailureDiagnostic;
    }
  | { readonly kind: "failed"; readonly diagnostic: OutboxFailureDiagnostic };

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
    deliver: (event: PendingOutboxEvent) => Promise<OutboxDeliveryDisposition>,
  ): Promise<OutboxDispatchResult>;
}

export interface OutboxDispatcherOptions {
  readonly maxAttempts?: number;
  readonly baseRetryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  readonly publishTimeoutMs?: number;
}

export class OutboxDispatcher {
  private readonly maxAttempts: number;
  private readonly baseRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly publishTimeoutMs: number;

  public constructor(
    private readonly store: OutboxStore,
    private readonly publisher: OutboxPublisher,
    options: OutboxDispatcherOptions = {},
  ) {
    this.maxAttempts = positiveInteger(options.maxAttempts ?? 8, "maxAttempts");
    this.baseRetryDelayMs = positiveInteger(options.baseRetryDelayMs ?? 1_000, "baseRetryDelayMs");
    this.maxRetryDelayMs = positiveInteger(options.maxRetryDelayMs ?? 300_000, "maxRetryDelayMs");
    this.publishTimeoutMs = positiveInteger(options.publishTimeoutMs ?? 5_000, "publishTimeoutMs");
    if (this.maxRetryDelayMs < this.baseRetryDelayMs) {
      throw new Error("maxRetryDelayMs must be greater than or equal to baseRetryDelayMs");
    }
  }

  public async dispatchNext(): Promise<OutboxDispatchResult> {
    return this.store.processNextAvailable(async (event) => {
      let delivery: OutboxDelivery;
      try {
        const envelope = domainEventEnvelopeSchema.parse(event.payload);
        assertEnvelopeMatchesOutbox(event, envelope);
        const headers = outboxHeadersSchema.parse(event.headers);
        delivery = {
          deduplicationKey: event.id,
          eventType: event.eventType,
          envelope,
          headers,
        };
      } catch {
        return this.failureDisposition(event, {
          category: "VALIDATION",
          code: "OUTBOX_EVENT_INVALID",
          message: "Outbox event failed immutable-envelope validation",
        });
      }

      try {
        await withTimeout(this.publisher.publish(delivery), this.publishTimeoutMs);
        return { kind: "published" };
      } catch (error) {
        const timedOut = error instanceof OutboxPublishTimeoutError;
        return this.failureDisposition(event, {
          category: timedOut ? "PUBLISH_TIMEOUT" : "PUBLISHER",
          code: timedOut ? "OUTBOX_PUBLISH_TIMEOUT" : "OUTBOX_PUBLISH_FAILED",
          message: timedOut
            ? "Outbox publisher exceeded its configured timeout"
            : "Outbox publisher rejected delivery",
        });
      }
    });
  }

  private failureDisposition(
    event: PendingOutboxEvent,
    diagnostic: OutboxFailureDiagnostic,
  ): OutboxDeliveryDisposition {
    if (event.attempts + 1 >= this.maxAttempts) {
      return { kind: "failed", diagnostic };
    }
    return {
      kind: "retry",
      retryDelayMs: this.retryDelayMs(event.attempts),
      diagnostic,
    };
  }

  private retryDelayMs(previousAttempts: number): number {
    const exponent = Math.min(previousAttempts, 30);
    return Math.min(this.maxRetryDelayMs, this.baseRetryDelayMs * 2 ** exponent);
  }
}

class OutboxPublishTimeoutError extends Error {
  public constructor(timeoutMs: number) {
    super(`Outbox publish exceeded ${timeoutMs}ms`);
    this.name = "OutboxPublishTimeoutError";
  }
}

async function withTimeout(operation: Promise<void>, timeoutMs: number): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new OutboxPublishTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
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
