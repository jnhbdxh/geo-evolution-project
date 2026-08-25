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

export interface RoutedBullMqOutboxPublisherOptions extends Omit<
  BullMqOutboxPublisherOptions,
  "queueName"
> {
  readonly domainQueueName: string;
  readonly executionQueueName: string;
}

interface ManagedOutboxPublisher extends OutboxPublisher {
  initialize(timeoutMs: number): Promise<void>;
  close(): Promise<void>;
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

export class RoutedBullMqOutboxPublisher implements OutboxPublisher {
  public constructor(
    private readonly domainPublisher: ManagedOutboxPublisher,
    private readonly executionPublisher: ManagedOutboxPublisher,
  ) {}

  public async initialize(timeoutMs: number): Promise<void> {
    await this.domainPublisher.initialize(timeoutMs);
    await this.executionPublisher.initialize(timeoutMs);
  }

  public publish(delivery: OutboxDelivery): Promise<void> {
    const publisher =
      delivery.eventType === "ExecutionQueued" ? this.executionPublisher : this.domainPublisher;
    return publisher.publish(delivery);
  }

  public async close(): Promise<void> {
    const results = await Promise.allSettled([
      this.domainPublisher.close(),
      this.executionPublisher.close(),
    ]);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
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

export function createRoutedBullMqOutboxPublisher(
  options: RoutedBullMqOutboxPublisherOptions,
): RoutedBullMqOutboxPublisher {
  const sharedOptions = {
    redisUrl: options.redisUrl,
    commandTimeoutMs: options.commandTimeoutMs,
    ...(options.onConnectionError === undefined
      ? {}
      : { onConnectionError: options.onConnectionError }),
  };
  return new RoutedBullMqOutboxPublisher(
    createBullMqOutboxPublisher({ ...sharedOptions, queueName: options.domainQueueName }),
    createBullMqOutboxPublisher({ ...sharedOptions, queueName: options.executionQueueName }),
  );
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
