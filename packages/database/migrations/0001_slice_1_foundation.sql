CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE TABLE user_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer text NOT NULL,
  subject text NOT NULL,
  email text,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEACTIVATED')),
  deactivated_at timestamptz,
  deactivation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject),
  CHECK ((status = 'DEACTIVATED') = (deactivated_at IS NOT NULL))
);

CREATE TABLE platform_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_identity_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('PLATFORM_ADMIN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  UNIQUE NULLS NOT DISTINCT (user_identity_id, role, deactivated_at)
);

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
  deactivated_at timestamptz,
  deactivation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'DEACTIVATED') = (deactivated_at IS NOT NULL))
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_identity_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEACTIVATED')),
  deactivated_at timestamptz,
  deactivation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_identity_id),
  UNIQUE (tenant_id, id),
  CHECK ((status = 'DEACTIVATED') = (deactivated_at IS NOT NULL))
);

CREATE TABLE tenant_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('TENANT_ADMIN', 'TENANT_MEMBER')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  UNIQUE NULLS NOT DISTINCT (tenant_id, membership_id, role, deactivated_at)
);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEACTIVATED')),
  deactivated_at timestamptz,
  deactivation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK ((status = 'DEACTIVATED') = (deactivated_at IS NOT NULL))
);

CREATE TABLE brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEACTIVATED')),
  deactivated_at timestamptz,
  deactivation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK ((status = 'DEACTIVATED') = (deactivated_at IS NOT NULL))
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEACTIVATED')),
  deactivated_at timestamptz,
  deactivation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK ((status = 'DEACTIVATED') = (deactivated_at IS NOT NULL))
);

CREATE TABLE policy_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEACTIVATED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE policy_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_definition_id uuid NOT NULL,
  version text NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'DEPRECATED')),
  manifest jsonb NOT NULL,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_definition_id, version),
  UNIQUE (policy_definition_id, id),
  CHECK ((status = 'DRAFT' AND published_at IS NULL) OR (status <> 'DRAFT' AND published_at IS NOT NULL))
);

CREATE TABLE industry_policy_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEACTIVATED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE industry_policy_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  industry_policy_definition_id uuid NOT NULL,
  version text NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'DEPRECATED')),
  manifest jsonb NOT NULL,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (industry_policy_definition_id, version),
  UNIQUE (industry_policy_definition_id, id),
  CHECK ((status = 'DRAFT' AND published_at IS NULL) OR (status <> 'DRAFT' AND published_at IS NOT NULL))
);

CREATE TABLE project_policy_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  policy_definition_id uuid NOT NULL,
  policy_release_id uuid NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  reason text NOT NULL,
  created_by_user_identity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE UNIQUE INDEX project_policy_bindings_one_current
  ON project_policy_bindings(tenant_id, project_id, policy_definition_id)
  WHERE effective_to IS NULL;

CREATE TABLE project_industry_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  industry_policy_definition_id uuid NOT NULL,
  industry_policy_release_id uuid NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  reason text NOT NULL,
  created_by_user_identity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE UNIQUE INDEX project_industry_bindings_one_current
  ON project_industry_bindings(tenant_id, project_id)
  WHERE effective_to IS NULL;

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  actor_user_identity_id uuid,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  reason text,
  trace_id uuid NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  payload jsonb NOT NULL,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  trace_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL))
);

CREATE OR REPLACE FUNCTION reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END
$$;

CREATE OR REPLACE FUNCTION protect_outbox_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'outbox_events cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'attempts', 'available_at', 'published_at'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'attempts', 'available_at', 'published_at']) THEN
    RAISE EXCEPTION 'outbox event identity, payload, headers, trace and occurrence time are immutable';
  END IF;
  IF OLD.status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'published outbox events are immutable';
  END IF;
  IF NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'outbox attempts cannot decrease';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION close_binding_interval_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'binding history cannot be deleted';
  END IF;
  IF OLD.effective_to IS NOT NULL THEN
    RAISE EXCEPTION 'closed binding history is immutable';
  END IF;
  IF NEW.effective_to IS NULL OR NEW.effective_to <= OLD.effective_from THEN
    RAISE EXCEPTION 'an open binding may only be closed with a later effective_to';
  END IF;
  IF (to_jsonb(NEW) - 'effective_to') IS DISTINCT FROM (to_jsonb(OLD) - 'effective_to') THEN
    RAISE EXCEPTION 'binding business fields are immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION protect_release_artifact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'release artifacts cannot be deleted';
  END IF;
  IF OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT', 'PUBLISHED') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'DRAFT' THEN
    RAISE EXCEPTION 'draft releases may only remain draft or become published';
  END IF;
  IF OLD.status = 'PUBLISHED'
     AND NEW.status = 'DEPRECATED'
     AND (to_jsonb(NEW) - 'status') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'published or deprecated release artifacts are immutable';
END
$$;

CREATE INDEX memberships_user_identity_idx ON memberships(user_identity_id, status);
CREATE INDEX brands_customer_idx ON brands(tenant_id, customer_id);
CREATE INDEX projects_brand_idx ON projects(tenant_id, brand_id);
CREATE INDEX audit_events_tenant_time_idx ON audit_events(tenant_id, occurred_at DESC);
CREATE INDEX outbox_events_pending_idx ON outbox_events(status, available_at) WHERE status IN ('PENDING', 'FAILED');

CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();
CREATE TRIGGER outbox_events_protected
  BEFORE UPDATE OR DELETE ON outbox_events
  FOR EACH ROW EXECUTE FUNCTION protect_outbox_event();
CREATE TRIGGER project_policy_bindings_close_only
  BEFORE UPDATE OR DELETE ON project_policy_bindings
  FOR EACH ROW EXECUTE FUNCTION close_binding_interval_only();
CREATE TRIGGER project_industry_bindings_close_only
  BEFORE UPDATE OR DELETE ON project_industry_bindings
  FOR EACH ROW EXECUTE FUNCTION close_binding_interval_only();
CREATE TRIGGER policy_releases_immutable_after_publish
  BEFORE UPDATE OR DELETE ON policy_releases
  FOR EACH ROW EXECUTE FUNCTION protect_release_artifact();
CREATE TRIGGER industry_policy_releases_immutable_after_publish
  BEFORE UPDATE OR DELETE ON industry_policy_releases
  FOR EACH ROW EXECUTE FUNCTION protect_release_artifact();

CREATE TRIGGER user_identities_set_updated_at BEFORE UPDATE ON user_identities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tenants_set_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER memberships_set_updated_at BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER customers_set_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER brands_set_updated_at BEFORE UPDATE ON brands
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER policy_definitions_set_updated_at BEFORE UPDATE ON policy_definitions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER industry_policy_definitions_set_updated_at BEFORE UPDATE ON industry_policy_definitions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO policy_definitions(id, code, name)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'GEO_OS_SYSTEM_BASE',
  'GEO OS System Base Policy'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO policy_releases(
  id,
  policy_definition_id,
  version,
  status,
  manifest,
  manifest_sha256,
  published_at
)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  '1.0.0',
  'PUBLISHED',
  '{"contract":"slice-1","evaluator":"system-base","schemaVersion":1}'::jsonb,
  encode(digest('{"contract":"slice-1","evaluator":"system-base","schemaVersion":1}', 'sha256'), 'hex'),
  now()
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_root_isolation ON tenants
  USING (id = current_tenant_id() OR current_setting('app.platform_context', true) = 'true')
  WITH CHECK (id = current_tenant_id() OR current_setting('app.platform_context', true) = 'true');

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'memberships',
    'tenant_role_assignments',
    'customers',
    'brands',
    'projects',
    'project_policy_bindings',
    'project_industry_bindings'
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

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_tenant_isolation ON audit_events
  USING (tenant_id = current_tenant_id() OR (tenant_id IS NULL AND current_setting('app.platform_context', true) = 'true'))
  WITH CHECK (tenant_id = current_tenant_id() OR (tenant_id IS NULL AND current_setting('app.platform_context', true) = 'true'));

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_tenant_isolation ON outbox_events
  USING (tenant_id = current_tenant_id() OR (tenant_id IS NULL AND current_setting('app.platform_context', true) = 'true'))
  WITH CHECK (tenant_id = current_tenant_id() OR (tenant_id IS NULL AND current_setting('app.platform_context', true) = 'true'));

GRANT USAGE ON SCHEMA public TO geo_os_app;
GRANT SELECT, INSERT, UPDATE ON
  user_identities,
  platform_role_assignments,
  tenants,
  memberships,
  tenant_role_assignments,
  customers,
  brands,
  projects
TO geo_os_app;
GRANT SELECT, INSERT ON project_policy_bindings, project_industry_bindings TO geo_os_app;
GRANT UPDATE (effective_to) ON project_policy_bindings, project_industry_bindings TO geo_os_app;
GRANT SELECT, INSERT ON audit_events TO geo_os_app;
GRANT SELECT, INSERT ON outbox_events TO geo_os_app;
GRANT UPDATE (status, attempts, available_at, published_at) ON outbox_events TO geo_os_app;
GRANT SELECT ON
  policy_definitions,
  policy_releases,
  industry_policy_definitions,
  industry_policy_releases
TO geo_os_app;
GRANT EXECUTE ON FUNCTION current_tenant_id() TO geo_os_app;
