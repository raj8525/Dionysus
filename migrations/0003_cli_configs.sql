create table if not exists __SCHEMA__.agent_cli_configs (
  id uuid primary key,
  agent_role text not null check (agent_role in ('master', 'rule_writer', 'test_writer', 'worker')),
  cli_type text not null check (cli_type in ('mock', 'claude_code', 'gemini_cli', 'opencode')),
  cli_model text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists agent_cli_configs_role_unique
  on __SCHEMA__.agent_cli_configs(agent_role);

create table if not exists __SCHEMA__.cli_models (
  id uuid primary key,
  cli_type text not null check (cli_type in ('mock', 'claude_code', 'gemini_cli', 'opencode')),
  model text not null,
  available boolean not null default true,
  raw_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cli_type, model)
);
