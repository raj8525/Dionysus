# API 契约

## Health

```text
GET /health
```

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
GET /api/goals/:id/findings
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

## E2E

```text
GET /api/e2e/campaigns
```

E2E campaign 由 Dionysus 生成用例草案，由 Codex 执行浏览器级测试并提交 verdict。

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
```

## Gatekeeper

```text
POST /api/goals/:id/gate-check
```

## Patch Queue

```text
POST /api/patches
```
