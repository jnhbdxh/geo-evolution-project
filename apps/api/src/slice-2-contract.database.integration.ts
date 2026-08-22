import { createHash, randomUUID } from "node:crypto";

import type {
  CreateExecutionRunInput,
  CreateObservationCandidateInput,
  FinalizeObservationInput,
  StartExecutionRunInput,
  TenantContext,
} from "@geo-os/contracts";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { Database } from "./database.js";
import { PostgresObservationRepository } from "./observation-repository.js";

const databaseUrl = requireTestDatabaseUrl("TEST_DATABASE_URL");
const migrationUrl = requireTestDatabaseUrl("TEST_DATABASE_MIGRATION_URL");
const { Client } = pg;
const databases: Database[] = [];
const clients: pg.Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => client.end()));
  await Promise.all(databases.splice(0).map(async (database) => database.close()));
});

describe("Slice 2 live PostgreSQL contract candidate", () => {
  it("S2-CT-001 rejects a cross-Tenant Plan to QuestionVersion relationship", async () => {
    const owner = await createPlanningFixture("question-owner");
    const outsider = await createPlanningFixture("plan-owner");
    const draftPlanVersionId = await createDraftPlanVersion(outsider);
    const repository = new PostgresObservationRepository(outsider.database);

    const outcome = await settle(
      repository.addQuestionVersionToDraftPlan(
        {
          tenantId: outsider.tenantId,
          userIdentityId: outsider.userIdentityId,
          membershipId: randomUUID(),
          roles: ["TENANT_MEMBER"],
        },
        {
          monitoringPlanVersionId: draftPlanVersionId,
          questionVersionId: owner.questionVersionId,
          ordinal: 1,
        },
        randomUUID(),
      ),
    );

    expect(outcome).toMatchObject({ status: "rejected", reason: { code: "NOT_FOUND" } });
  });

  it("creates one A1 Candidate at the first visible response and preserves it through terminal failure", async () => {
    const fixture = await createPlanningFixture("candidate-command-running");
    const repository = new PostgresObservationRepository(fixture.database);
    const context = fixtureContext(fixture);
    const executionRunId = await createExecutionRun(fixture);
    const started = await repository.startExecutionRun(
      context,
      executionRunId,
      actualExecutionContext(),
      randomUUID(),
    );
    if (!started.started_at) throw new Error("Candidate command fixture did not start");
    const command = candidateCommand(executionRunId, started.started_at, {
      correlationStatus: "UNCERTAIN",
    });
    const [first, replay] = await Promise.all([
      repository.createObservationCandidate(context, command, randomUUID()),
      repository.createObservationCandidate(context, command, randomUUID()),
    ]);
    const failed = await repository.failExecutionRun(
      context,
      executionRunId,
      { operationalError: { code: "TIMEOUT_AFTER_RESPONSE" } },
      randomUUID(),
    );
    const counts = await candidateCommandCounts(fixture, executionRunId);

    expect(replay.id).toBe(first.id);
    expect(first).toMatchObject({
      status: "CAPTURING",
      representation: "TEXT",
      correlation_status: "UNCERTAIN",
      visible_response_outcome_observed: true,
    });
    expect(failed).toMatchObject({
      operational_status: "FAILED",
      response_outcome_kind: "ANSWER",
    });
    expect(counts).toEqual({ candidates: 1, audit: 1, outbox: 1 });
  });

  it("rolls back Candidate and Execution response outcome when its Outbox write fails", async () => {
    const fixture = await createPlanningFixture("candidate-outbox-rollback");
    const repository = new PostgresObservationRepository(fixture.database);
    const context = fixtureContext(fixture);
    const executionRunId = await createExecutionRun(fixture);
    const started = await repository.startExecutionRun(
      context,
      executionRunId,
      actualExecutionContext(),
      randomUUID(),
    );
    if (!started.started_at) throw new Error("Candidate rollback fixture did not start");
    const traceId = randomUUID();
    await installObservationOutboxFailureTrigger(traceId);

    try {
      const outcome = await settle(
        repository.createObservationCandidate(
          context,
          candidateCommand(executionRunId, started.started_at),
          traceId,
        ),
      );
      const state = await fixture.database.withTenantTransaction(
        fixture.tenantId,
        async (client) => {
          const execution = await client.query<{ response_outcome_kind: string | null }>(
            "SELECT response_outcome_kind FROM execution_runs WHERE id = $1",
            [executionRunId],
          );
          const counts = await candidateCommandCounts(fixture, executionRunId);
          return {
            responseOutcomeKind: execution.rows[0]?.response_outcome_kind,
            ...counts,
          };
        },
      );

      expect(outcome).toMatchObject({ status: "rejected", reason: { code: "P0001" } });
      expect(state).toEqual({
        responseOutcomeKind: null,
        candidates: 0,
        audit: 0,
        outbox: 0,
      });
    } finally {
      await removeObservationOutboxFailureTrigger();
    }
  });

  it("finalizes a first TEXT detection as the later complete MIXED response exactly once", async () => {
    const fixture = await createPlanningFixture("finalize-streamed-mixed");
    const repository = new PostgresObservationRepository(fixture.database);
    const context = fixtureContext(fixture);
    const executionRunId = await createExecutionRun(fixture);
    const started = await repository.startExecutionRun(
      context,
      executionRunId,
      actualExecutionContext(),
      randomUUID(),
    );
    if (!started.started_at) throw new Error("Finalize stream fixture did not start");
    const candidate = await repository.createObservationCandidate(
      context,
      candidateCommand(executionRunId, started.started_at),
      randomUUID(),
    );
    const runningCommand = {
      observationCandidateId: candidate.id,
      representation: "MIXED",
      rawAnswerText: "First text followed by a structured result card.",
      captureArtifactIds: [],
      responseLastSeenAt: candidate.response_last_seen_at.toISOString(),
      rawObservationVersion: 1,
    } satisfies FinalizeObservationInput;
    const runningFinalize = await settle(
      repository.finalizeObservation(context, runningCommand, randomUUID()),
    );
    const completed = await repository.completeExecutionRun(
      context,
      executionRunId,
      { responseOutcomeKind: "ANSWER" },
      randomUUID(),
    );
    if (!completed.completed_at) throw new Error("Finalize stream fixture did not complete");
    const finalLastSeenAt = completed.completed_at;
    const command = {
      ...runningCommand,
      responseLastSeenAt: finalLastSeenAt.toISOString(),
    } satisfies FinalizeObservationInput;

    const [first, replay] = await Promise.all([
      repository.finalizeObservation(context, command, randomUUID()),
      repository.finalizeObservation(context, command, randomUUID()),
    ]);
    const conflictingReplay = await settle(
      repository.finalizeObservation(
        context,
        { ...command, rawAnswerText: "Conflicting replacement response" },
        randomUUID(),
      ),
    );
    const state = await fixture.database.withTenantRead(fixture.tenantId, async (client) => {
      const candidateResult = await client.query<{
        status: string;
        representation: string;
        response_last_seen_at: Date;
        finalized_at: Date;
      }>(
        `SELECT status, representation, response_last_seen_at, finalized_at
           FROM observation_candidates WHERE id = $1`,
        [candidate.id],
      );
      const eventResult = await client.query<{ audit: number; outbox: number }>(
        `SELECT
           (SELECT count(*)::integer FROM audit_events
             WHERE target_type = 'RawObservation' AND target_id = $1) AS audit,
           (SELECT count(*)::integer FROM outbox_events
             WHERE aggregate_type = 'RawObservation' AND aggregate_id = $1) AS outbox`,
        [first.id],
      );
      return { candidate: candidateResult.rows[0], events: eventResult.rows[0] };
    });

    expect(runningFinalize).toMatchObject({
      status: "rejected",
      reason: { code: "CONFLICT" },
    });
    expect(replay.id).toBe(first.id);
    expect(first).toMatchObject({
      representation: "MIXED",
      response_started_at: candidate.response_started_at,
      response_last_seen_at: finalLastSeenAt,
    });
    expect(state.candidate).toMatchObject({
      status: "FINALIZED",
      representation: "TEXT",
      response_last_seen_at: candidate.response_last_seen_at,
      finalized_at: first.finalized_at,
    });
    expect(state.events).toEqual({ audit: 1, outbox: 1 });
    expect(conflictingReplay).toMatchObject({
      status: "rejected",
      reason: { code: "CONFLICT" },
    });
  });

  it("rejects RUNNING Finalize through both Repository and database defenses", async () => {
    const fixture = await createPlanningFixture("finalize-running-rejected");
    const repository = new PostgresObservationRepository(fixture.database);
    const context = fixtureContext(fixture);
    const executionRunId = await createExecutionRun(fixture);
    const started = await repository.startExecutionRun(
      context,
      executionRunId,
      actualExecutionContext(),
      randomUUID(),
    );
    if (!started.started_at) throw new Error("RUNNING Finalize fixture did not start");
    const candidate = await repository.createObservationCandidate(
      context,
      candidateCommand(executionRunId, started.started_at),
      randomUUID(),
    );
    const command = {
      observationCandidateId: candidate.id,
      representation: "TEXT",
      rawAnswerText: "Still generating",
      captureArtifactIds: [],
      responseLastSeenAt: candidate.response_last_seen_at.toISOString(),
      rawObservationVersion: 1,
    } satisfies FinalizeObservationInput;

    const repositoryAttempt = await settle(
      repository.finalizeObservation(context, command, randomUUID()),
    );
    const databaseAttempt = await settle(
      fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
        await client.query(
          "UPDATE observation_candidates SET status = 'FINALIZING' WHERE id = $1",
          [candidate.id],
        );
        await insertRawObservation(
          client,
          fixture,
          executionRunId,
          candidate.id,
          command.rawAnswerText,
          sha256(command.rawAnswerText),
        );
      }),
    );
    const state = await fixture.database.withTenantRead(fixture.tenantId, async (client) => {
      const candidateResult = await client.query<{ status: string }>(
        "SELECT status FROM observation_candidates WHERE id = $1",
        [candidate.id],
      );
      const rawResult = await client.query(
        "SELECT id FROM raw_observations WHERE observation_candidate_id = $1",
        [candidate.id],
      );
      return { status: candidateResult.rows[0]?.status, rawCount: rawResult.rowCount };
    });

    expect(repositoryAttempt).toMatchObject({
      status: "rejected",
      reason: { code: "CONFLICT" },
    });
    expect(databaseAttempt).toMatchObject({
      status: "rejected",
      reason: { code: "P0001" },
    });
    expect(state).toEqual({ status: "CAPTURING", rawCount: 0 });
  });

  it("rejects Finalize commands that discard or shrink first-detection evidence", async () => {
    const fixture = await createPlanningFixture("finalize-monotonic-evidence");
    const repository = new PostgresObservationRepository(fixture.database);
    const context = fixtureContext(fixture);
    const executionRunId = await createExecutionRun(fixture);
    const started = await repository.startExecutionRun(
      context,
      executionRunId,
      actualExecutionContext(),
      randomUUID(),
    );
    if (!started.started_at) throw new Error("Finalize monotonic fixture did not start");
    const candidate = await repository.createObservationCandidate(
      context,
      candidateCommand(executionRunId, started.started_at),
      randomUUID(),
    );
    await repository.completeExecutionRun(
      context,
      executionRunId,
      { responseOutcomeKind: "ANSWER" },
      randomUUID(),
    );
    const baseCommand = {
      observationCandidateId: candidate.id,
      representation: "TEXT",
      rawAnswerText: "Exact response",
      captureArtifactIds: [],
      responseLastSeenAt: candidate.response_last_seen_at.toISOString(),
      rawObservationVersion: 1,
    } satisfies FinalizeObservationInput;

    const discardedForm = await settle(
      repository.finalizeObservation(
        context,
        { ...baseCommand, representation: "STRUCTURED" },
        randomUUID(),
      ),
    );
    const shrunkWindow = await settle(
      repository.finalizeObservation(
        context,
        {
          ...baseCommand,
          responseLastSeenAt: new Date(candidate.response_last_seen_at.getTime() - 1).toISOString(),
        },
        randomUUID(),
      ),
    );

    expect(discardedForm).toMatchObject({
      status: "rejected",
      reason: { code: "CONFLICT" },
    });
    expect(shrunkWindow).toMatchObject({
      status: "rejected",
      reason: { code: "CONFLICT" },
    });
  });

  it("rolls back Candidate, RawObservation, Audit and Outbox when Finalize event write fails", async () => {
    const fixture = await createPlanningFixture("finalize-outbox-rollback");
    const repository = new PostgresObservationRepository(fixture.database);
    const context = fixtureContext(fixture);
    const executionRunId = await createExecutionRun(fixture);
    const started = await repository.startExecutionRun(
      context,
      executionRunId,
      actualExecutionContext(),
      randomUUID(),
    );
    if (!started.started_at) throw new Error("Finalize rollback fixture did not start");
    const candidate = await repository.createObservationCandidate(
      context,
      candidateCommand(executionRunId, started.started_at),
      randomUUID(),
    );
    await repository.failExecutionRun(
      context,
      executionRunId,
      { operationalError: { code: "TIMEOUT_AFTER_RESPONSE" } },
      randomUUID(),
    );
    const traceId = randomUUID();
    await installObservationOutboxFailureTrigger(traceId);

    try {
      const outcome = await settle(
        repository.finalizeObservation(
          context,
          {
            observationCandidateId: candidate.id,
            representation: "TEXT",
            rawAnswerText: "Exact response bytes represented as UTF-8 text.",
            captureArtifactIds: [],
            responseLastSeenAt: candidate.response_last_seen_at.toISOString(),
            rawObservationVersion: 1,
          },
          traceId,
        ),
      );
      const state = await fixture.database.withTenantRead(fixture.tenantId, async (client) => {
        const candidateResult = await client.query<{ status: string; finalized_at: Date | null }>(
          "SELECT status, finalized_at FROM observation_candidates WHERE id = $1",
          [candidate.id],
        );
        const observationResult = await client.query(
          "SELECT id FROM raw_observations WHERE observation_candidate_id = $1",
          [candidate.id],
        );
        const auditResult = await client.query("SELECT id FROM audit_events WHERE trace_id = $1", [
          traceId,
        ]);
        const outboxResult = await client.query(
          "SELECT id FROM outbox_events WHERE trace_id = $1",
          [traceId],
        );
        return {
          candidate: candidateResult.rows[0],
          observations: observationResult.rowCount,
          audit: auditResult.rowCount,
          outbox: outboxResult.rowCount,
        };
      });

      expect(outcome).toMatchObject({ status: "rejected", reason: { code: "P0001" } });
      expect(state).toEqual({
        candidate: { status: "CAPTURING", finalized_at: null },
        observations: 0,
        audit: 0,
        outbox: 0,
      });
    } finally {
      await removeObservationOutboxFailureTrigger();
    }
  });

  it("hides the Finalize command and evidence manifest from another Tenant", async () => {
    const owner = await createPlanningFixture("finalize-owner");
    const outsider = await createPlanningFixture("finalize-outsider");
    const ownerRepository = new PostgresObservationRepository(owner.database);
    const outsiderRepository = new PostgresObservationRepository(outsider.database);
    const ownerContext = fixtureContext(owner);
    const executionRunId = await createExecutionRun(owner);
    const started = await ownerRepository.startExecutionRun(
      ownerContext,
      executionRunId,
      actualExecutionContext(),
      randomUUID(),
    );
    if (!started.started_at) throw new Error("Finalize isolation fixture did not start");
    const candidate = await ownerRepository.createObservationCandidate(
      ownerContext,
      candidateCommand(executionRunId, started.started_at),
      randomUUID(),
    );
    const command = {
      observationCandidateId: candidate.id,
      representation: "TEXT",
      rawAnswerText: "Tenant-private exact response",
      captureArtifactIds: [],
      responseLastSeenAt: candidate.response_last_seen_at.toISOString(),
      rawObservationVersion: 1,
    } satisfies FinalizeObservationInput;

    const evidenceLookup = await settle(
      outsiderRepository.resolveObservationFinalizationEvidence(fixtureContext(outsider), command),
    );
    const finalizeAttempt = await settle(
      outsiderRepository.finalizeObservation(fixtureContext(outsider), command, randomUUID()),
    );

    expect(evidenceLookup).toMatchObject({
      status: "rejected",
      reason: { code: "NOT_FOUND" },
    });
    expect(finalizeAttempt).toMatchObject({
      status: "rejected",
      reason: { code: "NOT_FOUND" },
    });
  });

  it("rejects Candidate creation for cross-Tenant execution, confirmed wrong target and invalid timeline", async () => {
    const owner = await createPlanningFixture("candidate-owner");
    const outsider = await createPlanningFixture("candidate-outsider");
    const ownerRepository = new PostgresObservationRepository(owner.database);
    const outsiderRepository = new PostgresObservationRepository(outsider.database);
    const ownerExecutionId = await createExecutionRun(owner);
    const ownerStarted = await ownerRepository.startExecutionRun(
      fixtureContext(owner),
      ownerExecutionId,
      actualExecutionContext(),
      randomUUID(),
    );
    if (!ownerStarted.started_at) throw new Error("Owner Candidate execution did not start");
    const crossTenant = await settle(
      outsiderRepository.createObservationCandidate(
        fixtureContext(outsider),
        candidateCommand(ownerExecutionId, ownerStarted.started_at),
        randomUUID(),
      ),
    );

    const wrongTargetFixture = await createPlanningFixture("candidate-wrong-target");
    const wrongTargetRepository = new PostgresObservationRepository(wrongTargetFixture.database);
    const wrongTargetExecutionId = await createExecutionRun(wrongTargetFixture);
    const wrongTargetStarted = await wrongTargetRepository.startExecutionRun(
      fixtureContext(wrongTargetFixture),
      wrongTargetExecutionId,
      actualExecutionContext({ actualSurface: "wrong-surface" }),
      randomUUID(),
    );
    if (!wrongTargetStarted.started_at) throw new Error("Wrong-target execution did not start");
    const wrongTarget = await settle(
      wrongTargetRepository.createObservationCandidate(
        fixtureContext(wrongTargetFixture),
        candidateCommand(wrongTargetExecutionId, wrongTargetStarted.started_at),
        randomUUID(),
      ),
    );
    const invalidTimeline = await settle(
      ownerRepository.createObservationCandidate(
        fixtureContext(owner),
        candidateCommand(ownerExecutionId, ownerStarted.started_at, {
          responseStartedAt: new Date(ownerStarted.started_at.getTime() - 1_000).toISOString(),
        }),
        randomUUID(),
      ),
    );

    expect(crossTenant).toMatchObject({ status: "rejected", reason: { code: "NOT_FOUND" } });
    expect(wrongTarget).toMatchObject({ status: "rejected", reason: { code: "CONFLICT" } });
    expect(invalidTimeline).toMatchObject({ status: "rejected", reason: { code: "CONFLICT" } });
  });

  it("rejects mismatched existence basis and unowned Capture evidence without partial facts", async () => {
    const fixture = await createPlanningFixture("candidate-evidence-validation");
    const repository = new PostgresObservationRepository(fixture.database);
    const context = fixtureContext(fixture);
    const executionRunId = await createExecutionRun(fixture);
    const started = await repository.startExecutionRun(
      context,
      executionRunId,
      actualExecutionContext(),
      randomUUID(),
    );
    if (!started.started_at) throw new Error("Candidate evidence fixture did not start");
    const base = candidateCommand(executionRunId, started.started_at);
    const mismatchedBasis = await settle(
      repository.createObservationCandidate(
        context,
        { ...base, responseOutcomeKind: "REFUSAL" },
        randomUUID(),
      ),
    );
    const missingArtifact = await settle(
      repository.createObservationCandidate(
        context,
        {
          ...base,
          existenceBasis: {
            ...base.existenceBasis,
            evidenceArtifactIds: [randomUUID()],
          },
        },
        randomUUID(),
      ),
    );
    const execution = await fixture.database.withTenantTransaction(
      fixture.tenantId,
      async (client) => {
        const result = await client.query<{ response_outcome_kind: string | null }>(
          "SELECT response_outcome_kind FROM execution_runs WHERE id = $1",
          [executionRunId],
        );
        return result.rows[0]?.response_outcome_kind;
      },
    );
    const counts = await candidateCommandCounts(fixture, executionRunId);

    expect(mismatchedBasis).toMatchObject({
      status: "rejected",
      reason: { code: "CONFLICT" },
    });
    expect(missingArtifact).toMatchObject({
      status: "rejected",
      reason: { code: "NOT_FOUND" },
    });
    expect({ responseOutcomeKind: execution, ...counts }).toEqual({
      responseOutcomeKind: null,
      candidates: 0,
      audit: 0,
      outbox: 0,
    });
  });

  it("rolls back Plan membership and Audit when Observation Outbox insertion fails", async () => {
    const fixture = await createPlanningFixture("observation-outbox-rollback");
    const draftPlanVersionId = await createDraftPlanVersion(fixture);
    const repository = new PostgresObservationRepository(fixture.database);
    const traceId = randomUUID();
    await installObservationOutboxFailureTrigger(traceId);

    try {
      const outcome = await settle(
        repository.addQuestionVersionToDraftPlan(
          {
            tenantId: fixture.tenantId,
            userIdentityId: fixture.userIdentityId,
            membershipId: randomUUID(),
            roles: ["TENANT_MEMBER"],
          },
          {
            monitoringPlanVersionId: draftPlanVersionId,
            questionVersionId: fixture.questionVersionId,
            ordinal: 1,
          },
          traceId,
        ),
      );
      const counts = await fixture.database.withTenantTransaction(
        fixture.tenantId,
        async (client) => {
          const membership = await client.query<{ count: number }>(
            `SELECT count(*)::integer AS count
               FROM monitoring_plan_version_questions
              WHERE monitoring_plan_version_id = $1`,
            [draftPlanVersionId],
          );
          const audit = await client.query<{ count: number }>(
            "SELECT count(*)::integer AS count FROM audit_events WHERE trace_id = $1",
            [traceId],
          );
          const outbox = await client.query<{ count: number }>(
            "SELECT count(*)::integer AS count FROM outbox_events WHERE trace_id = $1",
            [traceId],
          );
          return {
            membership: membership.rows[0]?.count,
            audit: audit.rows[0]?.count,
            outbox: outbox.rows[0]?.count,
          };
        },
      );

      expect(outcome).toMatchObject({ status: "rejected", reason: { code: "P0001" } });
      expect(counts).toEqual({ membership: 0, audit: 0, outbox: 0 });
    } finally {
      await removeObservationOutboxFailureTrigger();
    }
  });

  it("serializes member deletion before Plan publication and rejects the empty release", async () => {
    const fixture = await createPlanningFixture("delete-before-publish");
    const planVersionId = await createDraftPlanVersionWithQuestion(fixture);
    const deleteClient = await connectTenantClient("delete_member_first");
    await deleteClient.query("BEGIN");
    await deleteClient.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await deleteClient.query(
      "DELETE FROM monitoring_plan_version_questions WHERE monitoring_plan_version_id = $1",
      [planVersionId],
    );

    const publishClient = await connectTenantClient("publish_waiting");
    await publishClient.query("BEGIN");
    await publishClient.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    const publication = settle(
      publishClient.query(
        `UPDATE monitoring_plan_versions
            SET content_sha256 = monitoring_plan_version_content_sha256(id),
                status = 'PUBLISHED', published_at = clock_timestamp()
          WHERE id = $1`,
        [planVersionId],
      ),
    );
    expect(await observeLockWait("publish_waiting")).toBe(true);
    await deleteClient.query("COMMIT");
    const outcome = await publication;
    await publishClient.query("ROLLBACK");

    expect(outcome).toMatchObject({ status: "rejected", reason: { code: "P0001" } });
  });

  it("serializes Plan publication before member deletion and preserves the release", async () => {
    const fixture = await createPlanningFixture("publish-before-delete");
    const planVersionId = await createDraftPlanVersionWithQuestion(fixture);
    const publishClient = await connectTenantClient("publish_first");
    await publishClient.query("BEGIN");
    await publishClient.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await publishClient.query(
      `UPDATE monitoring_plan_versions
          SET content_sha256 = monitoring_plan_version_content_sha256(id),
              status = 'PUBLISHED', published_at = clock_timestamp()
        WHERE id = $1`,
      [planVersionId],
    );

    const deleteClient = await connectTenantClient("delete_waiting");
    await deleteClient.query("BEGIN");
    await deleteClient.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    const deletion = settle(
      deleteClient.query(
        "DELETE FROM monitoring_plan_version_questions WHERE monitoring_plan_version_id = $1",
        [planVersionId],
      ),
    );
    expect(await observeLockWait("delete_waiting")).toBe(true);
    await publishClient.query("COMMIT");
    const outcome = await deletion;
    await deleteClient.query("ROLLBACK");

    expect(outcome).toMatchObject({ status: "rejected", reason: { code: "P0001" } });
  });

  it("S2-CT-002/003 protects published QuestionVersion and Plan membership", async () => {
    const fixture = await createPlanningFixture("release-protection");

    const editQuestion = await settle(
      fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
        await client.query("UPDATE question_versions SET prompt_text = 'changed' WHERE id = $1", [
          fixture.questionVersionId,
        ]);
      }),
    );
    const editMembership = await settle(
      fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
        await client.query(
          "DELETE FROM monitoring_plan_version_questions WHERE monitoring_plan_version_id = $1",
          [fixture.monitoringPlanVersionId],
        );
      }),
    );

    expect(editQuestion).toMatchObject({ status: "rejected", reason: { code: "P0001" } });
    expect(editMembership).toMatchObject({ status: "rejected", reason: { code: "P0001" } });
  });

  it("rejects a QuestionVersion whose content hash does not cover its semantic payload", async () => {
    const fixture = await createPlanningFixture("question-hash");
    const outcome = await settle(
      fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
        const questionId = randomUUID();
        await client.query(
          `INSERT INTO questions(id, tenant_id, project_id, name, created_by_user_identity_id)
           VALUES ($1, $2, $3, 'Bad Hash Question', $4)`,
          [questionId, fixture.tenantId, fixture.projectId, fixture.userIdentityId],
        );
        await client.query(
          `INSERT INTO question_versions(
             tenant_id, project_id, question_id, version, prompt_text,
             content_sha256, created_by_user_identity_id
           ) VALUES ($1, $2, $3, 1, 'exact prompt', $4, $5)`,
          [fixture.tenantId, fixture.projectId, questionId, "0".repeat(64), fixture.userIdentityId],
        );
      }),
    );
    expect(outcome).toMatchObject({ status: "rejected", reason: { code: "P0001" } });
  });

  it("S2-CT-004 creates retry ExecutionRuns without increasing SampleSlot N", async () => {
    const fixture = await createPlanningFixture("retry-sample-n");
    const repository = new PostgresObservationRepository(fixture.database);
    const first = await repository.createExecutionRun(
      fixtureContext(fixture),
      fixture.projectId,
      executionCommand(fixture),
      randomUUID(),
    );
    await repository.failExecutionRun(
      fixtureContext(fixture),
      first.id,
      { operationalError: { code: "STARTUP_FAILURE" } },
      randomUUID(),
    );
    const retry = await repository.createExecutionRun(
      fixtureContext(fixture),
      fixture.projectId,
      executionCommand(fixture, { retryOfExecutionRunId: first.id }),
      randomUUID(),
    );

    const counts = await fixture.database.withTenantTransaction(
      fixture.tenantId,
      async (client) => {
        const slots = await client.query<{ count: number }>(
          "SELECT count(*)::integer AS count FROM sample_slots WHERE sample_batch_id = $1",
          [fixture.sampleBatchId],
        );
        const runs = await client.query<{ count: number }>(
          "SELECT count(*)::integer AS count FROM execution_runs WHERE sample_slot_id = $1",
          [fixture.sampleSlotId],
        );
        return { slots: slots.rows[0]?.count, runs: runs.rows[0]?.count };
      },
    );
    expect(retry).toMatchObject({ attempt_no: 2, retry_of_execution_run_id: first.id });
    expect(counts).toEqual({ slots: 1, runs: 2 });
  });

  it("S2-CT-005 returns the same ExecutionRun for the same idempotent command", async () => {
    const fixture = await createPlanningFixture("run-idempotency");
    const repository = new PostgresObservationRepository(fixture.database);
    const input = executionCommand(fixture);
    const first = await repository.createExecutionRun(
      fixtureContext(fixture),
      fixture.projectId,
      input,
      randomUUID(),
    );
    const duplicate = await repository.createExecutionRun(
      fixtureContext(fixture),
      fixture.projectId,
      input,
      randomUUID(),
    );

    expect(duplicate.id).toBe(first.id);
  });

  it("serializes concurrent idempotent Execution commands into one run and one event", async () => {
    const fixture = await createPlanningFixture("run-idempotency-concurrency");
    const repository = new PostgresObservationRepository(fixture.database);
    const input = executionCommand(fixture);
    const [first, second] = await Promise.all([
      repository.createExecutionRun(
        fixtureContext(fixture),
        fixture.projectId,
        input,
        randomUUID(),
      ),
      repository.createExecutionRun(
        fixtureContext(fixture),
        fixture.projectId,
        input,
        randomUUID(),
      ),
    ]);

    const counts = await fixture.database.withTenantTransaction(
      fixture.tenantId,
      async (client) => {
        const runs = await client.query<{ count: number }>(
          "SELECT count(*)::integer AS count FROM execution_runs WHERE sample_slot_id = $1",
          [fixture.sampleSlotId],
        );
        const events = await client.query<{ count: number }>(
          `SELECT count(*)::integer AS count
             FROM outbox_events
            WHERE aggregate_type = 'ExecutionRun' AND aggregate_id = $1
              AND event_type = 'ExecutionQueued'`,
          [first.id],
        );
        return { runs: runs.rows[0]?.count, events: events.rows[0]?.count };
      },
    );

    expect(second.id).toBe(first.id);
    expect(counts).toEqual({ runs: 1, events: 1 });
  });

  it("serializes different commands for one SampleSlot and prevents duplicate first attempts", async () => {
    const fixture = await createPlanningFixture("run-slot-concurrency");
    const repository = new PostgresObservationRepository(fixture.database);
    const outcomes = await Promise.all([
      settle(
        repository.createExecutionRun(
          fixtureContext(fixture),
          fixture.projectId,
          executionCommand(fixture),
          randomUUID(),
        ),
      ),
      settle(
        repository.createExecutionRun(
          fixtureContext(fixture),
          fixture.projectId,
          executionCommand(fixture),
          randomUUID(),
        ),
      ),
    ]);
    const runCount = await fixture.database.withTenantTransaction(
      fixture.tenantId,
      async (client) => {
        const result = await client.query<{ count: number }>(
          "SELECT count(*)::integer AS count FROM execution_runs WHERE sample_slot_id = $1",
          [fixture.sampleSlotId],
        );
        return result.rows[0]?.count;
      },
    );

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(runCount).toBe(1);
  });

  it("rejects idempotency-key reuse with different Execution semantics", async () => {
    const fixture = await createPlanningFixture("run-idempotency-conflict");
    const repository = new PostgresObservationRepository(fixture.database);
    const input = executionCommand(fixture);
    await repository.createExecutionRun(
      fixtureContext(fixture),
      fixture.projectId,
      input,
      randomUUID(),
    );

    const outcome = await settle(
      repository.createExecutionRun(
        fixtureContext(fixture),
        fixture.projectId,
        { ...input, retryOfExecutionRunId: randomUUID() },
        randomUUID(),
      ),
    );

    expect(outcome).toMatchObject({ status: "rejected", reason: { code: "CONFLICT" } });
  });

  it("rejects missing, cross-Tenant and inactive Project execution parents", async () => {
    const owner = await createPlanningFixture("execution-parent-owner");
    const outsider = await createPlanningFixture("execution-parent-outsider");
    const repository = new PostgresObservationRepository(owner.database);
    const missingSlot = await settle(
      repository.createExecutionRun(
        fixtureContext(owner),
        owner.projectId,
        executionCommand(owner, { sampleSlotId: randomUUID() }),
        randomUUID(),
      ),
    );
    const outsiderRepository = new PostgresObservationRepository(outsider.database);
    const crossTenant = await settle(
      outsiderRepository.createExecutionRun(
        fixtureContext(outsider),
        owner.projectId,
        executionCommand(owner),
        randomUUID(),
      ),
    );
    const otherProjectId = await createAdditionalProject(owner);
    const wrongProject = await settle(
      repository.createExecutionRun(
        fixtureContext(owner),
        otherProjectId,
        executionCommand(owner),
        randomUUID(),
      ),
    );
    await owner.database.withTenantTransaction(owner.tenantId, async (client) => {
      await client.query(
        `UPDATE projects
            SET status = 'DEACTIVATED', deactivated_at = clock_timestamp(),
                deactivation_reason = 'execution parent test'
          WHERE id = $1`,
        [owner.projectId],
      );
    });
    const inactiveProject = await settle(
      repository.createExecutionRun(
        fixtureContext(owner),
        owner.projectId,
        executionCommand(owner),
        randomUUID(),
      ),
    );

    expect(missingSlot).toMatchObject({ status: "rejected", reason: { code: "NOT_FOUND" } });
    expect(crossTenant).toMatchObject({ status: "rejected", reason: { code: "NOT_FOUND" } });
    expect(wrongProject).toMatchObject({ status: "rejected", reason: { code: "NOT_FOUND" } });
    expect(inactiveProject).toMatchObject({ status: "rejected", reason: { code: "CONFLICT" } });
  });

  it("freezes assigned PolicyRelease at queue time and actual runtime context at start time", async () => {
    const fixture = await createPlanningFixture("execution-context-freeze");
    const repository = new PostgresObservationRepository(fixture.database);
    const queued = await repository.createExecutionRun(
      fixtureContext(fixture),
      fixture.projectId,
      executionCommand(fixture),
      randomUUID(),
    );
    const run = await repository.startExecutionRun(
      fixtureContext(fixture),
      queued.id,
      actualExecutionContext({
        actualPlatform: "openai",
        actualModel: "gpt-frozen",
        actualSurface: "responses-api",
        executionContextSnapshot: { locale: "zh-CN", region: "CN", temperature: 0 },
      }),
      randomUUID(),
    );

    expect(queued).toMatchObject({
      operational_status: "QUEUED",
      actual_platform: null,
      actual_model: null,
      actual_surface: null,
      execution_context_snapshot: null,
      policy_release_id: "00000000-0000-4000-8000-000000000002",
    });
    expect(run).toMatchObject({
      operational_status: "RUNNING",
      attempt_no: 1,
      actual_platform: "openai",
      actual_model: "gpt-frozen",
      actual_surface: "responses-api",
      policy_release_id: "00000000-0000-4000-8000-000000000002",
      execution_context_snapshot: { locale: "zh-CN", region: "CN", temperature: 0 },
    });
  });

  it("enforces Execution lifecycle, visible-response ownership and idempotent transitions", async () => {
    const fixture = await createPlanningFixture("execution-lifecycle-command");
    const repository = new PostgresObservationRepository(fixture.database);
    const queued = await repository.createExecutionRun(
      fixtureContext(fixture),
      fixture.projectId,
      executionCommand(fixture),
      randomUUID(),
    );
    const prematureVisibleFailure = await settle(
      repository.failExecutionRun(
        fixtureContext(fixture),
        queued.id,
        { responseOutcomeKind: "REFUSAL", operationalError: { code: "EARLY" } },
        randomUUID(),
      ),
    );
    const started = await repository.startExecutionRun(
      fixtureContext(fixture),
      queued.id,
      actualExecutionContext(),
      randomUUID(),
    );
    const startedAgain = await repository.startExecutionRun(
      fixtureContext(fixture),
      queued.id,
      actualExecutionContext(),
      randomUUID(),
    );
    const mismatchedStart = await settle(
      repository.startExecutionRun(
        fixtureContext(fixture),
        queued.id,
        actualExecutionContext({ actualModel: "forged-after-start" }),
        randomUUID(),
      ),
    );
    const directActualMutation = await settle(
      fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
        await client.query("UPDATE execution_runs SET actual_model = 'mutated' WHERE id = $1", [
          queued.id,
        ]);
      }),
    );
    const completed = await repository.completeExecutionRun(
      fixtureContext(fixture),
      queued.id,
      { responseOutcomeKind: "ANSWER" },
      randomUUID(),
    );
    const completedAgain = await repository.completeExecutionRun(
      fixtureContext(fixture),
      queued.id,
      { responseOutcomeKind: "ANSWER" },
      randomUUID(),
    );
    const retryCompletedVisible = await settle(
      repository.createExecutionRun(
        fixtureContext(fixture),
        fixture.projectId,
        executionCommand(fixture, { retryOfExecutionRunId: queued.id }),
        randomUUID(),
      ),
    );
    const eventCount = await fixture.database.withTenantTransaction(
      fixture.tenantId,
      async (client) => {
        const result = await client.query<{ count: number }>(
          "SELECT count(*)::integer AS count FROM outbox_events WHERE aggregate_id = $1",
          [queued.id],
        );
        return result.rows[0]?.count;
      },
    );

    expect(prematureVisibleFailure).toMatchObject({
      status: "rejected",
      reason: { code: "CONFLICT" },
    });
    expect(startedAgain.started_at).toEqual(started.started_at);
    expect(mismatchedStart).toMatchObject({
      status: "rejected",
      reason: { code: "CONFLICT" },
    });
    expect(directActualMutation).toMatchObject({
      status: "rejected",
      reason: { code: "P0001" },
    });
    expect(completedAgain.completed_at).toEqual(completed.completed_at);
    expect(completed).toMatchObject({
      operational_status: "COMPLETED",
      response_outcome_kind: "ANSWER",
    });
    expect(retryCompletedVisible).toMatchObject({
      status: "rejected",
      reason: { code: "CONFLICT" },
    });
    expect(eventCount).toBe(3);
  });

  it("rolls back Execution creation and lifecycle changes when Outbox insertion fails", async () => {
    const fixture = await createPlanningFixture("execution-outbox-rollback");
    const repository = new PostgresObservationRepository(fixture.database);
    const creationTraceId = randomUUID();
    await installObservationOutboxFailureTrigger(creationTraceId);
    try {
      const creation = await settle(
        repository.createExecutionRun(
          fixtureContext(fixture),
          fixture.projectId,
          executionCommand(fixture),
          creationTraceId,
        ),
      );
      const creationCounts = await executionTraceCounts(fixture, creationTraceId);
      expect(creation).toMatchObject({ status: "rejected", reason: { code: "P0001" } });
      expect(creationCounts).toEqual({ runs: 0, audit: 0, outbox: 0 });
    } finally {
      await removeObservationOutboxFailureTrigger();
    }

    const queued = await repository.createExecutionRun(
      fixtureContext(fixture),
      fixture.projectId,
      executionCommand(fixture),
      randomUUID(),
    );
    const startTraceId = randomUUID();
    await installObservationOutboxFailureTrigger(startTraceId);
    try {
      const start = await settle(
        repository.startExecutionRun(
          fixtureContext(fixture),
          queued.id,
          actualExecutionContext(),
          startTraceId,
        ),
      );
      const state = await fixture.database.withTenantTransaction(
        fixture.tenantId,
        async (client) => {
          const result = await client.query<{
            operational_status: string;
            started_at: Date | null;
            actual_platform: string | null;
            execution_context_snapshot: Readonly<Record<string, unknown>> | null;
          }>(
            `SELECT operational_status, started_at, actual_platform, execution_context_snapshot
               FROM execution_runs WHERE id = $1`,
            [queued.id],
          );
          return result.rows[0];
        },
      );
      const traceCounts = await executionTraceCounts(fixture, startTraceId);
      expect(start).toMatchObject({ status: "rejected", reason: { code: "P0001" } });
      expect(state).toEqual({
        operational_status: "QUEUED",
        started_at: null,
        actual_platform: null,
        execution_context_snapshot: null,
      });
      expect(traceCounts).toEqual({ runs: 1, audit: 0, outbox: 0 });
    } finally {
      await removeObservationOutboxFailureTrigger();
    }
  });

  it("S2-CT-009 rejects a second Candidate for one ExecutionRun", async () => {
    const fixture = await createPlanningFixture("candidate-uniqueness");
    const executionRunId = await createExecutionRun(fixture);
    await failExecutionWithRefusal(fixture, executionRunId);
    await insertCandidate(fixture, executionRunId);

    const duplicate = await settle(insertCandidate(fixture, executionRunId));
    expect(duplicate).toMatchObject({ status: "rejected", reason: { code: "23505" } });
  });

  it("S2-CT-006/008 rejects Candidate creation without explicit visible response evidence", async () => {
    const fixture = await createPlanningFixture("no-visible-response");
    const executionRunId = await createExecutionRun(fixture);
    const repository = new PostgresObservationRepository(fixture.database);
    await repository.startExecutionRun(
      fixtureContext(fixture),
      executionRunId,
      actualExecutionContext(),
      randomUUID(),
    );

    const noOutcome = await settle(insertCandidate(fixture, executionRunId));
    await repository.failExecutionRun(
      fixtureContext(fixture),
      executionRunId,
      {
        responseOutcomeKind: "REFUSAL",
        operationalError: { code: "TIMEOUT_AFTER_RESPONSE" },
      },
      randomUUID(),
    );
    const falsePredicate = await settle(
      fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
        await client.query(
          `INSERT INTO observation_candidates(
             tenant_id, project_id, execution_run_id, representation, correlation_status,
             target_surface_reached, target_question_submitted,
             visible_response_outcome_observed, lifecycle_associated,
             existence_basis, response_started_at, response_last_seen_at
           )
           SELECT $1, $2, $3, 'TEXT', 'CONFIRMED', true, true, false, true,
                  jsonb_build_object(
                    'kind', 'VISIBLE_REFUSAL',
                    'questionSubmittedAt', er.started_at,
                    'detectorVersion', 'false-predicate-test-v1'
                  ),
                  er.started_at,
                  COALESCE(er.completed_at, er.started_at)
             FROM execution_runs er
            WHERE er.tenant_id = $1 AND er.id = $3`,
          [fixture.tenantId, fixture.projectId, executionRunId],
        );
      }),
    );

    expect(noOutcome).toMatchObject({ status: "rejected", reason: { code: "P0001" } });
    expect(falsePredicate).toMatchObject({ status: "rejected", reason: { code: "23514" } });
  });

  it("rejects direct terminal INSERTs for ExecutionRun and ObservationCandidate", async () => {
    const fixture = await createPlanningFixture("initial-state");
    const terminalRun = await settle(
      fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
        await client.query(
          `INSERT INTO execution_runs(
             tenant_id, project_id, sample_slot_id, question_version_id,
             attempt_no, idempotency_key, operational_status, response_outcome_kind,
             actual_platform, actual_model, actual_surface, policy_release_id,
             execution_context_snapshot, completed_at
           ) VALUES (
             $1, $2, $3, $4, 1, $5, 'FAILED', 'REFUSAL',
             'test-platform', 'test-model', 'chat',
             '00000000-0000-4000-8000-000000000002', '{}'::jsonb, clock_timestamp()
           )`,
          [
            fixture.tenantId,
            fixture.projectId,
            fixture.sampleSlotId,
            fixture.questionVersionId,
            `terminal-${randomUUID()}`,
          ],
        );
      }),
    );
    const queuedWithActualContext = await settle(
      fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
        await client.query(
          `INSERT INTO execution_runs(
             tenant_id, project_id, sample_slot_id, question_version_id,
             attempt_no, idempotency_key, actual_platform, actual_model, actual_surface,
             policy_release_id, execution_context_snapshot
           ) VALUES (
             $1, $2, $3, $4, 1, $5, 'tenant-declared', 'unverified', 'chat',
             '00000000-0000-4000-8000-000000000002', '{}'::jsonb
           )`,
          [
            fixture.tenantId,
            fixture.projectId,
            fixture.sampleSlotId,
            fixture.questionVersionId,
            `queued-actual-${randomUUID()}`,
          ],
        );
      }),
    );
    const executionRunId = await createExecutionRun(fixture);
    await failExecutionWithRefusal(fixture, executionRunId);
    const terminalCandidate = await settle(
      fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
        await client.query(
          `INSERT INTO observation_candidates(
             tenant_id, project_id, execution_run_id, status, representation,
             correlation_status, target_surface_reached, target_question_submitted,
             visible_response_outcome_observed, lifecycle_associated, existence_basis,
             response_started_at, response_last_seen_at
           ) VALUES (
             $1, $2, $3, 'FINALIZING', 'TEXT', 'CONFIRMED', true, true, true, true,
             '{}'::jsonb, clock_timestamp(), clock_timestamp()
           )`,
          [fixture.tenantId, fixture.projectId, executionRunId],
        );
      }),
    );

    expect(terminalRun).toMatchObject({ status: "rejected", reason: { code: "P0001" } });
    expect(queuedWithActualContext).toMatchObject({
      status: "rejected",
      reason: { code: "P0001" },
    });
    expect(terminalCandidate).toMatchObject({
      status: "rejected",
      reason: { code: "P0001" },
    });
  });

  it("S2-CT-007 permits a visible refusal even when the run operationally fails", async () => {
    const fixture = await createPlanningFixture("failed-with-refusal");
    const executionRunId = await createExecutionRun(fixture);
    await failExecutionWithRefusal(fixture, executionRunId);

    const candidateId = await insertCandidate(fixture, executionRunId);
    expect(candidateId).toMatch(/[0-9a-f-]{36}/u);
  });

  it("allows startup failure without a response but rejects visible response before start", async () => {
    const fixture = await createPlanningFixture("startup-failure");
    const executionRunId = await createExecutionRun(fixture);
    const impossibleResponse = await settle(
      fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
        await client.query(
          `UPDATE execution_runs
              SET operational_status = 'FAILED', response_outcome_kind = 'REFUSAL',
                  completed_at = clock_timestamp(), operational_error = '{"code":"STARTUP_FAILED"}'::jsonb
            WHERE id = $1`,
          [executionRunId],
        );
      }),
    );
    await fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
      await client.query(
        `UPDATE execution_runs
            SET operational_status = 'FAILED', completed_at = clock_timestamp(),
                operational_error = '{"code":"STARTUP_FAILED"}'::jsonb
          WHERE id = $1`,
        [executionRunId],
      );
    });
    const state = await fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
      const result = await client.query<{
        operational_status: string;
        response_outcome_kind: string | null;
        started_at: Date | null;
      }>(
        `SELECT operational_status, response_outcome_kind, started_at
             FROM execution_runs WHERE id = $1`,
        [executionRunId],
      );
      return result.rows[0];
    });

    expect(impossibleResponse).toMatchObject({
      status: "rejected",
      reason: { code: "23514" },
    });
    expect(state).toEqual({
      operational_status: "FAILED",
      response_outcome_kind: null,
      started_at: null,
    });
  });

  it("S2-CT-010/011 finalizes once and rejects RawObservation mutation", async () => {
    const fixture = await createPlanningFixture("finalize-once");
    const executionRunId = await createExecutionRun(fixture);
    await failExecutionWithRefusal(fixture, executionRunId);
    const candidateId = await insertCandidate(fixture, executionRunId);
    const rawText = "I cannot provide that information.";
    const observationId = await finalizeCandidate(fixture, executionRunId, candidateId, rawText);

    const secondRead = await fixture.database.withTenantTransaction(
      fixture.tenantId,
      async (client) => {
        const result = await client.query<{ id: string }>(
          "SELECT id FROM raw_observations WHERE observation_candidate_id = $1",
          [candidateId],
        );
        return result.rows[0]?.id;
      },
    );
    const mutation = await settle(
      fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
        await client.query(
          "UPDATE raw_observations SET raw_answer_text = 'rewritten' WHERE id = $1",
          [observationId],
        );
      }),
    );

    expect(secondRead).toBe(observationId);
    expect(mutation).toMatchObject({ status: "rejected", reason: { code: "42501" } });
  });

  it("S2-CT-012 rolls back finalization when the raw-answer hash mismatches", async () => {
    const fixture = await createPlanningFixture("hash-mismatch");
    const executionRunId = await createExecutionRun(fixture);
    await failExecutionWithRefusal(fixture, executionRunId);
    const candidateId = await insertCandidate(fixture, executionRunId);

    const outcome = await settle(
      fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
        await client.query(
          "UPDATE observation_candidates SET status = 'FINALIZING' WHERE id = $1",
          [candidateId],
        );
        await insertRawObservation(
          client,
          fixture,
          executionRunId,
          candidateId,
          "exact raw answer",
          "0".repeat(64),
        );
      }),
    );
    const state = await fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
      const candidate = await client.query<{ status: string }>(
        "SELECT status FROM observation_candidates WHERE id = $1",
        [candidateId],
      );
      const observation = await client.query(
        "SELECT id FROM raw_observations WHERE observation_candidate_id = $1",
        [candidateId],
      );
      return { status: candidate.rows[0]?.status, observationCount: observation.rowCount };
    });

    expect(outcome).toMatchObject({ status: "rejected", reason: { code: "P0001" } });
    expect(state).toEqual({ status: "CAPTURING", observationCount: 0 });
  });

  it("validates artifact-only raw bytes, Manifest hash and CaptureArtifact immutability", async () => {
    const fixture = await createPlanningFixture("artifact-only");
    const executionRunId = await createExecutionRun(fixture);
    await failExecutionWithRefusal(fixture, executionRunId);
    const candidateId = await insertCandidate(fixture, executionRunId);
    const artifactHash = sha256("artifact response bytes");
    const artifactId = await insertCaptureArtifact(
      fixture,
      executionRunId,
      artifactHash,
      "RAW_RESPONSE",
    );
    const manifest = JSON.stringify({ schema_version: 1, artifact_ids: [artifactId] });

    const observationId = await fixture.database.withTenantTransaction(
      fixture.tenantId,
      async (client) => {
        await client.query(
          "UPDATE observation_candidates SET status = 'FINALIZING' WHERE id = $1",
          [candidateId],
        );
        const result = await client.query<{ id: string }>(
          `INSERT INTO raw_observations(
             tenant_id, project_id, observation_candidate_id, execution_run_id,
             question_version_id, representation, raw_answer_artifact_id,
             raw_answer_sha256, capture_manifest, capture_hash,
             execution_context_snapshot, response_started_at, response_last_seen_at, finalized_at
           )
           SELECT $1, $2, oc.id, oc.execution_run_id, $4, oc.representation, $5, $6,
                  $7::jsonb, canonical_jsonb_sha256($7::jsonb), er.execution_context_snapshot,
                  oc.response_started_at, oc.response_last_seen_at, clock_timestamp()
             FROM observation_candidates oc
             JOIN execution_runs er ON er.id = oc.execution_run_id
            WHERE oc.id = $3
           RETURNING id`,
          [
            fixture.tenantId,
            fixture.projectId,
            candidateId,
            fixture.questionVersionId,
            artifactId,
            artifactHash,
            manifest,
          ],
        );
        await client.query(
          `UPDATE observation_candidates
              SET status = 'FINALIZED', finalized_at = clock_timestamp()
            WHERE id = $1`,
          [candidateId],
        );
        const id = result.rows[0]?.id;
        if (!id) throw new Error("Artifact-only RawObservation not returned");
        return id;
      },
    );
    const artifactMutation = await settle(
      withMigrationClient(async (client) => {
        await client.query("UPDATE capture_artifacts SET storage_key = 'rewritten' WHERE id = $1", [
          artifactId,
        ]);
      }),
    );

    expect(observationId).toMatch(/[0-9a-f-]{36}/u);
    expect(artifactMutation).toMatchObject({
      status: "rejected",
      reason: { code: "P0001" },
    });
  });

  it("rejects artifact-only finalization when the artifact or Manifest hash is inconsistent", async () => {
    const fixture = await createPlanningFixture("artifact-hash-mismatch");
    const executionRunId = await createExecutionRun(fixture);
    await failExecutionWithRefusal(fixture, executionRunId);
    const candidateId = await insertCandidate(fixture, executionRunId);
    const actualArtifactHash = sha256("actual artifact");
    const artifactId = await insertCaptureArtifact(
      fixture,
      executionRunId,
      actualArtifactHash,
      "RAW_RESPONSE",
    );
    const manifest = JSON.stringify({ schema_version: 1, artifact_ids: [artifactId] });

    const outcome = await settle(
      fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
        await client.query(
          "UPDATE observation_candidates SET status = 'FINALIZING' WHERE id = $1",
          [candidateId],
        );
        await client.query(
          `INSERT INTO raw_observations(
             tenant_id, project_id, observation_candidate_id, execution_run_id,
             question_version_id, representation, raw_answer_artifact_id,
             raw_answer_sha256, capture_manifest, capture_hash,
             execution_context_snapshot, response_started_at, response_last_seen_at, finalized_at
           )
           SELECT $1, $2, oc.id, oc.execution_run_id, $4, oc.representation, $5,
                  $6, $7::jsonb, $8, er.execution_context_snapshot,
                  oc.response_started_at, oc.response_last_seen_at, clock_timestamp()
             FROM observation_candidates oc
             JOIN execution_runs er ON er.id = oc.execution_run_id
            WHERE oc.id = $3`,
          [
            fixture.tenantId,
            fixture.projectId,
            candidateId,
            fixture.questionVersionId,
            artifactId,
            "0".repeat(64),
            manifest,
            "f".repeat(64),
          ],
        );
      }),
    );
    expect(outcome).toMatchObject({ status: "rejected", reason: { code: "P0001" } });

    const manifestMismatch = await settle(
      fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
        await client.query(
          "UPDATE observation_candidates SET status = 'FINALIZING' WHERE id = $1",
          [candidateId],
        );
        await client.query(
          `INSERT INTO raw_observations(
             tenant_id, project_id, observation_candidate_id, execution_run_id,
             question_version_id, representation, raw_answer_artifact_id,
             raw_answer_sha256, capture_manifest, capture_hash,
             execution_context_snapshot, response_started_at, response_last_seen_at, finalized_at
           )
           SELECT $1, $2, oc.id, oc.execution_run_id, $4, oc.representation, $5,
                  $6, $7::jsonb, $8, er.execution_context_snapshot,
                  oc.response_started_at, oc.response_last_seen_at, clock_timestamp()
             FROM observation_candidates oc
             JOIN execution_runs er ON er.id = oc.execution_run_id
            WHERE oc.id = $3`,
          [
            fixture.tenantId,
            fixture.projectId,
            candidateId,
            fixture.questionVersionId,
            artifactId,
            actualArtifactHash,
            manifest,
            "f".repeat(64),
          ],
        );
      }),
    );
    expect(manifestMismatch).toMatchObject({
      status: "rejected",
      reason: { code: "P0001" },
    });
  });

  it("S2-CT-015 appends a CorrectionRecord without changing the raw fact", async () => {
    const fixture = await createPlanningFixture("correction");
    const executionRunId = await createExecutionRun(fixture);
    await failExecutionWithRefusal(fixture, executionRunId);
    const candidateId = await insertCandidate(fixture, executionRunId);
    const rawText = "Original raw response";
    const observationId = await finalizeCandidate(fixture, executionRunId, candidateId, rawText);

    await fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
      await client.query(
        `INSERT INTO correction_records(
           tenant_id, project_id, raw_observation_id, reason,
           replacement_projection, created_by_user_identity_id
         ) VALUES ($1, $2, $3, 'parser projection error', $4::jsonb, $5)`,
        [
          fixture.tenantId,
          fixture.projectId,
          observationId,
          JSON.stringify({ displayText: "Corrected projection only" }),
          fixture.userIdentityId,
        ],
      );
    });
    const observation = await fixture.database.withTenantTransaction(
      fixture.tenantId,
      async (client) => {
        const result = await client.query<{ raw_answer_text: string; raw_answer_sha256: string }>(
          "SELECT raw_answer_text, raw_answer_sha256 FROM raw_observations WHERE id = $1",
          [observationId],
        );
        return result.rows[0];
      },
    );
    expect(observation).toEqual({
      raw_answer_text: rawText,
      raw_answer_sha256: sha256(rawText),
    });
  });

  it("S2-CT-014 preserves actual Execution release IDs after the Project default changes", async () => {
    const fixture = await createPlanningFixture("binding-history");
    const executionRunId = (
      await new PostgresObservationRepository(fixture.database).createExecutionRun(
        fixtureContext(fixture),
        fixture.projectId,
        executionCommand(fixture),
        randomUUID(),
      )
    ).id;
    const replacementReleaseId = randomUUID();
    await withMigrationClient(async (client) => {
      const manifest = JSON.stringify({ contract: "slice-2-test", version: shortRunId() });
      await client.query(
        `INSERT INTO policy_releases(
           id, policy_definition_id, version, status, manifest, manifest_sha256, published_at
         ) VALUES (
           $1, '00000000-0000-4000-8000-000000000001', $2, 'PUBLISHED', $3::jsonb,
           encode(digest($3::text, 'sha256'), 'hex'), clock_timestamp()
         )`,
        [replacementReleaseId, `s2-${shortRunId()}`, manifest],
      );
    });
    await fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
      const changedAt = new Date();
      await client.query(
        `UPDATE project_policy_bindings
            SET effective_to = $3
          WHERE tenant_id = $1 AND project_id = $2 AND effective_to IS NULL`,
        [fixture.tenantId, fixture.projectId, changedAt],
      );
      await client.query(
        `INSERT INTO project_policy_bindings(
           tenant_id, project_id, policy_definition_id, policy_release_id,
           effective_from, reason, created_by_user_identity_id
         ) VALUES (
           $1, $2, '00000000-0000-4000-8000-000000000001', $3,
           $4, 'contract test replacement', $5
         )`,
        [
          fixture.tenantId,
          fixture.projectId,
          replacementReleaseId,
          changedAt,
          fixture.userIdentityId,
        ],
      );
    });

    const actualReleaseId = await fixture.database.withTenantTransaction(
      fixture.tenantId,
      async (client) => {
        const result = await client.query<{ policy_release_id: string }>(
          "SELECT policy_release_id FROM execution_runs WHERE id = $1",
          [executionRunId],
        );
        return result.rows[0]?.policy_release_id;
      },
    );
    expect(actualReleaseId).toBe("00000000-0000-4000-8000-000000000002");
  });

  it("S2-CT-016 RLS hides another Tenant's Observation", async () => {
    const owner = await createPlanningFixture("observation-owner");
    const outsider = await createPlanningFixture("observation-outsider");
    const executionRunId = await createExecutionRun(owner);
    await failExecutionWithRefusal(owner, executionRunId);
    const candidateId = await insertCandidate(owner, executionRunId);
    const observationId = await finalizeCandidate(owner, executionRunId, candidateId, "private");

    const visible = await outsider.database.withTenantTransaction(
      outsider.tenantId,
      async (client) => {
        const result = await client.query("SELECT id FROM raw_observations WHERE id = $1", [
          observationId,
        ]);
        return result.rowCount;
      },
    );
    expect(visible).toBe(0);
  });
});

interface PlanningFixture {
  readonly database: Database;
  readonly tenantId: string;
  readonly userIdentityId: string;
  readonly projectId: string;
  readonly questionVersionId: string;
  readonly monitoringPlanVersionId: string;
  readonly sampleBatchId: string;
  readonly sampleSlotId: string;
}

function fixtureContext(fixture: PlanningFixture): TenantContext {
  return {
    tenantId: fixture.tenantId,
    userIdentityId: fixture.userIdentityId,
    membershipId: randomUUID(),
    roles: ["TENANT_MEMBER"],
  };
}

function executionCommand(
  fixture: PlanningFixture,
  overrides: Partial<CreateExecutionRunInput> = {},
): CreateExecutionRunInput {
  return {
    sampleSlotId: fixture.sampleSlotId,
    idempotencyKey: `execute-${randomUUID()}`,
    ...overrides,
  };
}

function actualExecutionContext(
  overrides: Partial<StartExecutionRunInput> = {},
): StartExecutionRunInput {
  return {
    actualPlatform: "test-platform",
    actualModel: "test-model",
    actualSurface: "chat",
    executionContextSnapshot: { locale: "zh-CN", runtime: "fixture" },
    ...overrides,
  };
}

function candidateCommand(
  executionRunId: string,
  executionStartedAt: Date,
  overrides: Partial<CreateObservationCandidateInput> = {},
): CreateObservationCandidateInput {
  const observedAt = new Date(Math.max(Date.now(), executionStartedAt.getTime()));
  return {
    executionRunId,
    responseOutcomeKind: "ANSWER",
    representation: "TEXT",
    correlationStatus: "CONFIRMED",
    targetSurfaceReached: true,
    targetQuestionSubmitted: true,
    visibleResponseOutcomeObserved: true,
    lifecycleAssociated: true,
    existenceBasis: {
      kind: "VISIBLE_TEXT_RESPONSE",
      questionSubmittedAt: observedAt.toISOString(),
      detectorVersion: "candidate-contract-test-v1",
      conversationMarker: `conversation-${executionRunId}`,
      responseMarker: `response-${executionRunId}`,
    },
    responseStartedAt: observedAt.toISOString(),
    responseLastSeenAt: observedAt.toISOString(),
    ...overrides,
  };
}

async function candidateCommandCounts(
  fixture: PlanningFixture,
  executionRunId: string,
): Promise<{ readonly candidates: number; readonly audit: number; readonly outbox: number }> {
  return fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
    const candidates = await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM observation_candidates WHERE execution_run_id = $1",
      [executionRunId],
    );
    const audit = await client.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM audit_events
        WHERE target_type = 'ObservationCandidate'
          AND details->>'execution_run_id' = $1`,
      [executionRunId],
    );
    const outbox = await client.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM outbox_events
        WHERE aggregate_type = 'ObservationCandidate'
          AND payload->'data'->>'execution_run_id' = $1`,
      [executionRunId],
    );
    return {
      candidates: candidates.rows[0]?.count ?? -1,
      audit: audit.rows[0]?.count ?? -1,
      outbox: outbox.rows[0]?.count ?? -1,
    };
  });
}

async function executionTraceCounts(
  fixture: PlanningFixture,
  traceId: string,
): Promise<{ readonly runs: number; readonly audit: number; readonly outbox: number }> {
  return fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
    const runs = await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM execution_runs WHERE sample_slot_id = $1",
      [fixture.sampleSlotId],
    );
    const audit = await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM audit_events WHERE trace_id = $1",
      [traceId],
    );
    const outbox = await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM outbox_events WHERE trace_id = $1",
      [traceId],
    );
    return {
      runs: runs.rows[0]?.count ?? -1,
      audit: audit.rows[0]?.count ?? -1,
      outbox: outbox.rows[0]?.count ?? -1,
    };
  });
}

async function createAdditionalProject(fixture: PlanningFixture): Promise<string> {
  return fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
    const project = await client.query<{ brand_id: string }>(
      "SELECT brand_id FROM projects WHERE id = $1",
      [fixture.projectId],
    );
    const brandId = project.rows[0]?.brand_id;
    if (!brandId) throw new Error("Fixture Brand was not returned");
    const projectId = randomUUID();
    await client.query(
      "INSERT INTO projects(id, tenant_id, brand_id, name) VALUES ($1, $2, $3, 'Other Project')",
      [projectId, fixture.tenantId, brandId],
    );
    return projectId;
  });
}

async function createPlanningFixture(label: string): Promise<PlanningFixture> {
  const database = createDatabase(`slice2_${shortRunId()}`);
  const tenantId = randomUUID();
  const userIdentityId = randomUUID();
  const projectId = randomUUID();
  await withMigrationClient(async (client) => {
    const customerId = randomUUID();
    const brandId = randomUUID();
    await client.query(
      `INSERT INTO user_identities(id, issuer, subject, display_name)
       VALUES ($1, 'slice-2-test', $2, $3)`,
      [userIdentityId, randomUUID(), `Slice 2 ${label}`],
    );
    await client.query("INSERT INTO tenants(id, slug, name) VALUES ($1, $2, $3)", [
      tenantId,
      `s2-${shortRunId()}`,
      `Tenant ${label}`,
    ]);
    await client.query("INSERT INTO customers(id, tenant_id, name) VALUES ($1, $2, 'Customer')", [
      customerId,
      tenantId,
    ]);
    await client.query(
      "INSERT INTO brands(id, tenant_id, customer_id, name) VALUES ($1, $2, $3, 'Brand')",
      [brandId, tenantId, customerId],
    );
    await client.query(
      "INSERT INTO projects(id, tenant_id, brand_id, name) VALUES ($1, $2, $3, 'Project')",
      [projectId, tenantId, brandId],
    );
    await client.query(
      `INSERT INTO project_policy_bindings(
         tenant_id, project_id, policy_definition_id, policy_release_id,
         reason, created_by_user_identity_id
       ) VALUES (
         $1, $2, '00000000-0000-4000-8000-000000000001',
         '00000000-0000-4000-8000-000000000002', 'fixture default', $3
       )`,
      [tenantId, projectId, userIdentityId],
    );
  });

  return database.withTenantTransaction(tenantId, async (client) => {
    const questionId = randomUUID();
    const questionVersionId = randomUUID();
    const monitoringPlanId = randomUUID();
    const monitoringPlanVersionId = randomUUID();
    const sampleBatchId = randomUUID();
    const sampleSlotId = randomUUID();
    const prompt = `What is ${label}?`;
    await client.query(
      `INSERT INTO questions(id, tenant_id, project_id, name, created_by_user_identity_id)
       VALUES ($1, $2, $3, 'Question', $4)`,
      [questionId, tenantId, projectId, userIdentityId],
    );
    await client.query(
      `INSERT INTO question_versions(
         id, tenant_id, project_id, question_id, version, prompt_text,
         content_sha256, created_by_user_identity_id
       ) VALUES (
         $1, $2, $3, $4, 1, $5,
         question_version_content_sha256($5, 'zh-CN', '{}'::jsonb), $6
       )`,
      [questionVersionId, tenantId, projectId, questionId, prompt, userIdentityId],
    );
    await client.query(
      "UPDATE question_versions SET status = 'PUBLISHED', published_at = clock_timestamp() WHERE id = $1",
      [questionVersionId],
    );
    await client.query(
      `INSERT INTO monitoring_plans(id, tenant_id, project_id, name, created_by_user_identity_id)
       VALUES ($1, $2, $3, 'Plan', $4)`,
      [monitoringPlanId, tenantId, projectId, userIdentityId],
    );
    await client.query(
      `INSERT INTO monitoring_plan_versions(
         id, tenant_id, project_id, monitoring_plan_id, version,
         planned_platform, planned_model, planned_surface, sampling_config,
         content_sha256, created_by_user_identity_id
       ) VALUES ($1, $2, $3, $4, 1, 'test-platform', 'test-model', 'chat',
                 '{"sampleCount":1}'::jsonb, $5, $6)`,
      [
        monitoringPlanVersionId,
        tenantId,
        projectId,
        monitoringPlanId,
        sha256("plan"),
        userIdentityId,
      ],
    );
    await client.query(
      `INSERT INTO monitoring_plan_version_questions(
         tenant_id, project_id, monitoring_plan_version_id, question_version_id, ordinal
       ) VALUES ($1, $2, $3, $4, 1)`,
      [tenantId, projectId, monitoringPlanVersionId, questionVersionId],
    );
    await client.query(
      `UPDATE monitoring_plan_versions
          SET content_sha256 = monitoring_plan_version_content_sha256(id),
              status = 'PUBLISHED',
              published_at = clock_timestamp()
        WHERE id = $1`,
      [monitoringPlanVersionId],
    );
    await client.query(
      `INSERT INTO sample_batches(
         id, tenant_id, project_id, monitoring_plan_version_id,
         idempotency_key, scheduled_for, scheduled_by_user_identity_id
       ) VALUES ($1, $2, $3, $4, $5, clock_timestamp(), $6)`,
      [
        sampleBatchId,
        tenantId,
        projectId,
        monitoringPlanVersionId,
        `batch-${randomUUID()}`,
        userIdentityId,
      ],
    );
    await client.query(
      `INSERT INTO sample_slots(
         id, tenant_id, project_id, sample_batch_id, question_version_id,
         slot_key, planned_context, planned_for
       ) VALUES ($1, $2, $3, $4, $5, 'slot-1', '{}'::jsonb, clock_timestamp())`,
      [sampleSlotId, tenantId, projectId, sampleBatchId, questionVersionId],
    );
    return {
      database,
      tenantId,
      userIdentityId,
      projectId,
      questionVersionId,
      monitoringPlanVersionId,
      sampleBatchId,
      sampleSlotId,
    };
  });
}

async function createDraftPlanVersion(fixture: PlanningFixture): Promise<string> {
  return fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
    const planId = randomUUID();
    const planVersionId = randomUUID();
    await client.query(
      `INSERT INTO monitoring_plans(id, tenant_id, project_id, name, created_by_user_identity_id)
       VALUES ($1, $2, $3, 'Draft Plan', $4)`,
      [planId, fixture.tenantId, fixture.projectId, fixture.userIdentityId],
    );
    await client.query(
      `INSERT INTO monitoring_plan_versions(
         id, tenant_id, project_id, monitoring_plan_id, version,
         planned_platform, planned_model, planned_surface, sampling_config,
         content_sha256, created_by_user_identity_id
       ) VALUES (
         $1, $2, $3, $4, 1, 'test-platform', 'test-model', 'chat',
         '{"sampleCount":1}'::jsonb, $5, $6
       )`,
      [
        planVersionId,
        fixture.tenantId,
        fixture.projectId,
        planId,
        "0".repeat(64),
        fixture.userIdentityId,
      ],
    );
    return planVersionId;
  });
}

async function createDraftPlanVersionWithQuestion(fixture: PlanningFixture): Promise<string> {
  const planVersionId = await createDraftPlanVersion(fixture);
  await fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
    await client.query(
      `INSERT INTO monitoring_plan_version_questions(
         tenant_id, project_id, monitoring_plan_version_id, question_version_id, ordinal
       ) VALUES ($1, $2, $3, $4, 1)`,
      [fixture.tenantId, fixture.projectId, planVersionId, fixture.questionVersionId],
    );
  });
  return planVersionId;
}

async function createExecutionRun(
  fixture: PlanningFixture,
  idempotencyKey = `execute-${randomUUID()}`,
): Promise<string> {
  return fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO execution_runs(
         tenant_id, project_id, sample_slot_id, question_version_id,
         attempt_no, idempotency_key, policy_release_id
       ) VALUES ($1, $2, $3, $4, 1, $5, '00000000-0000-4000-8000-000000000002')
       RETURNING id`,
      [
        fixture.tenantId,
        fixture.projectId,
        fixture.sampleSlotId,
        fixture.questionVersionId,
        idempotencyKey,
      ],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("ExecutionRun not returned");
    return id;
  });
}

async function insertCaptureArtifact(
  fixture: PlanningFixture,
  executionRunId: string,
  artifactHash: string,
  artifactKind: "RAW_RESPONSE" | "STRUCTURED_RESPONSE",
): Promise<string> {
  return fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO capture_artifacts(
         tenant_id, project_id, execution_run_id, idempotency_key, artifact_kind,
         storage_bucket, storage_key, media_type, byte_size, sha256, captured_at
       ) VALUES ($1, $2, $3, $4, $5, 'geo-os-test', $6, 'application/octet-stream', 23, $7,
                 clock_timestamp())
       RETURNING id`,
      [
        fixture.tenantId,
        fixture.projectId,
        executionRunId,
        `artifact-${randomUUID()}`,
        artifactKind,
        `${fixture.tenantId}/${executionRunId}/${randomUUID()}`,
        artifactHash,
      ],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("CaptureArtifact not returned");
    return id;
  });
}

async function failExecutionWithRefusal(
  fixture: PlanningFixture,
  executionRunId: string,
): Promise<void> {
  await fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
    await client.query(
      `UPDATE execution_runs
          SET operational_status = 'RUNNING',
              actual_platform = 'test-platform',
              actual_model = 'test-model',
              actual_surface = 'chat',
              execution_context_snapshot = '{"runtime":"test"}'::jsonb,
              started_at = clock_timestamp()
        WHERE id = $1`,
      [executionRunId],
    );
  });
  await fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
    await client.query(
      `UPDATE execution_runs
          SET operational_status = 'FAILED', response_outcome_kind = 'REFUSAL',
              completed_at = clock_timestamp(), operational_error = '{"code":"TIMEOUT_AFTER_RESPONSE"}'::jsonb
        WHERE id = $1`,
      [executionRunId],
    );
  });
}

async function insertCandidate(fixture: PlanningFixture, executionRunId: string): Promise<string> {
  return fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO observation_candidates(
         tenant_id, project_id, execution_run_id, representation, correlation_status,
         target_surface_reached, target_question_submitted,
         visible_response_outcome_observed, lifecycle_associated,
         existence_basis, response_started_at, response_last_seen_at
       )
       SELECT $1, $2, $3, 'TEXT', 'CONFIRMED', true, true, true, true,
              jsonb_build_object(
                'kind', 'VISIBLE_REFUSAL',
                'questionSubmittedAt', er.started_at,
                'detectorVersion', 'slice-2-sql-fixture-v1'
              ),
              er.started_at,
              COALESCE(er.completed_at, er.started_at)
         FROM execution_runs er
        WHERE er.tenant_id = $1 AND er.id = $3
       RETURNING id`,
      [fixture.tenantId, fixture.projectId, executionRunId],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("ObservationCandidate not returned");
    return id;
  });
}

async function finalizeCandidate(
  fixture: PlanningFixture,
  executionRunId: string,
  candidateId: string,
  rawText: string,
): Promise<string> {
  return fixture.database.withTenantTransaction(fixture.tenantId, async (client) => {
    const existing = await client.query<{ id: string }>(
      "SELECT id FROM raw_observations WHERE observation_candidate_id = $1",
      [candidateId],
    );
    if (existing.rows[0]?.id) return existing.rows[0].id;
    await client.query(
      "UPDATE observation_candidates SET status = 'FINALIZING' WHERE id = $1 AND status = 'CAPTURING'",
      [candidateId],
    );
    const observationId = await insertRawObservation(
      client,
      fixture,
      executionRunId,
      candidateId,
      rawText,
      sha256(rawText),
    );
    await client.query(
      `UPDATE observation_candidates
          SET status = 'FINALIZED', finalized_at = clock_timestamp()
        WHERE id = $1 AND status = 'FINALIZING'`,
      [candidateId],
    );
    return observationId;
  });
}

async function insertRawObservation(
  client: pg.PoolClient,
  fixture: PlanningFixture,
  executionRunId: string,
  candidateId: string,
  rawText: string,
  rawHash: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO raw_observations(
       tenant_id, project_id, observation_candidate_id, execution_run_id,
       question_version_id, representation, raw_answer_text, raw_answer_sha256,
       capture_manifest, capture_hash, execution_context_snapshot,
       response_started_at, response_last_seen_at, finalized_at
     )
     SELECT $1, $2, oc.id, oc.execution_run_id, $4, oc.representation, $5, $6,
            $7::jsonb, canonical_jsonb_sha256($7::jsonb), er.execution_context_snapshot,
            oc.response_started_at, oc.response_last_seen_at, clock_timestamp()
       FROM observation_candidates oc
       JOIN execution_runs er ON er.id = oc.execution_run_id
      WHERE oc.id = $3
     RETURNING id`,
    [
      fixture.tenantId,
      fixture.projectId,
      candidateId,
      fixture.questionVersionId,
      rawText,
      rawHash,
      JSON.stringify({ schema_version: 1, artifact_ids: [] }),
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`RawObservation not returned for ${executionRunId}`);
  return id;
}

function createDatabase(applicationName: string): Database {
  const url = new URL(databaseUrl);
  url.searchParams.set("application_name", applicationName);
  const database = new Database(url.toString());
  databases.push(database);
  return database;
}

async function withMigrationClient<T>(operation: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = new URL(migrationUrl);
  url.searchParams.set("application_name", `slice2_admin_${shortRunId()}`);
  const client = new Client({ connectionString: url.toString() });
  clients.push(client);
  await client.connect();
  return operation(client);
}

async function installObservationOutboxFailureTrigger(traceId: string): Promise<void> {
  await withMigrationClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS test_observation_outbox_failures(trace_id uuid PRIMARY KEY);
      CREATE OR REPLACE FUNCTION fail_selected_observation_outbox()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM test_observation_outbox_failures WHERE trace_id = NEW.trace_id
        ) THEN
          RAISE EXCEPTION 'selected Observation Outbox failure';
        END IF;
        RETURN NEW;
      END
      $$;
      DROP TRIGGER IF EXISTS fail_selected_observation_outbox_trigger ON outbox_events;
      CREATE TRIGGER fail_selected_observation_outbox_trigger
        BEFORE INSERT ON outbox_events
        FOR EACH ROW EXECUTE FUNCTION fail_selected_observation_outbox();
    `);
    await client.query("INSERT INTO test_observation_outbox_failures(trace_id) VALUES ($1)", [
      traceId,
    ]);
  });
}

async function removeObservationOutboxFailureTrigger(): Promise<void> {
  await withMigrationClient(async (client) => {
    await client.query(`
      DROP TRIGGER IF EXISTS fail_selected_observation_outbox_trigger ON outbox_events;
      DROP FUNCTION IF EXISTS fail_selected_observation_outbox();
      DROP TABLE IF EXISTS test_observation_outbox_failures;
    `);
  });
}

async function connectTenantClient(applicationName: string): Promise<pg.Client> {
  const url = new URL(databaseUrl);
  url.searchParams.set("application_name", applicationName);
  const client = new Client({ connectionString: url.toString() });
  clients.push(client);
  await client.connect();
  return client;
}

async function observeLockWait(applicationName: string): Promise<boolean> {
  const observerUrl = new URL(migrationUrl);
  observerUrl.searchParams.set("application_name", `slice2_observer_${shortRunId()}`);
  const observer = new Client({ connectionString: observerUrl.toString() });
  clients.push(observer);
  await observer.connect();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await observer.query(
      `SELECT 1
         FROM pg_stat_activity
        WHERE application_name = $1 AND wait_event_type = 'Lock'`,
      [applicationName],
    );
    if (result.rowCount === 1) return true;
    await delay(25);
  }
  return false;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function shortRunId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 12);
}

function settle<T>(
  promise: Promise<T>,
): Promise<
  | { readonly status: "fulfilled"; readonly value: T }
  | { readonly status: "rejected"; readonly reason: unknown }
> {
  return promise.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
}

function requireTestDatabaseUrl(variableName: string): string {
  const url = process.env[variableName];
  if (!url || process.env.ALLOW_DATABASE_INTEGRATION_TESTS !== "true") {
    throw new Error(
      `Database integration tests require ${variableName} and ALLOW_DATABASE_INTEGRATION_TESTS=true`,
    );
  }
  const databaseName = decodeURIComponent(new URL(url).pathname.slice(1));
  if (databaseName !== "geo_os_test") {
    throw new Error(
      `Database integration tests only run against geo_os_test; received ${databaseName || "no database name"}`,
    );
  }
  return url;
}
