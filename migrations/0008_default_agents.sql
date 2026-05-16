create unique index if not exists agents_name_unique
  on __SCHEMA__.agents(name);

insert into __SCHEMA__.agents (id, name, role, status, cli_type, cli_model)
values
  ('00000000-0000-0000-0000-000000000101', 'Master', 'master', 'idle', 'mock', null),
  ('00000000-0000-0000-0000-000000000102', 'RuleWriter', 'rule_writer', 'idle', 'mock', null),
  ('00000000-0000-0000-0000-000000000103', 'TestWriter', 'test_writer', 'idle', 'mock', null),
  ('00000000-0000-0000-0000-000000000104', 'WorkerA', 'worker', 'idle', 'mock', null),
  ('00000000-0000-0000-0000-000000000105', 'WorkerB', 'worker', 'idle', 'mock', null),
  ('00000000-0000-0000-0000-000000000106', 'WorkerC', 'worker', 'idle', 'mock', null),
  ('00000000-0000-0000-0000-000000000107', 'WorkerD', 'worker', 'idle', 'mock', null)
on conflict (name)
do update set role = excluded.role,
              updated_at = now();
