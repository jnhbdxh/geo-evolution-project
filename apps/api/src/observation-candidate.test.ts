import { describe, expect, it } from "vitest";

import { createObservationCandidateSchema } from "@geo-os/contracts";

const validCandidate = {
  executionRunId: "11111111-1111-4111-8111-111111111111",
  responseOutcomeKind: "REFUSAL",
  representation: "TEXT",
  correlationStatus: "CONFIRMED",
  targetSurfaceReached: true,
  targetQuestionSubmitted: true,
  visibleResponseOutcomeObserved: true,
  lifecycleAssociated: true,
  existenceBasis: {
    kind: "VISIBLE_REFUSAL",
    questionSubmittedAt: "2026-08-22T04:00:00.000Z",
    detectorVersion: "response-detector-v1",
  },
  responseStartedAt: "2026-08-22T04:00:01.000Z",
  responseLastSeenAt: "2026-08-22T04:00:02.000Z",
} as const;

describe("ObservationCandidate A1 command contract", () => {
  it("accepts an explicit refusal and preserves uncertain correlation", () => {
    expect(
      createObservationCandidateSchema.parse({
        ...validCandidate,
        correlationStatus: "UNCERTAIN",
      }),
    ).toMatchObject({ responseOutcomeKind: "REFUSAL", correlationStatus: "UNCERTAIN" });
  });

  it("rejects every false existence predicate", () => {
    for (const predicate of [
      "targetSurfaceReached",
      "targetQuestionSubmitted",
      "visibleResponseOutcomeObserved",
      "lifecycleAssociated",
    ] as const) {
      expect(() =>
        createObservationCandidateSchema.parse({ ...validCandidate, [predicate]: false }),
      ).toThrow();
    }
  });

  it("rejects operational notices and undeclared command fields", () => {
    expect(() =>
      createObservationCandidateSchema.parse({
        ...validCandidate,
        responseOutcomeKind: "CAPTCHA_REQUIRED",
      }),
    ).toThrow();
    expect(() =>
      createObservationCandidateSchema.parse({ ...validCandidate, metricEligible: true }),
    ).toThrow();
  });
});
