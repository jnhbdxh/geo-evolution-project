DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geo_os_app') THEN
    CREATE ROLE geo_os_app
      LOGIN
      PASSWORD 'geo_os_app'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO geo_os_app', current_database());

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geo_os_outbox_dispatcher') THEN
    CREATE ROLE geo_os_outbox_dispatcher
      LOGIN
      PASSWORD 'geo_os_outbox_dispatcher'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS;
  END IF;
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO geo_os_outbox_dispatcher',
    current_database()
  );
END
$$;
