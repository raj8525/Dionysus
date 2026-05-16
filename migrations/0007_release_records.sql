create table if not exists __SCHEMA__.release_records (
  id uuid primary key,
  goal_id uuid references __SCHEMA__.goals(id) on delete cascade,
  codex_outbox_event_id uuid references __SCHEMA__.codex_outbox(id) on delete set null,
  target_root text not null,
  branch text not null,
  commit_sha text not null,
  status text not null check (status in ('passed', 'failed', 'blocked')),
  pushed boolean not null default false,
  changed_files_json jsonb not null default '[]'::jsonb,
  verification_json jsonb not null default '[]'::jsonb,
  summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists release_records_goal_created_idx
  on __SCHEMA__.release_records(goal_id, created_at desc);

create unique index if not exists release_records_goal_commit_unique
  on __SCHEMA__.release_records(goal_id, commit_sha);
