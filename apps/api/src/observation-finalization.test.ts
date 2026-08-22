import { finalizeObservationSchema } from "@geo-os/contracts";
import { describe, expect, it } from "vitest";

const candidateId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const artifactId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("Observation Finalize command contract", () => {
  it("accepts exact text and defaults RawObservation schema version 1", () => {
    const result = finalizeObservationSchema.parse({
      observationCandidateId: candidateId,
      representation: "TEXT",
      rawAnswerText: "Exact visible answer",
      captureArtifactIds: [],
      responseLastSeenAt: "2026-08-22T08:00:00.000+08:00",
    });

    expect(result.rawObservationVersion).toBe(1);
  });

  it("requires raw answer bytes and a unique Capture Manifest", () => {
    expect(() =>
      finalizeObservationSchema.parse({
        observationCandidateId: candidateId,
        representation: "TEXT",
        captureArtifactIds: [],
        responseLastSeenAt: "2026-08-22T08:00:00.000+08:00",
      }),
    ).toThrow();
    expect(() =>
      finalizeObservationSchema.parse({
        observationCandidateId: candidateId,
        representation: "STRUCTURED",
        rawAnswerArtifactId: artifactId,
        captureArtifactIds: [artifactId, artifactId],
        responseLastSeenAt: "2026-08-22T08:00:00.000+08:00",
      }),
    ).toThrow();
  });

  it("requires the raw-answer artifact to be a Capture Manifest member", () => {
    expect(() =>
      finalizeObservationSchema.parse({
        observationCandidateId: candidateId,
        representation: "STRUCTURED",
        rawAnswerArtifactId: artifactId,
        captureArtifactIds: [],
        responseLastSeenAt: "2026-08-22T08:00:00.000+08:00",
      }),
    ).toThrow();
  });

  it("rejects undeclared Finalize and A2/KPI fields", () => {
    expect(() =>
      finalizeObservationSchema.parse({
        observationCandidateId: candidateId,
        representation: "TEXT",
        rawAnswerText: "Exact visible answer",
        captureArtifactIds: [],
        responseLastSeenAt: "2026-08-22T08:00:00.000+08:00",
        metricEligible: true,
      }),
    ).toThrow();
  });
});
