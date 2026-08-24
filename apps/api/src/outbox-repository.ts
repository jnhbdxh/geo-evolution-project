import type { QueryResultRow } from "pg";

import type { Database } from "./database.js";
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
  public constructor(private readonly database: Database) {}

  public async processNextAvailable(
    now: Date,
    deliver: (event: PendingOutboxEvent) => Promise<OutboxDeliveryDisposition>,
  ): Promise<OutboxDispatchResult> {
    return this.database.withOutboxDispatcherTransaction(async (client) => {
      const selected = await client.query<OutboxEventRow>(
        `SELECT id, tenant_id, aggregate_type, aggregate_id, event_type, schema_version,
                payload, headers, trace_id, attempts, available_at, occurred_at
           FROM outbox_events
          WHERE status = 'PENDING' AND available_at <= $1
          ORDER BY available_at, occurred_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
        [now],
      );
      const row = selected.rows[0];
      if (!row) return { kind: "idle" };

      const event = mapPendingEvent(row);
      // Keep the row lock through publish. A commit failure after the external side effect may
      // redeliver, so every publisher receives the immutable event ID as its deduplication key.
      const disposition = await deliver(event);
      const attempts = row.attempts + 1;

      if (disposition.kind === "published") {
        await requireSingleUpdate(
          client.query(
            `UPDATE outbox_events
                SET status = 'PUBLISHED', attempts = $2, published_at = $3
              WHERE id = $1 AND status = 'PENDING'`,
            [row.id, attempts, now],
          ),
          row.id,
        );
        return { kind: "published", eventId: row.id, attempts };
      }

      if (disposition.kind === "retry") {
        await requireSingleUpdate(
          client.query(
            `UPDATE outbox_events
                SET attempts = $2, available_at = $3
              WHERE id = $1 AND status = 'PENDING'`,
            [row.id, attempts, disposition.availableAt],
          ),
          row.id,
        );
        return {
          kind: "retry_scheduled",
          eventId: row.id,
          attempts,
          availableAt: disposition.availableAt,
        };
      }

      await requireSingleUpdate(
        client.query(
          `UPDATE outbox_events
              SET status = 'FAILED', attempts = $2, available_at = $3
            WHERE id = $1 AND status = 'PENDING'`,
          [row.id, attempts, now],
        ),
        row.id,
      );
      return { kind: "failed", eventId: row.id, attempts };
    });
  }
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
