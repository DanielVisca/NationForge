-- Optional one-shot bootstrap for NationForge Postgres snapshot store.
-- The app also runs CREATE TABLE / seed on first use when DATABASE_URL is set.

CREATE TABLE IF NOT EXISTS nationforge_snapshot (
  id text PRIMARY KEY,
  payload jsonb NOT NULL
);

INSERT INTO nationforge_snapshot (id, payload)
VALUES (
  'sessions_v1',
  '{"sessions":{},"roomIndex":{}}'::jsonb
)
ON CONFLICT (id) DO NOTHING;
