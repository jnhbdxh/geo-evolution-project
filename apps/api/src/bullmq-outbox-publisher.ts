import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";

import type { OutboxDelivery, OutboxPublisher } from "./outbox-dispatcher.js";

export interface OutboxQueueJobData {
  readonly envelope: OutboxDelivery["envelope"];
  readonly headers: OutboxDelivery["headers"];
}

interface OutboxQueue {
  waitUntilReady(): Promise<unknown>;
  add(name: string, data: OutboxQueueJobData, options: JobsOptions): Promise<unknown>;
  close(): Promise<void>;
}

export interface BullMqOutboxPublisherOptions {
  readonly redisUrl: string;
  readonly queueName: string;
  readonly commandTimeoutMs: number;
  readonly onConnectionError?: (error: Error) => void;
}

export class BullMqOutboxPublisher implements OutboxPublisher {
  private initialized = false;

  public constructor(
    private readonly queue: OutboxQueue,
    private readonly disconnect: () => void = () => undefined,
  ) {}

  public async initialize(timeoutMs: number): Promise<void> {
    const readiness = this.queue.waitUntilReady();
    try {
      await withTimeout(readiness, timeoutMs);
      this.initialized = true;
    } catch {
      this.disconnect();
      void readiness.catch(() => undefined);
      throw new Error(`BullMQ Publisher failed to initialize within ${timeoutMs}ms`);
    }
  }

  public async publish(delivery: OutboxDelivery): Promise<void> {
    if (!this.initialized) {
      throw new Error("BullMQ Publisher must be initialized before publishing");
    }
    await this.queue.add(
      delivery.eventType,
      {
        envelope: delivery.envelope,
        headers: delivery.headers,
      },
      {
        jobId: delivery.deduplicationKey,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );
  }

  public async close(): Promise<void> {
    this.initialized = false;
    try {
      await this.queue.close();
    } finally {
      this.disconnect();
    }
  }
}

export function createBullMqOutboxPublisher(
  options: BullMqOutboxPublisherOptions,
): BullMqOutboxPublisher {
  const connection = new Redis(options.redisUrl, {
    connectionName: "geo-os-outbox-dispatcher",
    connectTimeout: options.commandTimeoutMs,
    commandTimeout: options.commandTimeoutMs,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  const queue = new Queue<OutboxQueueJobData>(options.queueName, {
    connection,
  });
  queue.on("error", (error) => options.onConnectionError?.(error));
  return new BullMqOutboxPublisher(queue, () => connection.disconnect());
}

async function withTimeout(operation: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`BullMQ initialization exceeded ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
