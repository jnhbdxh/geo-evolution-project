import "dotenv/config";

import { createRoutedBullMqOutboxPublisher } from "./bullmq-outbox-publisher.js";
import { loadOutboxDispatcherConfig } from "./config.js";
import { OutboxDatabase } from "./outbox-database.js";
import { OutboxDispatcher } from "./outbox-dispatcher.js";
import { OutboxDispatcherRunner } from "./outbox-dispatcher-runner.js";
import { PostgresOutboxStore } from "./outbox-repository.js";

async function main(): Promise<void> {
  const config = loadOutboxDispatcherConfig();
  const database = new OutboxDatabase(config.OUTBOX_DATABASE_URL, {
    maxConnections: config.OUTBOX_DATABASE_POOL_MAX,
    statementTimeoutMs: config.OUTBOX_STATEMENT_TIMEOUT_MS,
    idleInTransactionTimeoutMs: config.OUTBOX_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  });
  const publisher = createRoutedBullMqOutboxPublisher({
    redisUrl: config.REDIS_URL,
    domainQueueName: config.OUTBOX_QUEUE_NAME,
    executionQueueName: config.QUERY_EXECUTION_QUEUE_NAME,
    commandTimeoutMs: config.OUTBOX_REDIS_COMMAND_TIMEOUT_MS,
    onConnectionError: (error) => logFailure("OUTBOX_REDIS_CONNECTION_ERROR", error),
  });
  const dispatcher = new OutboxDispatcher(new PostgresOutboxStore(database), publisher, {
    publishTimeoutMs: config.OUTBOX_PUBLISH_TIMEOUT_MS,
    maxAttempts: config.OUTBOX_MAX_ATTEMPTS,
    baseRetryDelayMs: config.OUTBOX_BASE_RETRY_DELAY_MS,
    maxRetryDelayMs: config.OUTBOX_MAX_RETRY_DELAY_MS,
  });
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await publisher.initialize(config.OUTBOX_REDIS_STARTUP_TIMEOUT_MS);
    await new OutboxDispatcherRunner(dispatcher, {
      pollIntervalMs: config.OUTBOX_POLL_INTERVAL_MS,
      errorDelayMs: config.OUTBOX_ERROR_DELAY_MS,
      onDispatch: (result) =>
        writeLog("info", "OUTBOX_DISPATCH_COMPLETED", {
          result: result.kind,
          event_id: result.eventId,
          attempts: result.attempts,
          available_at: result.availableAt?.toISOString(),
        }),
      onError: (error) => logFailure("OUTBOX_DISPATCH_CYCLE_FAILED", error),
    }).run(controller.signal);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    const closed = await Promise.allSettled([publisher.close(), database.close()]);
    const closeFailure = closed.find((result) => result.status === "rejected");
    if (closeFailure?.status === "rejected") {
      logFailure("OUTBOX_DISPATCHER_CLOSE_FAILED", closeFailure.reason);
      process.exitCode = 1;
    }
  }
}

function logFailure(code: string, error: unknown): void {
  writeLog("error", code, {
    error_name: error instanceof Error ? error.name : "UnknownError",
  });
}

function writeLog(
  level: "info" | "error",
  code: string,
  fields: Readonly<Record<string, unknown>> = {},
): void {
  process.stdout.write(`${JSON.stringify({ level, code, ...fields })}\n`);
}

try {
  await main();
} catch (error) {
  logFailure("OUTBOX_DISPATCHER_STOPPED", error);
  process.exitCode = 1;
}
