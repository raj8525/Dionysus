alter table __SCHEMA__.task_runs
  add column if not exists model_call_count integer,
  add column if not exists model_usage_json jsonb;
