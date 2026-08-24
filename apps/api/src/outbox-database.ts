import pg, { type PoolClient } from "pg";

const { Pool } = pg;

export interface OutboxDatabaseOptions {
  readonly maxConnections?: number;
  readonly statementTimeoutMs?: number;
  readonly idleInTransactionTimeoutMs?: number;
}

export class OutboxDatabase {
  private readonly pool: pg.Pool;
  private readonly statementTimeoutMs: number;
  private readonly idleInTransactionTimeoutMs: number;

  public constructor(connectionString: string, options: OutboxDatabaseOptions = {}) {
    const maxConnections = positiveInteger(options.maxConnections ?? 2, "maxConnections");
    this.statementTimeoutMs = positiveInteger(
      options.statementTimeoutMs ?? 5_000,
      "statementTimeoutMs",
    );
    this.idleInTransactionTimeoutMs = positiveInteger(
      options.idleInTransactionTimeoutMs ?? 10_000,
      "idleInTransactionTimeoutMs",
    );
    this.pool = new Pool({
      connectionString,
      max: maxConnections,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  public async withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('statement_timeout', $1, true)", [
        `${this.statementTimeoutMs}ms`,
      ]);
      await client.query("SELECT set_config('idle_in_transaction_session_timeout', $1, true)", [
        `${this.idleInTransactionTimeoutMs}ms`,
      ]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}
