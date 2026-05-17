alter table __SCHEMA__.goals
  drop constraint if exists goals_status_check;

alter table __SCHEMA__.goals
  add constraint goals_status_check check (
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
      'fast_lane',
      'done',
      'blocked',
      'failed',
      'cancelled'
    )
  );
