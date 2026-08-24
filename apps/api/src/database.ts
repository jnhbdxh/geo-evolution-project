import pg, { type PoolClient, type QueryResult, type QueryResultRow } from "pg";

const { Pool } = pg;

export interface SqlExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface ReadDatabase {
  withTenantRead<T>(tenantId: string, operation: (executor: SqlExecutor) => Promise<T>): Promise<T>;
  withPlatformRead<T>(operation: (executor: SqlExecutor) => Promise<T>): Promise<T>;
}

export class Database {
  private readonly pool: pg.Pool;

  public constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  public async withTenantTransaction<T>(
    tenantId: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.withTransaction(async (client) => {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      return operation(client);
    });
  }

  public async withTenantRead<T>(
    tenantId: string,
    operation: (executor: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    return this.withTenantTransaction(tenantId, operation);
  }

  public async withPlatformTransaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.withTransaction(async (client) => {
      await client.query("SELECT set_config('app.platform_context', 'true', true)");
      return operation(client);
    });
  }

  public async withPlatformRead<T>(operation: (executor: SqlExecutor) => Promise<T>): Promise<T> {
    return this.withPlatformTransaction(operation);
  }

  public async withOutboxDispatcherTransaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.withTransaction(async (client) => {
      await client.query("SELECT set_config('app.outbox_dispatcher_context', 'true', true)");
      return operation(client);
    });
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  private async withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
