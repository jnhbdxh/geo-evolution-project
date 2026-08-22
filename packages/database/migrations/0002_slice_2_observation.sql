CREATE TABLE demand_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEACTIVATED')),
  deactivated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, id),
  CHECK ((status = 'DEACTIVATED') = (deactivated_at IS NOT NULL))
);

CREATE TABLE questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  demand_theme_id uuid,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEACTIVATED')),
  deactivated_at timestamptz,
  created_by_user_identity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, id),
  CHECK ((status = 'DEACTIVATED') = (deactivated_at IS NOT NULL))
);

CREATE TABLE question_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  question_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'DEPRECATED')),
  prompt_text text NOT NULL CHECK (length(trim(prompt_text)) > 0),
  locale text NOT NULL DEFAULT 'zh-CN',
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parameters) = 'object'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  published_at timestamptz,
  created_by_user_identity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, id),
  UNIQUE (tenant_id, question_id, version),
  CHECK ((status = 'DRAFT' AND published_at IS NULL) OR (status <> 'DRAFT' AND published_at IS NOT NULL))
);

CREATE TABLE monitoring_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEACTIVATED')),
  deactivated_at timestamptz,
  created_by_user_identity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, id),
  CHECK ((status = 'DEACTIVATED') = (deactivated_at IS NOT NULL))
);

CREATE TABLE monitoring_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  monitoring_plan_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'DEPRECATED')),
  planned_platform text NOT NULL,
  planned_model text NOT NULL,
  planned_surface text NOT NULL,
  locale text NOT NULL DEFAULT 'zh-CN',
  region text,
  sampling_config jsonb NOT NULL CHECK (jsonb_typeof(sampling_config) = 'object'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  published_at timestamptz,
  created_by_user_identity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, id),
  UNIQUE (tenant_id, monitoring_plan_id, version),
  CHECK ((status = 'DRAFT' AND published_at IS NULL) OR (status <> 'DRAFT' AND published_at IS NOT NULL))
);

CREATE TABLE monitoring_plan_version_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  monitoring_plan_version_id uuid NOT NULL,
  question_version_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, id),
  UNIQUE (tenant_id, monitoring_plan_version_id, question_version_id),
  UNIQUE (tenant_id, monitoring_plan_version_id, ordinal)
);

CREATE TABLE sample_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  monitoring_plan_version_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 200),
  scheduled_for timestamptz NOT NULL,
  scheduled_by_user_identity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, idempotency_key)
);

CREATE TABLE sample_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  sample_batch_id uuid NOT NULL,
  question_version_id uuid NOT NULL,
  slot_key text NOT NULL CHECK (length(trim(slot_key)) BETWEEN 1 AND 200),
  planned_context jsonb NOT NULL CHECK (jsonb_typeof(planned_context) = 'object'),
  planned_for timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, id),
  UNIQUE (tenant_id, sample_batch_id, slot_key)
);

CREATE TABLE execution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  sample_slot_id uuid NOT NULL,
  question_version_id uuid NOT NULL,
  retry_of_execution_run_id uuid,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  idempotency_key text NOT NULL CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 200),
  operational_status text NOT NULL DEFAULT 'QUEUED'
    CHECK (operational_status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  response_outcome_kind text
    CHECK (response_outcome_kind IN (
      'ANSWER', 'PARTIAL_ANSWER', 'REFUSAL', 'PARTIAL_REFUSAL', 'NO_INFORMATION', 'OTHER_VISIBLE_RESPONSE'
    )),
  actual_platform text,
  actual_model text,
  actual_surface text,
  policy_release_id uuid NOT NULL,
  industry_policy_release_id uuid,
  execution_context_snapshot jsonb CHECK (jsonb_typeof(execution_context_snapshot) = 'object'),
  started_at timestamptz,
  completed_at timestamptz,
  operational_error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, id),
  UNIQUE (tenant_id, sample_slot_id, attempt_no),
  UNIQUE (tenant_id, project_id, idempotency_key),
  CHECK (
    (attempt_no = 1 AND retry_of_execution_run_id IS NULL)
    OR (attempt_no > 1 AND retry_of_execution_run_id IS NOT NULL)
  ),
  CHECK (
    (operational_status = 'QUEUED' AND started_at IS NULL AND completed_at IS NULL)
    OR (operational_status = 'RUNNING' AND started_at IS NOT NULL AND completed_at IS NULL)
    OR (operational_status IN ('COMPLETED', 'FAILED', 'CANCELLED') AND completed_at IS NOT NULL)
  ),
  CHECK (response_outcome_kind IS NULL OR started_at IS NOT NULL),
  CHECK (
    (started_at IS NULL
      AND actual_platform IS NULL
      AND actual_model IS NULL
      AND actual_surface IS NULL
      AND execution_context_snapshot IS NULL)
    OR
    (started_at IS NOT NULL
      AND actual_platform IS NOT NULL
      AND actual_model IS NOT NULL
      AND actual_surface IS NOT NULL
      AND execution_context_snapshot IS NOT NULL)
  ),
  CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);

CREATE TABLE capture_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  execution_run_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 200),
  artifact_kind text NOT NULL CHECK (artifact_kind IN ('RAW_RESPONSE', 'SCREENSHOT', 'STRUCTURED_RESPONSE', 'TRACE')),
  storage_bucket text NOT NULL CHECK (length(trim(storage_bucket)) > 0),
  storage_key text NOT NULL CHECK (length(trim(storage_key)) > 0),
  media_type text NOT NULL CHECK (length(trim(media_type)) > 0),
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, id),
  UNIQUE (tenant_id, execution_run_id, idempotency_key),
  UNIQUE (tenant_id, storage_bucket, storage_key)
);

CREATE TABLE observation_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  execution_run_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'CAPTURING'
    CHECK (status IN ('CAPTURING', 'FINALIZING', 'FINALIZED')),
  representation text NOT NULL CHECK (representation IN ('TEXT', 'STRUCTURED', 'MIXED')),
  correlation_status text NOT NULL CHECK (correlation_status IN ('CONFIRMED', 'PROBABLE', 'UNCERTAIN')),
  target_surface_reached boolean NOT NULL CHECK (target_surface_reached),
  target_question_submitted boolean NOT NULL CHECK (target_question_submitted),
  visible_response_outcome_observed boolean NOT NULL CHECK (visible_response_outcome_observed),
  lifecycle_associated boolean NOT NULL CHECK (lifecycle_associated),
  existence_basis jsonb NOT NULL CHECK (
    jsonb_typeof(existence_basis) = 'object'
    AND existence_basis ? 'kind'
    AND existence_basis ? 'questionSubmittedAt'
    AND existence_basis ? 'detectorVersion'
    AND jsonb_typeof(existence_basis->'kind') = 'string'
    AND jsonb_typeof(existence_basis->'questionSubmittedAt') = 'string'
    AND jsonb_typeof(existence_basis->'detectorVersion') = 'string'
    AND existence_basis->>'kind' IN (
      'VISIBLE_TEXT_RESPONSE', 'VISIBLE_STRUCTURED_RESPONSE', 'VISIBLE_REFUSAL',
      'VISIBLE_NO_INFORMATION', 'VISIBLE_PARTIAL_RESPONSE', 'OTHER_VISIBLE_RESPONSE'
    )
    AND length(trim(existence_basis->>'questionSubmittedAt')) > 0
    AND length(trim(existence_basis->>'detectorVersion')) BETWEEN 1 AND 100
  ),
  response_started_at timestamptz NOT NULL,
  response_last_seen_at timestamptz NOT NULL,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, id),
  UNIQUE (tenant_id, execution_run_id),
  CHECK (response_last_seen_at >= response_started_at),
  CHECK ((status = 'FINALIZED') = (finalized_at IS NOT NULL))
);

CREATE TABLE raw_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  observation_candidate_id uuid NOT NULL,
  execution_run_id uuid NOT NULL,
  question_version_id uuid NOT NULL,
  representation text NOT NULL CHECK (representation IN ('TEXT', 'STRUCTURED', 'MIXED')),
  raw_answer_text text,
  raw_answer_artifact_id uuid,
  raw_answer_sha256 text NOT NULL CHECK (raw_answer_sha256 ~ '^[0-9a-f]{64}$'),
  capture_manifest jsonb NOT NULL CHECK (jsonb_typeof(capture_manifest) = 'object'),
  capture_hash text NOT NULL CHECK (capture_hash ~ '^[0-9a-f]{64}$'),
  execution_context_snapshot jsonb NOT NULL CHECK (jsonb_typeof(execution_context_snapshot) = 'object'),
  response_started_at timestamptz NOT NULL,
  response_last_seen_at timestamptz NOT NULL,
  raw_observation_version integer NOT NULL DEFAULT 1 CHECK (raw_observation_version > 0),
  finalized_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, id),
  UNIQUE (tenant_id, observation_candidate_id),
  UNIQUE (tenant_id, execution_run_id),
  CHECK (raw_answer_text IS NOT NULL OR raw_answer_artifact_id IS NOT NULL),
  CHECK (response_last_seen_at >= response_started_at)
);

CREATE TABLE correction_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  raw_observation_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  replacement_projection jsonb NOT NULL CHECK (jsonb_typeof(replacement_projection) = 'object'),
  created_by_user_identity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, id)
);

CREATE OR REPLACE FUNCTION canonical_jsonb_sha256(value jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT encode(digest(convert_to(value::text, 'UTF8'), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION question_version_content_sha256(
  prompt_text text,
  locale text,
  parameters jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT canonical_jsonb_sha256(
    jsonb_build_object(
      'schema_version', 1,
      'prompt_text', prompt_text,
      'locale', locale,
      'parameters', parameters
    )
  )
$$;

CREATE OR REPLACE FUNCTION monitoring_plan_version_content_sha256(release_id uuid)
RETURNS text
LANGUAGE sql
STABLE
STRICT
AS $$
  SELECT canonical_jsonb_sha256(
    jsonb_build_object(
      'schema_version', 1,
      'planned_platform', mpv.planned_platform,
      'planned_model', mpv.planned_model,
      'planned_surface', mpv.planned_surface,
      'locale', mpv.locale,
      'region', mpv.region,
      'sampling_config', mpv.sampling_config,
      'question_version_ids', COALESCE(
        (
          SELECT jsonb_agg(mpvq.question_version_id::text ORDER BY mpvq.ordinal)
            FROM monitoring_plan_version_questions mpvq
           WHERE mpvq.monitoring_plan_version_id = mpv.id
        ),
        '[]'::jsonb
      )
    )
  )
    FROM monitoring_plan_versions mpv
   WHERE mpv.id = release_id
$$;

CREATE OR REPLACE FUNCTION validate_question_version_content_hash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.content_sha256 <> question_version_content_sha256(
    NEW.prompt_text,
    NEW.locale,
    NEW.parameters
  ) THEN
    RAISE EXCEPTION 'QuestionVersion content SHA-256 mismatch';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION protect_plan_question_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_id uuid;
  parent_status text;
  question_status text;
BEGIN
  parent_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.monitoring_plan_version_id
    ELSE NEW.monitoring_plan_version_id
  END;
  SELECT status INTO parent_status
    FROM monitoring_plan_versions
   WHERE id = parent_id
   FOR UPDATE;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'plan question membership is immutable after parent publication';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT status INTO question_status
      FROM question_versions
     WHERE id = NEW.question_version_id;
    IF question_status IS DISTINCT FROM 'PUBLISHED' THEN
      RAISE EXCEPTION 'MonitoringPlanVersion may only include a published QuestionVersion';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END
$$;

CREATE OR REPLACE FUNCTION require_draft_release_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'DRAFT' OR NEW.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'release artifacts must be inserted as DRAFT and published by state transition';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION protect_monitoring_plan_release()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'release artifacts cannot be deleted';
  END IF;
  IF OLD.status = 'DRAFT' AND NEW.status = 'PUBLISHED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM monitoring_plan_version_questions
       WHERE monitoring_plan_version_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'a MonitoringPlanVersion requires at least one QuestionVersion before publication';
    END IF;
    IF NEW.content_sha256 <> monitoring_plan_version_content_sha256(OLD.id) THEN
      RAISE EXCEPTION 'MonitoringPlanVersion content SHA-256 mismatch';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'DRAFT' AND NEW.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'PUBLISHED'
     AND NEW.status = 'DEPRECATED'
     AND (to_jsonb(NEW) - 'status') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'published or deprecated MonitoringPlanVersion is immutable';
END
$$;

CREATE OR REPLACE FUNCTION protect_execution_run()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ExecutionRun cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - ARRAY[
        'operational_status', 'response_outcome_kind', 'actual_platform', 'actual_model',
        'actual_surface', 'execution_context_snapshot', 'started_at', 'completed_at', 'operational_error'
      ])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY[
        'operational_status', 'response_outcome_kind', 'actual_platform', 'actual_model',
        'actual_surface', 'execution_context_snapshot', 'started_at', 'completed_at', 'operational_error'
      ]) THEN
    RAISE EXCEPTION 'ExecutionRun identity and assigned releases are immutable';
  END IF;
  IF ROW(NEW.actual_platform, NEW.actual_model, NEW.actual_surface, NEW.execution_context_snapshot)
       IS DISTINCT FROM
     ROW(OLD.actual_platform, OLD.actual_model, OLD.actual_surface, OLD.execution_context_snapshot)
     AND NOT (
       OLD.operational_status = 'QUEUED'
       AND NEW.operational_status = 'RUNNING'
       AND OLD.actual_platform IS NULL
       AND OLD.actual_model IS NULL
       AND OLD.actual_surface IS NULL
       AND OLD.execution_context_snapshot IS NULL
       AND NEW.actual_platform IS NOT NULL
       AND NEW.actual_model IS NOT NULL
       AND NEW.actual_surface IS NOT NULL
       AND NEW.execution_context_snapshot IS NOT NULL
       AND NEW.started_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'actual execution context can only be written once when ExecutionRun starts';
  END IF;
  IF OLD.response_outcome_kind IS NOT NULL
     AND NEW.response_outcome_kind IS DISTINCT FROM OLD.response_outcome_kind THEN
    RAISE EXCEPTION 'visible response outcome cannot be replaced or cleared';
  END IF;
  IF NOT (
    (OLD.operational_status = 'QUEUED' AND NEW.operational_status IN ('QUEUED', 'RUNNING', 'FAILED', 'CANCELLED'))
    OR (OLD.operational_status = 'RUNNING' AND NEW.operational_status IN ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'))
    OR (OLD.operational_status = NEW.operational_status AND OLD.operational_status IN ('COMPLETED', 'FAILED', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'invalid ExecutionRun state transition';
  END IF;
  IF NEW.completed_at IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM observation_candidates
       WHERE tenant_id = NEW.tenant_id
         AND project_id = NEW.project_id
         AND execution_run_id = NEW.id
         AND response_last_seen_at > NEW.completed_at
    )
    OR EXISTS (
      SELECT 1 FROM raw_observations
       WHERE tenant_id = NEW.tenant_id
         AND project_id = NEW.project_id
         AND execution_run_id = NEW.id
         AND response_last_seen_at > NEW.completed_at
    )
  ) THEN
    RAISE EXCEPTION 'ExecutionRun completion cannot precede its observed response lifecycle';
  END IF;
  IF OLD.operational_status IN ('COMPLETED', 'FAILED', 'CANCELLED')
     AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'terminal ExecutionRun is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION validate_sample_batch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  release_status text;
BEGIN
  SELECT status INTO release_status
    FROM monitoring_plan_versions
   WHERE tenant_id = NEW.tenant_id
     AND project_id = NEW.project_id
     AND id = NEW.monitoring_plan_version_id;
  IF release_status IS DISTINCT FROM 'PUBLISHED' THEN
    RAISE EXCEPTION 'SampleBatch requires a published MonitoringPlanVersion';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION validate_sample_slot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  plan_version_id uuid;
BEGIN
  SELECT monitoring_plan_version_id INTO plan_version_id
    FROM sample_batches
   WHERE tenant_id = NEW.tenant_id
     AND project_id = NEW.project_id
     AND id = NEW.sample_batch_id;
  IF NOT EXISTS (
    SELECT 1
      FROM monitoring_plan_version_questions
     WHERE tenant_id = NEW.tenant_id
       AND project_id = NEW.project_id
       AND monitoring_plan_version_id = plan_version_id
       AND question_version_id = NEW.question_version_id
  ) THEN
    RAISE EXCEPTION 'SampleSlot QuestionVersion must be a member of its MonitoringPlanVersion';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION validate_execution_run_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  slot_question_version_id uuid;
  prior_slot_id uuid;
  prior_attempt_no integer;
  policy_status text;
  industry_status text;
BEGIN
  IF NEW.operational_status <> 'QUEUED'
     OR NEW.response_outcome_kind IS NOT NULL
     OR NEW.actual_platform IS NOT NULL
     OR NEW.actual_model IS NOT NULL
     OR NEW.actual_surface IS NOT NULL
     OR NEW.execution_context_snapshot IS NOT NULL
     OR NEW.started_at IS NOT NULL
     OR NEW.completed_at IS NOT NULL
     OR NEW.operational_error IS NOT NULL THEN
    RAISE EXCEPTION 'ExecutionRun must be inserted in a clean QUEUED state';
  END IF;
  SELECT question_version_id INTO slot_question_version_id
    FROM sample_slots
   WHERE tenant_id = NEW.tenant_id
     AND project_id = NEW.project_id
     AND id = NEW.sample_slot_id;
  IF slot_question_version_id IS DISTINCT FROM NEW.question_version_id THEN
    RAISE EXCEPTION 'ExecutionRun QuestionVersion must match SampleSlot';
  END IF;
  SELECT status INTO policy_status FROM policy_releases WHERE id = NEW.policy_release_id;
  IF policy_status IS DISTINCT FROM 'PUBLISHED' THEN
    RAISE EXCEPTION 'ExecutionRun requires an actual published PolicyRelease';
  END IF;
  IF NEW.industry_policy_release_id IS NOT NULL THEN
    SELECT status INTO industry_status
      FROM industry_policy_releases WHERE id = NEW.industry_policy_release_id;
    IF industry_status IS DISTINCT FROM 'PUBLISHED' THEN
      RAISE EXCEPTION 'ExecutionRun requires an actual published IndustryPolicyRelease';
    END IF;
  END IF;
  IF NEW.retry_of_execution_run_id IS NOT NULL THEN
    SELECT sample_slot_id, attempt_no INTO prior_slot_id, prior_attempt_no
      FROM execution_runs
     WHERE tenant_id = NEW.tenant_id
       AND project_id = NEW.project_id
       AND id = NEW.retry_of_execution_run_id;
    IF prior_slot_id IS DISTINCT FROM NEW.sample_slot_id OR NEW.attempt_no <> prior_attempt_no + 1 THEN
      RAISE EXCEPTION 'retry must reference the immediately preceding ExecutionRun in the same SampleSlot';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION validate_observation_candidate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  response_kind text;
  execution_started_at timestamptz;
  execution_completed_at timestamptz;
  actual_platform_value text;
  actual_surface_value text;
  planned_platform_value text;
  planned_surface_value text;
  project_status_value text;
  plan_status_value text;
  question_submitted_at_value timestamptz;
  basis_kind text;
BEGIN
  IF NEW.status <> 'CAPTURING' OR NEW.finalized_at IS NOT NULL THEN
    RAISE EXCEPTION 'ObservationCandidate must be inserted in CAPTURING state';
  END IF;
  SELECT er.response_outcome_kind,
         er.started_at,
         er.completed_at,
         er.actual_platform,
         er.actual_surface,
         mpv.planned_platform,
         mpv.planned_surface,
         p.status,
         mpv.status
    INTO response_kind,
         execution_started_at,
         execution_completed_at,
         actual_platform_value,
         actual_surface_value,
         planned_platform_value,
         planned_surface_value,
         project_status_value,
         plan_status_value
    FROM execution_runs er
    JOIN projects p
      ON p.tenant_id = er.tenant_id AND p.id = er.project_id
    JOIN sample_slots ss
      ON ss.tenant_id = er.tenant_id
     AND ss.project_id = er.project_id
     AND ss.id = er.sample_slot_id
     AND ss.question_version_id = er.question_version_id
    JOIN sample_batches sb
      ON sb.tenant_id = ss.tenant_id
     AND sb.project_id = ss.project_id
     AND sb.id = ss.sample_batch_id
    JOIN monitoring_plan_versions mpv
      ON mpv.tenant_id = sb.tenant_id
     AND mpv.project_id = sb.project_id
     AND mpv.id = sb.monitoring_plan_version_id
   WHERE er.tenant_id = NEW.tenant_id
     AND er.project_id = NEW.project_id
     AND er.id = NEW.execution_run_id;
  IF response_kind IS NULL THEN
    RAISE EXCEPTION 'ObservationCandidate requires an explicit visible response outcome';
  END IF;
  IF execution_started_at IS NULL THEN
    RAISE EXCEPTION 'ObservationCandidate requires a started ExecutionRun';
  END IF;
  IF project_status_value IS DISTINCT FROM 'ACTIVE'
     OR plan_status_value NOT IN ('PUBLISHED', 'DEPRECATED') THEN
    RAISE EXCEPTION 'ObservationCandidate requires an active Project and released plan';
  END IF;
  IF ROW(actual_platform_value, actual_surface_value)
       IS DISTINCT FROM
     ROW(planned_platform_value, planned_surface_value) THEN
    RAISE EXCEPTION 'ObservationCandidate execution target does not match its planned target';
  END IF;

  question_submitted_at_value := (NEW.existence_basis->>'questionSubmittedAt')::timestamptz;
  IF question_submitted_at_value < execution_started_at
     OR NEW.response_started_at < question_submitted_at_value
     OR (execution_completed_at IS NOT NULL AND NEW.response_last_seen_at > execution_completed_at) THEN
    RAISE EXCEPTION 'ObservationCandidate response timeline is outside its ExecutionRun lifecycle';
  END IF;

  basis_kind := NEW.existence_basis->>'kind';
  IF NOT (
    (response_kind = 'ANSWER' AND basis_kind IN ('VISIBLE_TEXT_RESPONSE', 'VISIBLE_STRUCTURED_RESPONSE'))
    OR (response_kind IN ('PARTIAL_ANSWER', 'PARTIAL_REFUSAL') AND basis_kind = 'VISIBLE_PARTIAL_RESPONSE')
    OR (response_kind = 'REFUSAL' AND basis_kind = 'VISIBLE_REFUSAL')
    OR (response_kind = 'NO_INFORMATION' AND basis_kind = 'VISIBLE_NO_INFORMATION')
    OR (response_kind = 'OTHER_VISIBLE_RESPONSE' AND basis_kind = 'OTHER_VISIBLE_RESPONSE')
  ) THEN
    RAISE EXCEPTION 'ObservationCandidate existence basis does not match response outcome';
  END IF;
  IF (basis_kind = 'VISIBLE_STRUCTURED_RESPONSE' AND NEW.representation = 'TEXT')
     OR (basis_kind = 'VISIBLE_TEXT_RESPONSE' AND NEW.representation = 'STRUCTURED') THEN
    RAISE EXCEPTION 'ObservationCandidate representation does not match existence basis';
  END IF;
  IF NEW.existence_basis ? 'evidenceArtifactIds' AND EXISTS (
    SELECT 1
      FROM jsonb_array_elements_text(NEW.existence_basis->'evidenceArtifactIds') artifact_id(value)
     WHERE NOT EXISTS (
       SELECT 1
         FROM capture_artifacts ca
        WHERE ca.tenant_id = NEW.tenant_id
          AND ca.project_id = NEW.project_id
          AND ca.execution_run_id = NEW.execution_run_id
          AND ca.id = artifact_id.value::uuid
     )
  ) THEN
    RAISE EXCEPTION 'ObservationCandidate evidence artifact is outside its ExecutionRun';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION protect_observation_candidate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ObservationCandidate cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'finalized_at'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'finalized_at']) THEN
    RAISE EXCEPTION 'ObservationCandidate existence evidence is immutable';
  END IF;
  IF NOT (
    (OLD.status = 'CAPTURING' AND NEW.status IN ('CAPTURING', 'FINALIZING'))
    OR (OLD.status = 'FINALIZING' AND NEW.status IN ('FINALIZING', 'FINALIZED'))
    OR (OLD.status = 'FINALIZED' AND NEW.status = 'FINALIZED')
  ) THEN
    RAISE EXCEPTION 'invalid ObservationCandidate state transition';
  END IF;
  IF OLD.status = 'FINALIZED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'finalized ObservationCandidate is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION require_candidate_observation_at_commit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('FINALIZING', 'FINALIZED') AND NOT EXISTS (
    SELECT 1 FROM raw_observations
     WHERE tenant_id = NEW.tenant_id AND observation_candidate_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'finalizing or finalized Candidate requires its RawObservation in the same transaction';
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION validate_raw_observation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_row observation_candidates%ROWTYPE;
  execution_question_version_id uuid;
  execution_context_value jsonb;
  execution_operational_status text;
  execution_started_at timestamptz;
  execution_completed_at timestamptz;
  artifact_execution_run_id uuid;
  artifact_tenant_id uuid;
  artifact_project_id uuid;
  artifact_kind text;
  artifact_sha256 text;
  manifest_artifact_id text;
  manifest_artifact_count integer;
  manifest_distinct_artifact_count integer;
BEGIN
  SELECT * INTO candidate_row
    FROM observation_candidates
   WHERE tenant_id = NEW.tenant_id
     AND project_id = NEW.project_id
     AND id = NEW.observation_candidate_id
   FOR UPDATE;
  IF candidate_row.id IS NULL THEN
    RAISE EXCEPTION 'RawObservation Candidate was not found in its Tenant and Project';
  END IF;
  IF candidate_row.status NOT IN ('FINALIZING', 'FINALIZED') THEN
    RAISE EXCEPTION 'RawObservation requires a FINALIZING Candidate';
  END IF;
  IF candidate_row.execution_run_id <> NEW.execution_run_id
     OR candidate_row.response_started_at <> NEW.response_started_at THEN
    RAISE EXCEPTION 'RawObservation must preserve Candidate identity and response start';
  END IF;
  IF (candidate_row.representation = 'TEXT' AND NEW.representation NOT IN ('TEXT', 'MIXED'))
     OR (candidate_row.representation = 'STRUCTURED' AND NEW.representation NOT IN ('STRUCTURED', 'MIXED'))
     OR (candidate_row.representation = 'MIXED' AND NEW.representation <> 'MIXED') THEN
    RAISE EXCEPTION 'final representation cannot discard the Candidate first-detection form';
  END IF;
  IF NEW.response_last_seen_at < candidate_row.response_last_seen_at THEN
    RAISE EXCEPTION 'RawObservation response window cannot end before Candidate detection';
  END IF;

  SELECT question_version_id,
         execution_context_snapshot,
         operational_status,
         started_at,
         completed_at
    INTO execution_question_version_id,
         execution_context_value,
         execution_operational_status,
         execution_started_at,
         execution_completed_at
    FROM execution_runs
   WHERE tenant_id = NEW.tenant_id
     AND project_id = NEW.project_id
     AND id = NEW.execution_run_id;
  IF execution_question_version_id IS NULL THEN
    RAISE EXCEPTION 'RawObservation ExecutionRun was not found in its Tenant and Project';
  END IF;
  IF execution_question_version_id IS DISTINCT FROM NEW.question_version_id THEN
    RAISE EXCEPTION 'RawObservation QuestionVersion must match ExecutionRun';
  END IF;
  IF execution_context_value IS NULL
     OR execution_context_value IS DISTINCT FROM NEW.execution_context_snapshot THEN
    RAISE EXCEPTION 'RawObservation execution context must match the actual ExecutionRun context';
  END IF;
  IF execution_operational_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
     OR execution_completed_at IS NULL THEN
    RAISE EXCEPTION 'RawObservation requires a terminal ExecutionRun';
  END IF;
  IF NEW.response_started_at < execution_started_at
     OR NEW.response_last_seen_at > execution_completed_at THEN
    RAISE EXCEPTION 'RawObservation response timeline is outside its ExecutionRun lifecycle';
  END IF;
  IF NEW.raw_observation_version <> 1 THEN
    RAISE EXCEPTION 'RawObservation schema version 1 is required';
  END IF;
  IF NEW.raw_answer_artifact_id IS NOT NULL THEN
    SELECT tenant_id, project_id, execution_run_id, capture_artifacts.artifact_kind, sha256
      INTO artifact_tenant_id, artifact_project_id, artifact_execution_run_id,
           artifact_kind, artifact_sha256
      FROM capture_artifacts
     WHERE tenant_id = NEW.tenant_id
       AND project_id = NEW.project_id
       AND id = NEW.raw_answer_artifact_id;
    IF ROW(artifact_tenant_id, artifact_project_id, artifact_execution_run_id)
         IS DISTINCT FROM
       ROW(NEW.tenant_id, NEW.project_id, NEW.execution_run_id) THEN
      RAISE EXCEPTION 'raw answer artifact must belong to the same ExecutionRun';
    END IF;
    IF artifact_kind NOT IN ('RAW_RESPONSE', 'STRUCTURED_RESPONSE') THEN
      RAISE EXCEPTION 'raw answer artifact must contain response bytes';
    END IF;
    IF artifact_sha256 IS DISTINCT FROM NEW.raw_answer_sha256 THEN
      RAISE EXCEPTION 'raw answer artifact SHA-256 mismatch';
    END IF;
  END IF;
  IF NEW.raw_answer_text IS NOT NULL
     AND encode(digest(convert_to(NEW.raw_answer_text, 'UTF8'), 'sha256'), 'hex') <> NEW.raw_answer_sha256 THEN
    RAISE EXCEPTION 'raw answer text SHA-256 mismatch';
  END IF;
  IF NEW.capture_manifest->>'schema_version' IS DISTINCT FROM '1'
     OR jsonb_typeof(NEW.capture_manifest->'artifact_ids') IS DISTINCT FROM 'array'
     OR (SELECT count(*) FROM jsonb_object_keys(NEW.capture_manifest)) <> 2 THEN
    RAISE EXCEPTION 'capture manifest must use schema_version 1 and an artifact_ids array';
  END IF;
  SELECT count(*), count(DISTINCT value)
    INTO manifest_artifact_count, manifest_distinct_artifact_count
    FROM jsonb_array_elements_text(NEW.capture_manifest->'artifact_ids') artifact_id(value);
  IF manifest_artifact_count <> manifest_distinct_artifact_count THEN
    RAISE EXCEPTION 'capture manifest artifact IDs must be unique';
  END IF;
  FOR manifest_artifact_id IN
    SELECT jsonb_array_elements_text(NEW.capture_manifest->'artifact_ids')
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM capture_artifacts
       WHERE id = manifest_artifact_id::uuid
         AND tenant_id = NEW.tenant_id
         AND project_id = NEW.project_id
         AND execution_run_id = NEW.execution_run_id
    ) THEN
      RAISE EXCEPTION 'capture manifest contains an artifact outside the ExecutionRun';
    END IF;
  END LOOP;
  IF NEW.raw_answer_artifact_id IS NOT NULL AND NOT (
    NEW.capture_manifest->'artifact_ids' @> jsonb_build_array(NEW.raw_answer_artifact_id::text)
  ) THEN
    RAISE EXCEPTION 'capture manifest must include the raw answer artifact';
  END IF;
  IF NEW.capture_hash <> canonical_jsonb_sha256(NEW.capture_manifest) THEN
    RAISE EXCEPTION 'capture manifest SHA-256 mismatch';
  END IF;
  NEW.finalized_at := clock_timestamp();
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION reject_immutable_observation_fact_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only and immutable', TG_TABLE_NAME;
END
$$;

CREATE TRIGGER question_versions_validate_content_hash
  BEFORE INSERT OR UPDATE ON question_versions
  FOR EACH ROW EXECUTE FUNCTION validate_question_version_content_hash();
CREATE TRIGGER question_versions_start_as_draft
  BEFORE INSERT ON question_versions
  FOR EACH ROW EXECUTE FUNCTION require_draft_release_insert();
CREATE TRIGGER question_versions_immutable_after_publish
  BEFORE UPDATE OR DELETE ON question_versions
  FOR EACH ROW EXECUTE FUNCTION protect_release_artifact();
CREATE TRIGGER monitoring_plan_versions_start_as_draft
  BEFORE INSERT ON monitoring_plan_versions
  FOR EACH ROW EXECUTE FUNCTION require_draft_release_insert();
CREATE TRIGGER monitoring_plan_versions_immutable_after_publish
  BEFORE UPDATE OR DELETE ON monitoring_plan_versions
  FOR EACH ROW EXECUTE FUNCTION protect_monitoring_plan_release();
CREATE TRIGGER monitoring_plan_membership_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON monitoring_plan_version_questions
  FOR EACH ROW EXECUTE FUNCTION protect_plan_question_membership();
CREATE TRIGGER sample_batches_require_published_plan
  BEFORE INSERT ON sample_batches
  FOR EACH ROW EXECUTE FUNCTION validate_sample_batch();
CREATE TRIGGER sample_slots_require_plan_membership
  BEFORE INSERT ON sample_slots
  FOR EACH ROW EXECUTE FUNCTION validate_sample_slot();
CREATE TRIGGER execution_runs_validate_actual_context
  BEFORE INSERT ON execution_runs
  FOR EACH ROW EXECUTE FUNCTION validate_execution_run_insert();
CREATE TRIGGER execution_runs_protected
  BEFORE UPDATE OR DELETE ON execution_runs
  FOR EACH ROW EXECUTE FUNCTION protect_execution_run();
CREATE TRIGGER observation_candidate_requires_response
  BEFORE INSERT ON observation_candidates
  FOR EACH ROW EXECUTE FUNCTION validate_observation_candidate();
CREATE TRIGGER observation_candidates_protected
  BEFORE UPDATE OR DELETE ON observation_candidates
  FOR EACH ROW EXECUTE FUNCTION protect_observation_candidate();
CREATE CONSTRAINT TRIGGER observation_candidate_requires_raw_observation
  AFTER INSERT OR UPDATE ON observation_candidates
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION require_candidate_observation_at_commit();
CREATE TRIGGER raw_observations_validated
  BEFORE INSERT ON raw_observations
  FOR EACH ROW EXECUTE FUNCTION validate_raw_observation();
CREATE TRIGGER raw_observations_immutable
  BEFORE UPDATE OR DELETE ON raw_observations
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_observation_fact_mutation();
CREATE TRIGGER capture_artifacts_immutable
  BEFORE UPDATE OR DELETE ON capture_artifacts
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_observation_fact_mutation();
CREATE TRIGGER correction_records_immutable
  BEFORE UPDATE OR DELETE ON correction_records
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_observation_fact_mutation();

CREATE TRIGGER demand_themes_set_updated_at BEFORE UPDATE ON demand_themes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER questions_set_updated_at BEFORE UPDATE ON questions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER monitoring_plans_set_updated_at BEFORE UPDATE ON monitoring_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX questions_project_idx ON questions(tenant_id, project_id, status);
CREATE INDEX question_versions_question_idx ON question_versions(tenant_id, question_id, version DESC);
CREATE INDEX monitoring_plan_versions_plan_idx ON monitoring_plan_versions(tenant_id, monitoring_plan_id, version DESC);
CREATE INDEX sample_batches_plan_idx ON sample_batches(tenant_id, monitoring_plan_version_id, scheduled_for DESC);
CREATE INDEX sample_slots_batch_idx ON sample_slots(tenant_id, sample_batch_id, planned_for);
CREATE INDEX execution_runs_slot_idx ON execution_runs(tenant_id, sample_slot_id, attempt_no);
CREATE INDEX capture_artifacts_execution_idx ON capture_artifacts(tenant_id, execution_run_id, captured_at);
CREATE INDEX raw_observations_project_time_idx ON raw_observations(tenant_id, project_id, finalized_at DESC);
CREATE INDEX correction_records_observation_idx ON correction_records(tenant_id, raw_observation_id, created_at);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'demand_themes',
    'questions',
    'question_versions',
    'monitoring_plans',
    'monitoring_plan_versions',
    'monitoring_plan_version_questions',
    'sample_batches',
    'sample_slots',
    'execution_runs',
    'capture_artifacts',
    'observation_candidates',
    'raw_observations',
    'correction_records'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      table_name
    );
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE ON
  demand_themes,
  questions,
  monitoring_plans
TO geo_os_app;
GRANT SELECT, INSERT, UPDATE ON question_versions, monitoring_plan_versions TO geo_os_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON monitoring_plan_version_questions TO geo_os_app;
GRANT SELECT, INSERT ON sample_batches, sample_slots TO geo_os_app;
GRANT SELECT, INSERT ON execution_runs TO geo_os_app;
GRANT UPDATE (
  operational_status,
  response_outcome_kind,
  actual_platform,
  actual_model,
  actual_surface,
  execution_context_snapshot,
  started_at,
  completed_at,
  operational_error
)
  ON execution_runs TO geo_os_app;
GRANT SELECT, INSERT ON capture_artifacts TO geo_os_app;
GRANT SELECT, INSERT ON observation_candidates TO geo_os_app;
GRANT UPDATE (status, finalized_at) ON observation_candidates TO geo_os_app;
GRANT SELECT, INSERT ON raw_observations, correction_records TO geo_os_app;
GRANT EXECUTE ON FUNCTION canonical_jsonb_sha256(jsonb) TO geo_os_app;
GRANT EXECUTE ON FUNCTION question_version_content_sha256(text, text, jsonb) TO geo_os_app;
GRANT EXECUTE ON FUNCTION monitoring_plan_version_content_sha256(uuid) TO geo_os_app;
