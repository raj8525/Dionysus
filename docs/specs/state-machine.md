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
- Task 只能从 `created`、`queued`、`failed` 原子进入 `running`；如果同一 task 已经 `running`，重复队列消息必须记录 `task.run_skipped_already_active` 并退出，不能再创建第二个 running run。
- Agent run 成功后必须进入 `needs_review`，不得直接放行下一任务。
- 只有 `task review --verdict approve` 才能将任务标记为 `done` 并放行下一条 created task。
- `FastLane Reviewer` 任务执行 90 分质量门禁；`task review --verdict approve` 必须携带 `score >= 90`，否则 API 必须拒绝状态迁移。
- `task review --verdict reject` 只能把当前任务退回 `queued` 并重跑当前任务，不得放行下一任务。
- `task review --verdict block` 只能把当前任务标记为 `blocked`，不得放行下一任务。
- 同一任务第 10 次 `task review --verdict reject` 后必须强制进入 `blocked`，并写入 Codex Outbox `blocker`，由 Codex 亲自接手；不得继续 requeue WorkerCLI。
- Watchdog 将 `running` task 重试或阻塞时，必须同时把该 task 下未完成的 `task_runs` 收口为 `failed`，避免 Dashboard 长期显示幽灵 running。
- Task 被 `cancelled`、`done` 或 `blocked` 后，如果之前启动的 CLI run 延迟返回，run 收口不得把 task 重新改回 `needs_review` 或 `failed`。已关闭 run 的重复完成回调必须记录 `task.run_completion_ignored`，避免取消任务复活并污染 Codex Outbox。
- Codex Outbox reconcile 必须自动关闭两类陈旧 blocker：目标已 `done/cancelled` 的 blocker，以及 payload 中 `taskId` 指向已 `done/cancelled` task 的 blocker。
- Agent run 成功但产生 patch 时，不得立即放行下一优先级 task；必须记录 `dispatch.waiting_for_integration`，等待 integration `passed` 且 patch `applied` 后仍需进入 task review；review approve 后才能 dispatch 下一 task。
- integration `blocked` 或 `failed` 时必须写入 `codex_outbox` blocker，由 Codex 处理，不能继续放行 Worker。
- Milestone 不能跳过 `e2e_required` 直接进入 `passed`。
- Goal 不能跳过 `codex_review` 直接进入 `done`。
