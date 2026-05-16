# 状态机契约

## Goal 状态

```text
created
intake
planning
plan_review
spec_phase
test_phase
implementation_phase
integration_review
codex_review
done
blocked
failed
cancelled
```

## Task 状态

```text
created
queued
assigned
running
needs_review
blocked
failed
cancelled
done
```

## Milestone 状态

```text
planned
candidate
e2e_required
e2e_running
e2e_failed
e2e_blocked
passed
notified
cancelled
```

## 约束

- `done`、`failed`、`cancelled` 是终态。
- Task 不能从 `created` 直接进入 `done`。
- Milestone 不能跳过 `e2e_required` 直接进入 `passed`。
- Goal 不能跳过 `codex_review` 直接进入 `done`。
