-- Trusted Core-side Outbox dispatch needs cross-Tenant read/update access to delivery metadata.
-- The original Tenant policy remains intact; this context cannot authorize Outbox inserts.

CREATE POLICY outbox_dispatcher_select ON outbox_events
  FOR SELECT
  USING (current_setting('app.outbox_dispatcher_context', true) = 'true');

CREATE POLICY outbox_dispatcher_update ON outbox_events
  FOR UPDATE
  USING (current_setting('app.outbox_dispatcher_context', true) = 'true')
  WITH CHECK (current_setting('app.outbox_dispatcher_context', true) = 'true');
