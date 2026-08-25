import type { OutboxDispatchResult } from "./outbox-dispatcher.js";

interface DispatchCycle {
  dispatchNext(): Promise<OutboxDispatchResult>;
}

export interface OutboxDispatcherRunnerOptions {
  readonly pollIntervalMs?: number;
  readonly errorDelayMs?: number;
  readonly onDispatch?: (result: Exclude<OutboxDispatchResult, { readonly kind: "idle" }>) => void;
  readonly onError?: (error: unknown) => void;
  readonly wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

export class OutboxDispatcherRunner {
  private readonly pollIntervalMs: number;
  private readonly errorDelayMs: number;
  private readonly wait: (delayMs: number, signal: AbortSignal) => Promise<void>;

  public constructor(
    private readonly dispatcher: DispatchCycle,
    private readonly options: OutboxDispatcherRunnerOptions = {},
  ) {
    this.pollIntervalMs = positiveInteger(options.pollIntervalMs ?? 250, "pollIntervalMs");
    this.errorDelayMs = positiveInteger(options.errorDelayMs ?? 1_000, "errorDelayMs");
    this.wait = options.wait ?? waitFor;
  }

  public async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const result = await this.dispatcher.dispatchNext();
        if (result.kind === "idle") {
          await this.wait(this.pollIntervalMs, signal);
        } else {
          this.options.onDispatch?.(result);
        }
      } catch (error) {
        this.options.onError?.(error);
        await this.wait(this.errorDelayMs, signal);
      }
    }
  }
}

async function waitFor(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });

    function finish(): void {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}
