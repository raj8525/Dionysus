create schema if not exists __SCHEMA__;

create table if not exists __SCHEMA__.agents (
  id uuid primary key,
  name text not null,
  role text not null check (role in ('master', 'rule_writer', 'test_writer', 'worker')),
  status text not null default 'idle' check (status in ('idle', 'working', 'blocked', 'disabled')),
  cli_type text not null default 'mock' check (cli_type in ('mock', 'claude_code', 'gemini_cli', 'opencode')),
  cli_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists __SCHEMA__.goals (
  id uuid primary key,
  title text not null,
  description text not null,
  target_root text not null,
  status text not null default 'created' check (
    status in (
      'created',
      'intake',
      'planning',
      'plan_review',
      'spec_phase',
      'test_phase',
      'implementation_phase',
      'integration_review',
      'codex_review',
      'done',
      'blocked',
      'failed',
      'cancelled'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists __SCHEMA__.tasks (
  id uuid primary key,
  goal_id uuid references __SCHEMA__.goals(id) on delete cascade,
  parent_task_id uuid references __SCHEMA__.tasks(id) on delete cascade,
  title text not null,
  description text not null,
  role_required text not null check (role_required in ('master', 'rule_writer', 'test_writer', 'worker')),
  assigned_agent_id uuid references __SCHEMA__.agents(id),
  status text not null default 'created' check (
    status in ('created', 'queued', 'assigned', 'running', 'needs_review', 'blocked', 'failed', 'cancelled', 'done')
  ),
  priority integer not null default 100,
  blocked_reason text,
  current_attempt integer not null default 0,
  max_attempts integer not null default 3,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists __SCHEMA__.task_runs (
  id uuid primary key,
  task_id uuid references __SCHEMA__.tasks(id) on delete cascade,
  agent_id uuid references __SCHEMA__.agents(id),
  cli_type text not null check (cli_type in ('mock', 'claude_code', 'gemini_cli', 'opencode')),
  cli_model text,
  command text not null,
  prompt text not null,
  exit_code integer,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled')),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists __SCHEMA__.task_run_logs (
  id uuid primary key,
  run_id uuid references __SCHEMA__.task_runs(id) on delete cascade,
  stream text not null,
  chunk_text text not null,
  sequence integer not null,
  created_at timestamptz not null default now()
);

create table if not exists __SCHEMA__.task_events (
  id uuid primary key,
  task_id uuid references __SCHEMA__.tasks(id) on delete cascade,
  event_type text not null,
  payload_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists __SCHEMA__.milestones (
  id uuid primary key,
  goal_id uuid references __SCHEMA__.goals(id) on delete cascade,
  name text not null,
  description text not null,
  status text not null default 'planned' check (
    status in (
      'planned',
      'candidate',
      'e2e_required',
      'e2e_running',
      'e2e_failed',
      'e2e_blocked',
      'passed',
      'notified',
      'cancelled'
    )
  ),
  main_commit_sha text,
  candidate_reason text,
  codex_verdict text,
  codex_verdict_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists __SCHEMA__.e2e_campaigns (
  id uuid primary key,
  milestone_id uuid references __SCHEMA__.milestones(id) on delete cascade,
  target_url text,
  status text not null default 'created' check (status in ('created', 'running', 'passed', 'failed', 'blocked', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists __SCHEMA__.e2e_cases (
  id uuid primary key,
  campaign_id uuid references __SCHEMA__.e2e_campaigns(id) on delete cascade,
  title text not null,
  description text not null,
  case_type text not null,
  preconditions text,
  steps_json jsonb not null default '[]',
  expected_result text not null,
  status text not null default 'created' check (status in ('created', 'running', 'passed', 'failed', 'blocked', 'skipped')),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists __SCHEMA__.notifications (
  id uuid primary key,
  milestone_id uuid references __SCHEMA__.milestones(id) on delete cascade,
  title text not null,
  body text not null,
  status text not null default 'created' check (status in ('created', 'sent', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists __SCHEMA__.notification_channels (
  id uuid primary key,
  type text not null check (type in ('console', 'email', 'telegram', 'webhook')),
  name text not null,
  config_json jsonb not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists __SCHEMA__.notification_deliveries (
  id uuid primary key,
  milestone_id uuid references __SCHEMA__.milestones(id) on delete cascade,
  channel_id uuid references __SCHEMA__.notification_channels(id),
  status text not null check (status in ('queued', 'sent', 'failed', 'cancelled')),
  payload_json jsonb not null default '{}',
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists __SCHEMA__.system_events (
  id uuid primary key,
  event_type text not null,
  payload_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);
