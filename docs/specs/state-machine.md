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
- `--report-only` fast lane 的 Reviewer 入队前，Dionysus 必须把同一 goal 下已产出的 FastLane Worker run logs 摘要写入 Reviewer 任务事件 `reviewer.worker_reports_evidence`。Reviewer prompt 必须优先展示这些 Worker 报告证据；如果没有 Worker report evidence，Reviewer 必须判定为 `BLOCKED`，不得通过重新探索代码假装已经审核 Worker 产物。
- `task review --verdict reject` 只能把当前任务退回 `queued` 并重跑当前任务，不得放行下一任务。
- `task review --verdict block` 只能把当前任务标记为 `blocked`，不得放行下一任务。
- 同一任务第 10 次 `task review --verdict reject` 后必须强制进入 `blocked`，并写入 Codex Outbox `blocker`，由 Codex 亲自接手；不得继续 requeue WorkerCLI。
- Watchdog 将 `running` task 重试或阻塞时，必须同时把该 task 下未完成的 `task_runs` 收口为 `failed`，避免 Dashboard 长期显示幽灵 running。
- Task 被 `cancelled`、`done` 或 `blocked` 后，如果之前启动的 CLI run 延迟返回，run 收口不得把 task 重新改回 `needs_review` 或 `failed`。已关闭 run 的重复完成回调必须记录 `task.run_completion_ignored`，避免取消任务复活并污染 Codex Outbox。
- Codex Outbox reconcile 必须自动关闭两类陈旧 blocker：目标已 `done/cancelled` 的 blocker，以及 payload 中 `taskId` 指向已 `done/cancelled` task 的 blocker。
- 当 Codex 写入 `status=passed` 且 `pushed=true` 的 release record，并且 goal 当前或变更后处于 `done` 时，Dionysus 必须执行 release 收口：残留非终态 task 进入 `cancelled`，活跃 task run 收口，`queued/running` integration 进入 `cancelled`，对应待处理 patch 进入 `rejected`。该操作必须写入 `goal.release_cleanup_applied`，并且不得重新打开 `done/failed/cancelled` 目标。
- 已关闭的 fast lane goal 只代表历史审计记录，不得继续暴露 worker/reviewer/integration 残留计数作为可执行工作。
- Agent run 成功但产生 patch 时，不得立即放行下一优先级 task；必须记录 `dispatch.waiting_for_integration`，等待 integration `passed` 且 patch `applied` 后仍需进入 task review；review approve 后才能 dispatch 下一 task。
- integration `blocked` 或 `failed` 时必须写入 `codex_outbox` blocker，由 Codex 处理，不能继续放行 Worker。
- Integration Worker 在自动修改目标项目工作区前必须有至少一条验证命令。若 patch 没有可执行验证命令，必须 `blocked`，并保持目标项目工作区不变，交给 Codex 人工审查和接管。
- `task codex-complete` 用于 Codex 接手并完成任务时，必须把任务标记为 `done`，并将该任务下仍处于 `running` 的 `task_runs` 收口为 `succeeded`。不得写入 milestone / release 使用的 `passed` 状态，因为 `task_runs.status` 的合法完成状态是 `succeeded`。
- Milestone 不能跳过 `e2e_required` 直接进入 `passed`。
- Goal 不能跳过 `codex_review` 直接进入 `done`。
