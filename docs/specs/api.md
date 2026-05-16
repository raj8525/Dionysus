# API 契约

## Health

```text
GET /health
```

`/health` 必须真实检查 API 与 PostgreSQL 连接状态，返回 `database.ok`、schema 和数据库时间，不能只返回静态 `ok: true`。

返回：

```json
{
  "ok": true,
  "service": "dionysus-api"
}
```

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

创建 goal 请求：

```json
{
  "title": "完整实现 Coupon SaaS 系统",
  "description": "读取 Coupon 文档和 HTML，持续推进开发。",
  "targetRoot": "/Volumes/MacMiniSSD/code/Coupon"
}
```

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

`detect-milestones` 只接受已经通过 integration、patch 已 applied、测试状态 passed 且存在变更文件的结果。创建出的 milestone 必须进入 `candidate`，之后必须经过 E2E。

`codex-verdict` 必须遵守 milestone 状态机：`passed` 只能从 `e2e_running` 进入；如果 Codex 或 Master 试图从 `candidate` 或 `e2e_required` 直接标记 `passed`，API 必须返回 `409 INVALID_MILESTONE_TRANSITION`。

## E2E

```text
GET /api/e2e/campaigns
GET /api/e2e/campaigns/:id/cases
POST /api/e2e/cases/:id/result
```

E2E campaign 由 Dionysus 生成用例草案，由 Codex 执行浏览器级测试并提交 verdict。

每条 E2E case 必须可记录执行结果：`passed`、`failed`、`blocked`、`skipped`，同时保存失败原因与证据 JSON。Campaign 状态必须由 case 状态自动汇总，不能靠人工口头判断。

## Notifications

```text
POST /api/notifications
POST /api/notifications/:id/deliver
```

通知创建和投递必须都落库；console 投递用于 Codex 会话内反馈，email/Telegram 后续扩展。

## CLI

```text
POST /api/cli/probe
GET /api/cli/models
POST /api/cli/validate-model
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

## Gatekeeper

```text
POST /api/goals/:id/gate-check
```

Codex CLI 必须覆盖完整 goal 生命周期入口，不能要求 Codex 手写 `curl`。最低命令集：

```text
pnpm dionysus goal intake --goal-id "<goal-id>"
pnpm dionysus goal bootstrap --goal-id "<goal-id>"
pnpm dionysus goal preflight --goal-id "<goal-id>"
pnpm dionysus goal gate-check --goal-id "<goal-id>"
pnpm dionysus goal remediation --goal-id "<goal-id>"
pnpm dionysus goal remediation-patch --goal-id "<goal-id>"
pnpm dionysus goal master-step --goal-id "<goal-id>"
pnpm dionysus goal release-ready --goal-id "<goal-id>"
pnpm dionysus integration list --goal-id "<goal-id>"
```

Codex 也必须有一个高层单步循环命令：

```text
pnpm dionysus goal run-cycle --goal-id "<goal-id>" --target-url "<local-url>" --run-e2e --mode strict
```

`run-cycle` 必须顺序执行 preflight、master-step、detect-milestones，返回当前 blocker、nextOwner、nextActions。提供 `target-url` 时，它可以为待验收 milestone 创建或复用 E2E campaign；只有显式传入 `--run-e2e` 才运行浏览器测试，且 `strict` 模式不得伪造产品主路径通过。

## Patch Queue

```text
POST /api/patches
```
