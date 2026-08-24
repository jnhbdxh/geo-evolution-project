-- Replace the shared-session Dispatcher context with a role-bound database boundary.
-- Add bounded, sanitized delivery diagnostics without changing immutable event identity.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geo_os_outbox_dispatcher') THEN
    RAISE EXCEPTION
      'geo_os_outbox_dispatcher role must be provisioned before applying 0004';
  END IF;
END
$$;

ALTER TABLE outbox_events
  ADD COLUMN last_error_category text,
  ADD COLUMN last_error_code text,
  ADD COLUMN last_error_message text,
  ADD COLUMN last_failed_at timestamptz,
  ADD CONSTRAINT outbox_last_error_category_allowed
    CHECK (
      last_error_category IS NULL
      OR last_error_category IN ('VALIDATION', 'PUBLISH_TIMEOUT', 'PUBLISHER')
    ),
  ADD CONSTRAINT outbox_last_error_code_bounded
    CHECK (last_error_code IS NULL OR char_length(last_error_code) BETWEEN 1 AND 128),
  ADD CONSTRAINT outbox_last_error_message_bounded
    CHECK (last_error_message IS NULL OR char_length(last_error_message) BETWEEN 1 AND 512),
  ADD CONSTRAINT outbox_last_error_identity_complete
    CHECK (
      (last_error_category IS NULL)
      = (last_error_code IS NULL)
      AND (last_error_category IS NULL)
      = (last_failed_at IS NULL)
    );

DROP POLICY outbox_dispatcher_select ON outbox_events;
DROP POLICY outbox_dispatcher_update ON outbox_events;

CREATE POLICY outbox_dispatcher_select ON outbox_events
  FOR SELECT
  TO geo_os_outbox_dispatcher
  USING (true);

CREATE POLICY outbox_dispatcher_update ON outbox_events
  FOR UPDATE
  TO geo_os_outbox_dispatcher
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION protect_outbox_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'outbox_events cannot be deleted';
  END IF;
  IF (
    to_jsonb(NEW)
    - ARRAY[
        'status',
        'attempts',
        'available_at',
        'published_at',
        'last_error_category',
        'last_error_code',
        'last_error_message',
        'last_failed_at'
      ]
  ) IS DISTINCT FROM (
    to_jsonb(OLD)
    - ARRAY[
        'status',
        'attempts',
        'available_at',
        'published_at',
        'last_error_category',
        'last_error_code',
        'last_error_message',
        'last_failed_at'
      ]
  ) THEN
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

GRANT USAGE ON SCHEMA public TO geo_os_outbox_dispatcher;
REVOKE UPDATE (status, attempts, available_at, published_at)
  ON outbox_events
  FROM geo_os_app;
GRANT SELECT ON outbox_events TO geo_os_outbox_dispatcher;
GRANT UPDATE (
  status,
  attempts,
  available_at,
  published_at,
  last_error_category,
  last_error_code,
  last_error_message,
  last_failed_at
) ON outbox_events TO geo_os_outbox_dispatcher;
