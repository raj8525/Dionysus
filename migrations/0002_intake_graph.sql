create table if not exists __SCHEMA__.documents (
  id uuid primary key,
  goal_id uuid references __SCHEMA__.goals(id) on delete cascade,
  path text not null,
  kind text not null check (kind in ('markdown', 'html', 'code', 'config', 'other')),
  line_count integer not null default 0,
  size_bytes integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists __SCHEMA__.document_findings (
  id uuid primary key,
  goal_id uuid references __SCHEMA__.goals(id) on delete cascade,
  document_path text not null,
  finding_type text not null,
  severity text not null check (severity in ('info', 'warning', 'blocked')),
  line_number integer,
  excerpt text not null,
  created_at timestamptz not null default now()
);

create table if not exists __SCHEMA__.build_graph_nodes (
  id uuid primary key,
  goal_id uuid references __SCHEMA__.goals(id) on delete cascade,
  node_key text not null,
  label text not null,
  node_type text not null,
  status text not null default 'planned',
  created_at timestamptz not null default now(),
  unique (goal_id, node_key)
);

create table if not exists __SCHEMA__.build_graph_edges (
  id uuid primary key,
  goal_id uuid references __SCHEMA__.goals(id) on delete cascade,
  source_key text not null,
  target_key text not null,
  label text,
  created_at timestamptz not null default now()
);
