alter table __SCHEMA__.e2e_cases
  add column if not exists result_json jsonb not null default '{}',
  add column if not exists executed_at timestamptz;
