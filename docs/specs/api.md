# API 契约

## Health

```text
GET /health
```

`/health` 必须真实检查 API、PostgreSQL、RabbitMQ 与 Worker Runtime 连接状态，返回 `database.ok`、`rabbitmq.ok`、`worker.ok`、schema、数据库时间和 Worker 最后心跳，不能只返回静态 `ok: true`。

返回：

```json
{
  "ok": true,
  "service": "dionysus-api",
  "database": {
    "ok": true,
    "schema": "dionysus",
    "databaseTime": "2026-05-16T12:00:00.000Z"
  },
  "rabbitmq": {
    "ok": true,
    "urlConfigured": true,
    "checkedAt": "2026-05-16T12:00:00.000Z"
  },
  "worker": {
    "ok": true,
    "status": "ok",
    "lastEventType": "worker.heartbeat",
    "lastSeenAt": "2026-05-16T11:59:45.000Z",
    "ageSeconds": 15,
    "maxAgeSeconds": 90
  }
}
```

Worker Runtime 必须在启动时写入 `worker.started` system event，并按 `DIONYSUS_WORKER_HEARTBEAT_INTERVAL_SECONDS` 定时写入 `worker.heartbeat`。API 使用 `DIONYSUS_WORKER_HEALTH_MAX_AGE_SECONDS` 判断心跳是否过期。

## Goals

```text
POST /api/goals
GET /api/goals/:id
GET /api/goals/:id/graph
POST /api/goals/:id/intake
POST /api/goals/:id/bootstrap
GET /api/goals/:id/findings
POST /api/goals/:id/gate-check
POST /api/goals/:id/preflight
POST /api/goals/:id/preflight-remediation
POST /api/goals/:id/preflight-remediation/patch
POST /api/goals/:id/master-step
POST /api/goals/:id/integrations/release-ready
```

`integrations/release-ready` 不能把所有 dirty worktree 都视为同一种阻塞。规则：

- 请求体可选 `allowedDirtyPaths: string[]`，用于声明已经识别归属、不得混入本次发布的既有 dirty path。
- 如果存在 queued integration，目标 worktree 必须 clean，才能发布 integration。
- 如果没有 queued integration，但 worktree 的变更文件全部来自已经 `passed/applied` 的 integration changedFiles，则返回 `ready_for_codex_commit`，并创建 `release_ready` Codex Outbox 事件，交给 Codex 做最终验证、提交和推送。
- 如果 dirty 文件中存在不属于已通过 integration 的路径，则返回 `blocked`，blocker 必须列出 unmanaged changes。

这个规则保证 Dionysus 能把“已集成、待 Codex 提交”的真实产物继续向前推进，同时阻止未归属改动混入发布。

创建 goal 请求：

```json
{
  "title": "完整实现 Coupon SaaS 系统",
  "description": "读取 Coupon 文档和 HTML，持续推进开发。",
  "targetRoot": "/Volumes/MacMiniSSD/code/Coupon"
}
```

目标列表：

```text
GET /api/goals?limit=<n>
POST /api/goals
GET /api/goals/:id
GET /api/goals/:id/status
```

`GET /api/goals` 必须按 `created_at desc` 返回最近目标，默认 20 条，`limit` 必须限制在 1-100。Codex CLI 必须支持 `pnpm dionysus goal list --limit 10`，Dashboard 必须能列出已有目标并切换当前目标，避免 Codex 只能通过数据库手工查 goal id。

`GET /api/goals/:id/status` 是 Codex 判断单个目标当前进度的聚合入口，必须返回 goal、summary、tasks、runs、integrations、milestones、releases、usage 和 pendingCodexOutbox。summary 必须按 status 聚合各类对象，并给出 `pendingCodexOutbox`、`cliCalls`、`modelCalls`、`nextOwner`。Codex CLI 必须支持 `pnpm dionysus goal status --goal-id "<goal-id>"`。

## Flow

```text
GET /api/goals/:id/graph
GET /api/flow/current
GET /api/flow/goal/:goalId
```

返回 React Flow 兼容节点和边：

```json
{
  "nodes": [],
  "edges": []
}
```

## Milestones

```text
GET /api/milestones
POST /api/milestones
POST /api/goals/:id/detect-milestones
POST /api/milestones/:id/request-e2e
POST /api/milestones/:id/e2e-campaigns
POST /api/milestones/:id/codex-verdict
POST /api/milestones/:id/notifications
```

`detect-milestones` 只接受已经通过 integration、patch 已 applied、测试状态 passed，且同时包含最终用户可见前端变更与后端 / API / 数据库变更的结果。这里的 milestone 必须是最终用户可在浏览器中完成的完整功能模块，不得把后端-only、测试-only、文档-only、基础设施-only、纯前端静态改动、mock 数据演示或 render-only 检查作为 milestone。integration 结果还必须包含 `finalUserFeatureEvidence[]` 和 `realDataPersistenceEvidence[]`；没有这两类证据时只能作为 engineering checkpoint。未达到完整前后端闭环的结果不能创建 milestone。创建出的 milestone 必须进入 `candidate`，之后必须经过浏览器级 E2E。

`codex-verdict` 必须遵守 milestone 状态机：`passed` 只能从 `e2e_running` 进入；如果 Codex 或 Master 试图从 `candidate` 或 `e2e_required` 直接标记 `passed`，API 必须返回 `409 INVALID_MILESTONE_TRANSITION`。

## E2E

```text
GET /api/e2e/campaigns
GET /api/e2e/campaigns/:id/cases
POST /api/e2e/cases/:id/result
```

E2E campaign 由 Dionysus 生成用例草案，由 Codex 执行最终用户视角的浏览器级测试并提交 verdict。milestone verdict 不接受 render-only 结果；render-only 只能用于工程 checkpoint 诊断。

每条 E2E case 必须可记录执行结果：`passed`、`failed`、`blocked`、`skipped`，同时保存失败原因与证据 JSON。Campaign 状态必须由 case 状态自动汇总，不能靠人工口头判断。`passed` 结果必须包含 `mode=strict`、`targetUrl`、`screenshotPath` 和 `consoleErrors[]`，否则 API 必须拒绝。

## Notifications

```text
POST /api/notifications
POST /api/notifications/:id/deliver
```

通知创建和投递必须都落库；console 投递用于 Codex 会话内反馈，email/Telegram 后续扩展。

## Codex Outbox

```text
GET /api/codex/outbox
POST /api/codex/outbox
POST /api/codex/outbox/:id/ack
POST /api/codex/outbox/reconcile
```

Dionysus 主动请求 Codex 介入时必须写入 `codex_outbox`，不能只依赖 Agent 输出或当前会话上下文。

事件类型：

- `blocker`：目标被阻断，需要 Codex 清理工作区、改计划或询问用户。
- `e2e_required`：出现里程碑，需要 Codex 执行浏览器级 E2E。
- `release_ready`：内部门禁已过，等待 Codex 最终验证、提交和推送。
- `user_notify`：需要 Codex 通知用户查看成果。

创建请求：

```json
{
  "goalId": "18adb562-7ed3-45ae-b99a-b9a76dd2a928",
  "eventType": "blocker",
  "reason": "run-cycle blocked: clean git worktree",
  "source": "goal.supervise",
  "payload": {}
}
```

`goalId + eventType + reason` 必须去重，防止监督循环重复刷屏。

Codex CLI 必须支持：

```text
pnpm dionysus system runtime start
pnpm dionysus system runtime status
pnpm dionysus system runtime stop
pnpm dionysus codex heartbeat --limit 5
pnpm dionysus codex outbox --limit 5
pnpm dionysus codex reconcile
pnpm dionysus codex ack --event-id "<event-id>"
```

`system runtime start` 必须本地启动 API 与 Worker 后台进程，并把 pid/log 位置返回给 Codex；返回前必须等待 API `/health` 至少可访问，避免 Codex 紧接着执行 `agent config list`、`goal status` 等 API 命令时遇到 `fetch failed` 竞态；`status` 必须基于 pid 文件检查进程是否仍在运行；`stop` 必须停止由 Dionysus 管理的 API 与 Worker。这个能力不依赖 API 已经可用，因为它用于修复 `fetch failed` 级别的基础阻断。

`system runtime heal` 必须读取当前 Dionysus 仓库 `git rev-parse HEAD`，并与 `/health.worker.runtime.codeCommitSha` 比较。只要 worker 进程仍在运行旧 commit，即使 `/health.ok=true` 且心跳未过期，也必须执行 runtime restart，防止 Codex 以为新门禁已经生效但实际 Worker 仍运行旧代码。

`reconcile` 必须检查 pending `blocker` 事件中携带的 `integrationId`。如果对应 `integration_queue.status = passed`，说明阻塞根因已被后续 retry 或 patch 解决，系统必须自动将该 Outbox 事件标记为 `acked`，并写入 `codex.outbox_reconciled` system event。

`reconcile` 还必须检查 pending `blocker` 所属 goal 的状态。如果 goal 已经是 `done` 或 `cancelled`，该 blocker 已不再代表当前可执行工作，也必须自动标记为 `acked`。`failed` goal 的 blocker 不得自动关闭，因为失败目标仍需要 Codex 或人类判断。`heartbeat` 必须先调用 reconcile，再返回剩余 pending 事件，防止 Codex 继续处理陈旧 blocker。

`release_ready` 的 ack 必须强制检查 `release_records.codex_outbox_event_id = <event-id>` 是否存在。不存在时 `POST /api/codex/outbox/:id/ack` 必须返回 `409 CODEX_OUTBOX_ACK_BLOCKED`，提示 Codex 先执行 `release record`。只有显式传入 `{ "force": true }` 时才允许人工破例 ack。

## Target Mutation Guard

Agent Runtime 必须在隔离工作区运行 Worker / RuleWriter / TestWriter。目标项目 worktree 在 Agent 执行期间发生变化时，不得再直接判定当前 Agent 失败，因为同一时间可能有 Codex、另一个 Agent、或已通过 integration 正在写入无关模块。

处理规则：

- 如果变化可由同一 goal 中另一个 `passed` integration 解释，记录 `target_root_mutation_explained_by_integration`，继续当前任务。
- 如果变化无法解释，记录 `target_root_mutation_observed` warning，继续当前任务。
- 最终是否允许提交由 patch apply、review、测试和 release gate 判断；release gate 必须阻止未归属文件混入提交。

## Integration Apply

Integration applier 不得因为目标项目存在无关 dirty 文件而整体阻塞。它必须直接执行 `git apply --check`，由 Git 判断 patch 是否与当前工作区冲突：

- patch 与现有 dirty 文件无关时，允许应用。
- patch 与 dirty 文件冲突时，返回 failed 并保留 Git 的失败原因。
- integration 的 `changedFiles` 必须只记录当前 patch 触达的文件，不能把目标项目里已有的其他 dirty 文件归入当前任务。

## Release Records

```text
GET /api/releases?goalId=<goal-id>
POST /api/releases
```

当 Codex 处理 `release_ready`，完成最终验证、提交和推送后，必须写入 release record。该记录是 Dionysus 判断目标项目是否真正发布到 Git 主线的审计证据，不能只依赖当前会话自然语言。

`status=passed` 且 `pushed=true` 的 release record 必须携带可审计证据：`changedFiles` 至少 1 个文件、`verification` 至少 1 条 `status=passed` 的验证命令、`summary` 非空。否则 API 必须返回 `409 RELEASE_RECORD_EVIDENCE_REQUIRED`，不得把 goal 自动置为 `done`。

`release record` 同时是 goal 状态闭环的事实源：当记录为 `status=passed` 且 `pushed=true` 时，API 必须自动把仍处于活动状态的 goal 更新为 `done`；当记录为 `status=failed` 或 `status=blocked` 时，API 必须分别把仍处于活动状态的 goal 更新为 `failed` 或 `blocked`。已经处于 `done`、`failed`、`cancelled` 的终态 goal 不得被 release record 重新打开或覆盖。

当 `release record` 为 `status=passed` 且 `pushed=true`，并且 goal 当前或变更后处于 `done` 时，API 必须执行 release 收口：

- 将该 goal 下所有非 `done/cancelled` 的残留 task 标记为 `cancelled`，原因写明已被该 release commit 取代。
- 将这些 task 下仍在 `running` 的 task run 收口为 `failed`，`exit_code` 使用 `130`，并释放空闲 Agent。
- 将该 goal 下仍在 `queued/running` 的 integration 标记为 `cancelled`，并将对应 `created/queued` patch 标记为 `rejected`。
- 写入 `task.release_superseded`、`integration.release_superseded` 和 `goal.release_cleanup_applied` 事件。
- `fastlane status` 对 `done/failed/cancelled` 目标不得再把残留 worker、reviewer 或 integration 计数展示为可执行工作。

这条规则允许 Codex 对已经人工完成验证、提交并推送的目标做最终裁决，避免旧 Worker / Reviewer / integration 记录继续误导后续调度。

创建请求：

```json
{
  "goalId": "18adb562-7ed3-45ae-b99a-b9a76dd2a928",
  "codexOutboxEventId": "b6fa20e1-43b2-4b19-8a15-df5e0c6b0c52",
  "targetRoot": "/Volumes/MacMiniSSD/code/Coupon",
  "branch": "main",
  "commitSha": "fabbb07",
  "status": "passed",
  "pushed": true,
  "changedFiles": [
    "apps/admin-api/internal/handler/real_db_smoke_test.go"
  ],
  "verification": [
    {
      "command": "ADMIN_API_JWT_SECRET=test-secret-for-real-db-smoke go test ./apps/admin-api/internal/handler/ -run 'TestRealDB_' -count=1 -v",
      "status": "passed"
    }
  ],
  "summary": "真实数据库 smoke 测试已提交并推送"
}
```

Codex CLI 必须支持：

```text
pnpm dionysus release record --goal-id "<goal-id>" --codex-outbox-event-id "<event-id>" --target-root "/path/to/project" --branch main --commit-sha "<sha>" --status passed --pushed true --changed-file "path" --verification-json '[{"command":"pnpm test","status":"passed"}]' --summary "..."
pnpm dionysus release list --goal-id "<goal-id>"
```

同一个 `goalId + commitSha` 必须幂等 upsert。每次写入必须同时产生 `release.recorded` system event。

## CLI

```text
POST /api/cli/probe
GET /api/cli/models
POST /api/cli/validate-model
GET /api/agents
GET /api/agent-cli-configs
PUT /api/agent-cli-configs
GET /api/usage/agent-cli
```

`validate-model` 请求：

```json
{
  "cliType": "opencode",
  "model": "minimax/MiniMax-M2.7"
}
```

`validate-model` 返回：

```json
{
  "cliType": "opencode",
  "inputModel": "minimax/MiniMax-M2.7",
  "resolvedModel": "minimax-cn-coding-plan/MiniMax-M2.7",
  "available": true,
  "command": "opencode"
}
```

OpenCode 模型验证必须先解析 `DIONYSUS_OPENCODE_MODEL_ALIASES`，再与 `opencode models` 的实时输出比对。模型不可用时必须返回 `available: false`、`reason` 和可选 `suggestions`，不得等到 Agent Runtime 执行任务时才失败。

Codex 必须能通过 CLI 配置 Agent，不依赖前端：

```text
pnpm dionysus agent probe
pnpm dionysus agent list
pnpm dionysus agent validate-model --cli opencode --model "minimax/MiniMax-M2.7"
pnpm dionysus agent config list
pnpm dionysus agent config set --role worker --cli opencode --model "minimax/MiniMax-M2.7" --enabled true
pnpm dionysus agent status --goal-id "<goal-id>"
```

`agent config set` 必须先调用模型验证；验证通过后保存 resolved model，验证失败时不得写入 `agent_cli_configs`。

`agent status` 必须聚合 `/health`、`/api/agent-cli-configs`、`/api/agents`、`/api/tasks`、`/api/runs` 和 `/api/usage/agent-cli`，返回 Runtime 是否可推进、已配置/禁用 Agent 数、Agent 实例 working/idle/blocked/disabled 数、queued/running/blocked 任务数、最近 run 是否绑定具体 Agent，以及下一步动作建议。

`/api/agents` 必须返回系统内置 Agent 实例 `Master`、`RuleWriter`、`TestWriter`、`WorkerA`、`WorkerB`、`WorkerC`、`WorkerD` 的 `id`、`name`、`role`、`status`、`cliType`、`cliModel`、`createdAt`、`updatedAt`。这些实例是 `task_runs.agent_id` 的唯一可信来源，也是 Dashboard 展示“谁正在工作”的基础。

`/api/usage/agent-cli` 用于前端和 Codex 实时查看 Agent 调用消耗。它必须基于 PostgreSQL `task_runs` 做全量聚合，不能只统计前端当前分页。支持可选 `goalId` 或 `targetRoot` 过滤；Dashboard 默认使用当前目标的 `targetRoot` 做项目级累计统计，Codex 需要单目标诊断时才使用 `goalId`：

```text
GET /api/usage/agent-cli?goalId=<goal-id>
GET /api/usage/agent-cli?targetRoot=/Volumes/MacMiniSSD/code/Coupon
```

返回按 Agent 实例、Agent 角色、CLI、模型聚合的调用数：

```json
{
  "goalId": "18adb562-7ed3-45ae-b99a-b9a76dd2a928",
  "generatedAt": "2026-05-16T16:10:00.000Z",
  "totals": {
    "cliCalls": 8,
    "modelCalls": 8,
    "runningCalls": 1,
    "succeededCalls": 6,
    "failedCalls": 1,
    "distinctModels": 3
  },
  "byAgentInstance": [
    {
      "agentKey": "agent:worker-a",
      "agentId": "worker-a",
      "agentName": "WorkerA",
      "role": "worker",
      "cliCalls": 3,
      "modelCalls": 3,
      "runningCalls": 1,
      "succeededCalls": 1,
      "failedCalls": 1,
      "lastRunAt": "2026-05-16T16:09:30.000Z",
      "models": [
        {
          "cliType": "opencode",
          "cliModel": "minimax-cn-coding-plan/MiniMax-M2.7",
          "cliCalls": 3,
          "modelCalls": 3,
          "runningCalls": 1,
          "succeededCalls": 1,
          "failedCalls": 1
        }
      ]
    }
  ],
  "byAgent": [
    {
      "role": "worker",
      "cliCalls": 3,
      "modelCalls": 3,
      "runningCalls": 1,
      "succeededCalls": 1,
      "failedCalls": 1,
      "lastRunAt": "2026-05-16T16:09:30.000Z",
      "models": [
        {
          "cliType": "opencode",
          "cliModel": "minimax-cn-coding-plan/MiniMax-M2.7",
          "cliCalls": 3,
          "modelCalls": 3,
          "runningCalls": 1,
          "succeededCalls": 1,
          "failedCalls": 1
        }
      ]
    }
  ],
  "byCli": []
}
```

`byAgentInstance` 必须合并 `agents` 表中的全部内置 Agent 实例；即使某个 Agent 尚未产生任何 `task_runs`，也必须以 `cliCalls=0`、`modelCalls=0` 出现在返回值中，保证 Dashboard 能实时看到 Master、RuleWriter、TestWriter、WorkerA-D 的全貌。已有调用数据时优先使用 `task_runs.agent_id` 和 `agents.name` 聚合；当历史 run 没有关联真实 agent id 时，必须回退到 `role:<role>`，让 Dashboard 仍能展示 Master / RuleWriter / TestWriter / Worker 的调用统计。

新 run 创建时必须在同一数据库事务中 claim 一个对应角色的 enabled Agent 实例：优先选择 `idle` 且最久未更新的 Agent；没有 idle Agent 时才使用非 disabled 的 fallback。claim 成功后必须写入 `task_runs.agent_id`，并把 Agent 状态置为 `working`。run 完成、取消、Watchdog 重试或阻断后，如果该 Agent 没有其他 running run，必须释放回 `idle`。

`modelCalls` 的口径必须优先读取 PostgreSQL `task_runs.model_call_count`。如果 CLI 输出包含形如 `DIONYSUS_USAGE_JSON={"modelCalls":3}` 的 usage 回执，Agent Runtime 必须把它持久化到 `task_runs.model_call_count` 与 `task_runs.model_usage_json`，前端和 CLI 统计使用该真实值。缺少 usage 回执时，Dionysus 才回退为估算：非 `mock` 的 CLI run 按 1 次模型调用计，`mock` 按 0 次计。

`/api/runs/:id/logs` 用于 Codex 和 Dashboard 读取某次 Agent run 的完整 stdout/stderr 分片。Agent Runtime 必须在 CLI 进程运行中流式写入日志，不能等进程结束后才批量写入。`/api/runs` 只返回预览，不能作为诊断 Agent 卡死、超时或输出不合格的唯一证据。

```text
GET /api/runs/<run-id>/logs
```

返回按 `sequence` 和 `createdAt` 排序的完整日志：

```json
{
  "runId": "995b8e0c-e297-4a85-9be3-7d7c3fe3974b",
  "logs": [
    {
      "id": "log-id",
      "runId": "995b8e0c-e297-4a85-9be3-7d7c3fe3974b",
      "stream": "stdout",
      "chunkText": "Agent output...",
      "sequence": 1,
      "createdAt": "2026-05-16T16:35:10.000Z"
    }
  ]
}
```

Codex CLI 必须支持：

```text
pnpm dionysus run logs --run-id "<run-id>"
```

## Gatekeeper

```text
POST /api/goals/:id/gate-check
```

Codex CLI 必须覆盖完整 goal 生命周期入口，不能要求 Codex 手写 `curl`。最低命令集：

```text
pnpm dionysus system worker start
pnpm dionysus goal intake --goal-id "<goal-id>"
pnpm dionysus goal bootstrap --goal-id "<goal-id>"
pnpm dionysus goal preflight --goal-id "<goal-id>"
pnpm dionysus goal gate-check --goal-id "<goal-id>"
pnpm dionysus goal remediation --goal-id "<goal-id>"
pnpm dionysus goal remediation-patch --goal-id "<goal-id>"
pnpm dionysus goal master-step --goal-id "<goal-id>"
pnpm dionysus goal release-ready --goal-id "<goal-id>" [--allow-dirty-path "path/to/existing-change"]
pnpm dionysus integration list --goal-id "<goal-id>"
pnpm dionysus integration retry --integration-id "<integration-id>"
pnpm dionysus task create --goal-id "<goal-id>" --title "..." --role worker --no-queue
pnpm dionysus task enqueue --task-id "<task-id>"
pnpm dionysus task cancel --task-id "<task-id>" --reason "superseded by staged sequence"
pnpm dionysus task review --task-id "<task-id>" --verdict approve --score 90 --reason "reviewed by Codex"
```

`task review` 请求体支持 `score`。普通 Worker 任务可由 Codex 直接 approve；`FastLane Reviewer` 任务执行 90 分质量门禁，`approve` 必须携带 `score >= 90`。缺少 `score` 或 `score < 90` 时 API 必须返回 `409 REVIEWER_SCORE_GATE_BLOCKED`，要求 Codex 改用 `--verdict reject` 并把具体修复项交回 WorkerCLI。

`system worker start` 必须用 detached 进程启动 Worker Runtime，并把 stdout/stderr 写入 `.dionysus/logs/worker-*.log`。Codex 不应该依赖前台 shell 会话维持 Worker 心跳。

`POST /api/tasks` 默认创建并立即入队；当请求体包含 `"queue": false`，或 CLI 使用 `--no-queue` 时，只创建 `created` 任务，不投递 RabbitMQ。该能力用于先建立任务树，再由 Master/上一阶段成功后的 `dispatchNextTask` 按优先级放行，避免 Worker 早于 TestWriter 运行。

`POST /api/tasks/:id/enqueue` 用于重投递已存在的 `created` 或 `queued` 任务。当任务状态已经是 `queued` 但 RabbitMQ 消息因 worker 重启、旧消费者异常或运维操作而丢失时，Codex 必须能使用 `pnpm dionysus task enqueue --task-id "<task-id>"` 重新投递，不需要重建任务。

`POST /api/tasks/:id/cancel` 用于 Codex 或 Master 取消错误排队、过宽、过期或被新任务替代的任务。取消时必须把 task 标记为 `cancelled`，记录 `task.cancelled` 事件，并收口该 task 下仍处于 `running` 的 run。

`POST /api/tasks/:id/review` 是 Codex 或 Master 对 Agent 产物的正式评审入口，只允许评审状态为 `needs_review` 的任务。`verdict=approve` 必须将任务标记为 `done`，然后查找同一 goal 中下一条 `created` task 并投递到对应角色队列；`verdict=reject` 必须将任务退回 `queued` 并重新投递当前任务到 `role_required` 对应队列；`verdict=block` 必须将任务标记为 `blocked` 并写入 `blocked_reason`。每次 review 都必须记录 `task.review_approve`、`task.review_reject` 或 `task.review_block` 事件；approve 放行后还必须记录 `review.dispatch_next_task` 或 `review.no_next_task`；任务不在 `needs_review` 时必须返回 `409 TASK_NOT_REVIEWABLE`。

同一个任务累计第 10 次 `verdict=reject` 时，Dionysus 不得继续重排 WorkerCLI。API 必须把任务标记为 `blocked`，记录 `task.review_codex_takeover`，写入 `codex_outbox` 的 `blocker` 事件，并在响应中返回 `codexTakeoverRequired: true`、`rejectionPolicy` 和 `codexOutboxEvent`。此时 Codex 必须亲自接手该任务，不能继续让 WorkerCLI 盲目迭代。

Agent Runtime 执行任务时必须优先读取 `agent_cli_configs` 中对应角色的配置。`DIONYSUS_WORKER_CLI_TYPE` 和 `DIONYSUS_WORKER_CLI_MODEL` 只能作为没有角色配置时的兼容 fallback，不得覆盖 Dashboard/CLI 已保存的 `Master`、`RuleWriter`、`TestWriter`、`Worker` 配置。否则 Dashboard 会显示 Agent 已配置为真实 CLI，但实际 run 仍可能落到 `mock`，这是不可接受的控制面漂移。

Codex 也必须有一个高层单步循环命令：

```text
pnpm dionysus goal run-cycle --goal-id "<goal-id>" --target-url "<local-url>" --run-e2e --mode strict
pnpm dionysus goal supervise --goal-id "<goal-id>" --iterations 5 --interval-seconds 30
```

Fast lane 目标必须有专用状态入口：

```text
pnpm dionysus fastlane status --goal-id "<goal-id>"
```

该命令必须读取 `GET /api/goals/:id/status`，按 FastLane Worker / Reviewer 任务、integration、Codex Outbox 聚合为明确 phase 和 nextCommands。它必须能区分：`working`、`worker_review`、`waiting_for_integration`、`ready_for_reviewer`、`reviewer_review`、`codex_final`、`blocked`、`codex_outbox`、`closed`、`idle`，避免 Codex 通过人工猜测推进。

`run-cycle` 必须顺序执行 preflight、master-step、detect-milestones，返回当前 blocker、nextOwner、nextActions。提供 `target-url` 时，它可以为待验收 milestone 创建或复用 E2E campaign；只有显式传入 `--run-e2e` 才运行浏览器测试，且 `strict` 模式不得伪造产品主路径通过。

`supervise` 必须按轮次执行 agent status 与 run-cycle，直到出现 runtime blocker、业务 blocker、E2E 需要 Codex 介入，或达到最大轮次。它是 Codex 7x24 监督 Dionysus 的主入口，不能依赖前端刷新。每轮 agent status 必须同时读取 `/health`、`/api/agent-cli-configs`、`/api/agents`、`/api/tasks`、`/api/runs` 和 `/api/usage/agent-cli`，保证 Codex 监督入口、Dashboard 与 CLI usage 统计口径一致。

## Patch Queue

```text
POST /api/patches
```

Integration Worker 必须基于 patch 的 `changedFiles` 推导最低验证命令，防止治理类 Agent 只产出文件而没有可执行门禁。例如：

- `apps/admin-api/internal/handler/*_test.go` -> `go test -c ./apps/admin-api/internal/handler/`
- 其他 `.go` 文件 -> `go test ./... -count=1`
- `apps/admin-web/src/` 或 `apps/admin-web/html/` -> `pnpm --filter @coupon/admin-web build`

`DIONYSUS_INTEGRATION_VERIFY_COMMANDS` 只作为额外全局验证命令追加，不应替代上述自动推导命令。

Patch 必须支持任务级文件范围硬门禁：

- `POST /api/patches` 可接收 `allowedFiles`，表示该任务允许修改的精确文件或以 `/` 结尾的目录前缀。
- Worker Runtime 必须从任务描述中的 `Allowed files:`、`Allowed paths:`、`允许修改路径:`、`允许修改文件:`、`文件范围:` 或 `只允许修改:` 提取范围，并随 patch 写入 `patches.allowed_files_json`。
- 当 `allowedFiles` 非空时，Integration Worker 必须在 `git apply` 前校验 patch 的每个 changed file。任何文件不在范围内，`applyPatchToTarget` 必须返回 `blocked`，不得修改目标工作区。
- 当 `allowedFiles` 为空时保持兼容，不做任务级范围限制；但 Codex fast lane 创建 Worker 任务时必须写明允许修改范围。

Integration Worker 必须支持受保护文件硬门禁，避免 WorkerCLI 或 ReviewerCLI 只靠 prompt 约束而误改成熟页面或高风险核心文件：

- `DIONYSUS_PROTECTED_FILES`：换行或 `&&` 分隔的受保护相对路径；规则可以是精确文件，也可以是以 `/` 结尾的目录前缀。
- `DIONYSUS_ALLOW_PROTECTED_FILES`：同格式的显式放行列表。
- patch 的 `changedFiles` 命中受保护规则且未命中放行规则时，`applyPatchToTarget` 必须在 `git apply` 前返回 `blocked`，不得修改目标工作区。
- blocked integration 必须进入 Codex Outbox，由 Codex 判断是否放行、改任务描述、或亲自接手。

Coupon 当前默认保护：

```env
DIONYSUS_PROTECTED_FILES=apps/admin-web/src/pages/tenants.vue&&apps/admin-web/src/pages/hotels.vue
```

原因：`tenants.vue` 是成熟集团租户管理页，`hotels.vue` 是真实酒店门店/部门页；后续任务只能在明确授权时做小范围增量，不能被页面迁移或 Worker 泛化改写破坏。

失败的 integration 必须可重试，避免因为旧环境变量、临时 CLI 故障或验证命令修复后重建整条任务链：

```text
POST /api/integrations/:id/retry
pnpm dionysus integration retry --integration-id "<integration-id>"
```

重试时必须把对应 `integration_queue` 和 `patches` 重新置为 `queued`，记录 `integration.retry_queued` 事件，并重新投递 `dionysus.integration` 队列。

里程碑候选证据必须通过正式接口写回 integration：

```text
POST /api/integrations/:id/evidence
pnpm dionysus integration evidence --integration-id "<integration-id>" --final-user-evidence "..." --persistence-evidence "..."
```

`evidence` 至少包含 `finalUserFeatureEvidence[]` 与 `realDataPersistenceEvidence[]`。它只表示该 integration 具备进入 milestone candidate 的最低事实基础，不能替代 Codex 浏览器级 E2E verdict。
