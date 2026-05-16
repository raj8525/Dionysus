create table if not exists __SCHEMA__.gate_checks (
  id uuid primary key,
  goal_id uuid references __SCHEMA__.goals(id) on delete cascade,
  task_id uuid references __SCHEMA__.tasks(id) on delete cascade,
  gate_type text not null check (gate_type in ('plan', 'spec', 'test', 'implementation', 'integration', 'e2e')),
  status text not null check (status in ('passed', 'blocked', 'warning')),
  details_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists __SCHEMA__.workspace_locks (
  id uuid primary key,
  task_id uuid references __SCHEMA__.tasks(id) on delete cascade,
  lock_key text not null,
  owner text not null,
  status text not null default 'active' check (status in ('active', 'released', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspace_locks_active_unique
  on __SCHEMA__.workspace_locks(lock_key)
  where status = 'active';

create table if not exists __SCHEMA__.patches (
  id uuid primary key,
  task_id uuid references __SCHEMA__.tasks(id) on delete cascade,
  goal_id uuid references __SCHEMA__.goals(id) on delete cascade,
  patch_text text not null,
  changed_files_json jsonb not null default '[]',
  status text not null default 'created' check (status in ('created', 'queued', 'applied', 'rejected', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists __SCHEMA__.integration_queue (
  id uuid primary key,
  patch_id uuid references __SCHEMA__.patches(id) on delete cascade,
  goal_id uuid references __SCHEMA__.goals(id) on delete cascade,
  task_id uuid references __SCHEMA__.tasks(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'passed', 'failed', 'cancelled')),
  result_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
