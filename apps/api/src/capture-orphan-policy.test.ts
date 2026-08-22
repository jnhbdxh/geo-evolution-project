import { describe, expect, it } from "vitest";

import {
  captureOrphanMinimumAgeMs,
  isCaptureOrphanPastGracePeriod,
} from "./capture-orphan-policy.js";

describe("Capture orphan cleanup grace period", () => {
  it("never admits a newly uploaded object for synchronous cleanup", () => {
    const databaseNow = new Date("2026-08-22T12:00:00.000Z");
    expect(isCaptureOrphanPastGracePeriod(databaseNow, databaseNow)).toBe(false);
    expect(
      isCaptureOrphanPastGracePeriod(
        new Date(databaseNow.getTime() - captureOrphanMinimumAgeMs + 1),
        databaseNow,
      ),
    ).toBe(false);
  });

  it("admits an unreferenced object only after the complete grace period", () => {
    const databaseNow = new Date("2026-08-22T12:00:00.000Z");
    expect(
      isCaptureOrphanPastGracePeriod(
        new Date(databaseNow.getTime() - captureOrphanMinimumAgeMs),
        databaseNow,
      ),
    ).toBe(true);
  });
});
