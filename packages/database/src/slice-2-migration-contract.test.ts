import { readFile } from "node:fs/promises";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

let migration = "";

beforeAll(async () => {
  migration = await readFile(
    path.resolve(process.cwd(), "packages/database/migrations/0002_slice_2_observation.sql"),
    "utf8",
  );
});

describe("Slice 2 observation migration contract", () => {
  it("keeps every Slice 2 object directly Tenant and Project scoped", () => {
    for (const table of slice2Tables) {
      const definition = tableDefinition(table);
      expect(definition, table).toContain("tenant_id uuid NOT NULL");
      expect(definition, table).toContain("project_id uuid NOT NULL");
    }
    expect(migration).toContain("ALTER TABLE %I FORCE ROW LEVEL SECURITY");
  });

  it("separates SampleSlot identity from retrying ExecutionRuns", () => {
    expect(tableDefinition("sample_slots")).not.toContain("attempt_no");
    expect(tableDefinition("execution_runs")).toContain("attempt_no integer NOT NULL");
    expect(tableDefinition("execution_runs")).toContain(
      "UNIQUE (tenant_id, sample_slot_id, attempt_no)",
    );
    expect(migration).toContain(
      "retry must reference the immediately preceding ExecutionRun in the same SampleSlot",
    );
  });

  it("freezes assigned releases at queue time and actual context only at start time", () => {
    const execution = tableDefinition("execution_runs");
    expect(execution).toContain("policy_release_id uuid NOT NULL");
    expect(execution).toContain("industry_policy_release_id uuid");
    expect(execution).toContain("execution_context_snapshot jsonb CHECK");
    expect(execution).toContain("started_at IS NULL");
    expect(execution).toContain("actual_platform IS NULL");
    expect(execution).toContain("started_at IS NOT NULL");
    expect(execution).toContain("actual_platform IS NOT NULL");
    expect(migration).toContain("ExecutionRun requires an actual published PolicyRelease");
    expect(migration).toContain(
      "actual execution context can only be written once when ExecutionRun starts",
    );
  });

  it("requires all four A1 predicates and an explicit visible response outcome", () => {
    const candidate = tableDefinition("observation_candidates");
    expect(candidate).toContain(
      "target_surface_reached boolean NOT NULL CHECK (target_surface_reached)",
    );
    expect(candidate).toContain(
      "visible_response_outcome_observed boolean NOT NULL CHECK (visible_response_outcome_observed)",
    );
    expect(candidate).toContain(
      "lifecycle_associated boolean NOT NULL CHECK (lifecycle_associated)",
    );
    expect(migration).toContain(
      "ObservationCandidate requires an explicit visible response outcome",
    );
  });

  it("limits one Candidate and one RawObservation to an ExecutionRun", () => {
    expect(tableDefinition("observation_candidates")).toContain(
      "UNIQUE (tenant_id, execution_run_id)",
    );
    expect(tableDefinition("raw_observations")).toContain(
      "UNIQUE (tenant_id, observation_candidate_id)",
    );
    expect(tableDefinition("raw_observations")).toContain("UNIQUE (tenant_id, execution_run_id)");
  });

  it("separates the immutable first-detection snapshot from the final response fact", () => {
    expect(migration).toContain(
      "RawObservation response window cannot end before Candidate detection",
    );
    expect(migration).toContain(
      "final representation cannot discard the Candidate first-detection form",
    );
    expect(migration).not.toContain("candidate_row.representation <> NEW.representation");
    expect(migration).not.toContain(
      "candidate_row.response_last_seen_at <> NEW.response_last_seen_at",
    );
    expect(migration).toContain("RawObservation requires a terminal ExecutionRun");
  });

  it("makes captured and finalized facts immutable while corrections append", () => {
    const capture = tableDefinition("capture_artifacts");
    expect(capture).toContain("idempotency_key text NOT NULL");
    expect(capture).toContain("UNIQUE (tenant_id, execution_run_id, idempotency_key)");
    expect(migration).toContain("CREATE TRIGGER raw_observations_immutable");
    expect(migration).toContain("CREATE TRIGGER capture_artifacts_immutable");
    expect(migration).toContain("CREATE TRIGGER correction_records_immutable");
    expect(migration).not.toContain("UPDATE (raw_answer_text");
  });

  it("enforces Draft-first releases and immutable published Plan membership", () => {
    expect(migration).toContain("release artifacts must be inserted as DRAFT");
    expect(migration).toContain("plan question membership is immutable after parent publication");
    expect(migration).toContain(
      "a MonitoringPlanVersion requires at least one QuestionVersion before publication",
    );
    expect(migration).toMatch(
      /FROM monitoring_plan_versions\s+WHERE id = parent_id\s+FOR UPDATE;/u,
    );
  });

  it("defines executable content, raw-answer and capture-manifest hash rules", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION canonical_jsonb_sha256");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION question_version_content_sha256");
    expect(migration).toContain("QuestionVersion content SHA-256 mismatch");
    expect(migration).toContain("raw answer artifact SHA-256 mismatch");
    expect(migration).toContain("capture manifest SHA-256 mismatch");
  });

  it("requires execution and Candidate facts to start in their initial states", () => {
    expect(migration).toContain("ExecutionRun must be inserted in a clean QUEUED state");
    expect(migration).toContain("ObservationCandidate must be inserted in CAPTURING state");
    expect(tableDefinition("execution_runs")).toContain(
      "CHECK (response_outcome_kind IS NULL OR started_at IS NOT NULL)",
    );
  });

  it("keeps quality, metric eligibility and Resolution outside RawObservation", () => {
    const observation = tableDefinition("raw_observations");
    expect(observation).not.toMatch(/quality|eligib|resolution/iu);
    expect(observation).toContain("raw_observation_version integer NOT NULL DEFAULT 1");
  });
});

const slice2Tables = [
  "demand_themes",
  "questions",
  "question_versions",
  "monitoring_plans",
  "monitoring_plan_versions",
  "monitoring_plan_version_questions",
  "sample_batches",
  "sample_slots",
  "execution_runs",
  "capture_artifacts",
  "observation_candidates",
  "raw_observations",
  "correction_records",
] as const;

function tableDefinition(tableName: string): string {
  const expression = new RegExp(`CREATE TABLE ${tableName} \\(([\\s\\S]*?)\\n\\);`, "u");
  const match = migration.match(expression);
  if (!match?.[1]) throw new Error(`Table ${tableName} not found in migration`);
  return match[1];
}
