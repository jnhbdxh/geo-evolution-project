import type { QueryResultRow } from "pg";

import type { OutboxDatabase } from "./outbox-database.js";
import type {
  OutboxDeliveryDisposition,
  OutboxDispatchResult,
  OutboxStore,
  PendingOutboxEvent,
} from "./outbox-dispatcher.js";

interface OutboxEventRow extends QueryResultRow {
  readonly id: string;
  readonly tenant_id: string | null;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly event_type: string;
  readonly schema_version: number;
  readonly payload: unknown;
  readonly headers: unknown;
  readonly trace_id: string;
  readonly attempts: number;
  readonly available_at: Date;
  readonly occurred_at: Date;
}

export class PostgresOutboxStore implements OutboxStore {
  public constructor(private readonly database: OutboxDatabase) {}

  public async processNextAvailable(
    deliver: (event: PendingOutboxEvent) => Promise<OutboxDeliveryDisposition>,
  ): Promise<OutboxDispatchResult> {
    return this.database.withTransaction(async (client) => {
      const selected = await client.query<OutboxEventRow>(
        `SELECT id, tenant_id, aggregate_type, aggregate_id, event_type, schema_version,
                payload, headers, trace_id, attempts, available_at, occurred_at
           FROM outbox_events
          WHERE status = 'PENDING' AND available_at <= clock_timestamp()
          ORDER BY available_at, occurred_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
      );
      const row = selected.rows[0];
      if (!row) return { kind: "idle" };

      const event = mapPendingEvent(row);
      // The bounded Publisher port keeps this transaction finite. A commit failure after the
      // external side effect may redeliver, so event ID remains the immutable deduplication key.
      const disposition = await deliver(event);
      const attempts = row.attempts + 1;

      if (disposition.kind === "published") {
        await requireSingleUpdate(
          client.query(
            `UPDATE outbox_events
                SET status = 'PUBLISHED', attempts = $2, published_at = clock_timestamp()
              WHERE id = $1 AND status = 'PENDING'`,
            [row.id, attempts],
          ),
          row.id,
        );
        return { kind: "published", eventId: row.id, attempts };
      }

      if (disposition.kind === "retry") {
        const updated = await client.query<{ available_at: Date }>(
          `WITH failure_clock AS (
             SELECT clock_timestamp() AS failed_at
           )
           UPDATE outbox_events
              SET attempts = $2,
                  available_at = failure_clock.failed_at + ($3::bigint * interval '1 millisecond'),
                  last_error_category = $4,
                  last_error_code = $5,
                  last_error_message = $6,
                  last_failed_at = failure_clock.failed_at
             FROM failure_clock
            WHERE id = $1 AND status = 'PENDING'
          RETURNING available_at`,
          [
            row.id,
            attempts,
            disposition.retryDelayMs,
            disposition.diagnostic.category,
            disposition.diagnostic.code,
            disposition.diagnostic.message,
          ],
        );
        const availableAt = requireUpdatedAvailability(updated.rows[0], row.id);
        return {
          kind: "retry_scheduled",
          eventId: row.id,
          attempts,
          availableAt,
        };
      }

      await requireSingleUpdate(
        client.query(
          `UPDATE outbox_events
              SET status = 'FAILED',
                  attempts = $2,
                  available_at = clock_timestamp(),
                  last_error_category = $3,
                  last_error_code = $4,
                  last_error_message = $5,
                  last_failed_at = clock_timestamp()
            WHERE id = $1 AND status = 'PENDING'`,
          [
            row.id,
            attempts,
            disposition.diagnostic.category,
            disposition.diagnostic.code,
            disposition.diagnostic.message,
          ],
        ),
        row.id,
      );
      return { kind: "failed", eventId: row.id, attempts };
    });
  }
}

function requireUpdatedAvailability(
  row: { readonly available_at: Date } | undefined,
  eventId: string,
): Date {
  if (!row) {
    throw new Error(`Outbox event ${eventId} lost its PENDING lock state`);
  }
  return row.available_at;
}

function mapPendingEvent(row: OutboxEventRow): PendingOutboxEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    payload: row.payload,
    headers: row.headers,
    traceId: row.trace_id,
    attempts: row.attempts,
    availableAt: row.available_at,
    occurredAt: row.occurred_at,
  };
}

async function requireSingleUpdate(
  update: Promise<{ readonly rowCount: number | null }>,
  eventId: string,
): Promise<void> {
  const result = await update;
  if (result.rowCount !== 1) {
    throw new Error(`Outbox event ${eventId} lost its PENDING lock state`);
  }
}
