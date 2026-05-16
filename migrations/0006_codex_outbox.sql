create table if not exists __SCHEMA__.codex_outbox (
  id uuid primary key,
  goal_id uuid references __SCHEMA__.goals(id) on delete set null,
  event_type text not null check (event_type in ('blocker', 'e2e_required', 'release_ready', 'user_notify')),
  severity text not null default 'info' check (severity in ('info', 'warning', 'error')),
  status text not null default 'pending' check (status in ('pending', 'acked', 'cancelled')),
  title text not null,
  summary text not null,
  payload_json jsonb not null default '{}',
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  acked_at timestamptz
);

create index if not exists codex_outbox_status_created_idx
  on __SCHEMA__.codex_outbox(status, created_at);

create index if not exists codex_outbox_goal_idx
  on __SCHEMA__.codex_outbox(goal_id, created_at);
