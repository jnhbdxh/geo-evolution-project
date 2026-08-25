import { describe, expect, it, vi } from "vitest";

import { OutboxDispatcherRunner } from "./outbox-dispatcher-runner.js";

describe("Outbox Dispatcher runner", () => {
  it("polls after idle and stops without taking another event", async () => {
    const controller = new AbortController();
    const dispatchNext = vi.fn(async () => ({ kind: "idle" as const }));
    const wait = vi.fn(async () => controller.abort());

    await new OutboxDispatcherRunner({ dispatchNext }, { pollIntervalMs: 25, wait }).run(
      controller.signal,
    );

    expect(dispatchNext).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledWith(25, controller.signal);
  });

  it("drains published events without an idle delay", async () => {
    const controller = new AbortController();
    const onDispatch = vi.fn(() => controller.abort());
    const wait = vi.fn(async () => undefined);

    await new OutboxDispatcherRunner(
      {
        dispatchNext: async () => ({
          kind: "published",
          eventId: "11111111-1111-4111-8111-111111111111",
          attempts: 1,
        }),
      },
      { onDispatch, wait },
    ).run(controller.signal);

    expect(onDispatch).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });

  it("backs off after a failed dispatch cycle", async () => {
    const controller = new AbortController();
    const failure = new Error("database unavailable");
    const onError = vi.fn();
    const wait = vi.fn(async () => controller.abort());

    await new OutboxDispatcherRunner(
      {
        dispatchNext: async () => {
          throw failure;
        },
      },
      { errorDelayMs: 75, onError, wait },
    ).run(controller.signal);

    expect(onError).toHaveBeenCalledWith(failure);
    expect(wait).toHaveBeenCalledWith(75, controller.signal);
  });
});
