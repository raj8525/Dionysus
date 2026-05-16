# 架构契约

## 总体结构

```text
Codex
  -> Dionysus API / CLI
  -> Master Orchestrator
  -> RabbitMQ
  -> Agent Runtime
  -> CLI Adapter
  -> isolated workspace
  -> patch
  -> Integration Queue
  -> main
  -> Milestone Detector
  -> Codex E2E
  -> Notification
```

## 核心约束

- PostgreSQL 是唯一事实源。
- RabbitMQ 只负责异步投递，不保存最终状态。
- Git 只负责代码审计，不负责任务状态。
- Worker 并发靠 workspace 和 patch queue，不靠长期 feature 分支。
- 前端只负责可视化和配置，不承担核心调度逻辑。

## MVP 模块

- `apps/api`：Fastify API。
- `apps/web`：React Flow UI。
- `apps/worker`：RabbitMQ consumer 和 Agent Runtime。
- `packages/core`：领域类型、状态机、任务规则。
- `packages/db`：PostgreSQL 连接、migration、repository。
- `packages/mq`：RabbitMQ 封装。
- `packages/cli-adapters`：MockAdapter 和后续真实 CLI adapter。
