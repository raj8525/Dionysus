alter table __SCHEMA__.patches
  add column if not exists allowed_files_json jsonb not null default '[]'::jsonb;
