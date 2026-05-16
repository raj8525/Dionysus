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
POST /api/milestones/:id/request-e2e
POST /api/milestones/:id/codex-verdict
```

## Notifications

```text
POST /api/notifications
```

## CLI

```text
POST /api/cli/probe
GET /api/cli/models
```
