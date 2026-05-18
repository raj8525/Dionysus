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
- Worker / Integration 必须使用当前 goal 的 `targetRoot`，不得回退到全局默认目录处理其他项目。
- Worker 只能在 Dionysus 创建的 isolated workspace 中写入文件；`Target Root` 只作为来源上下文，不是可写目录。
- 创建 isolated workspace 时，必须以目标工作区当前状态为基线：除已提交 `HEAD` 外，还要同步目标工作区中的未提交 tracked diff 和 untracked 文件，并在 workspace 内提交为 `dionysus workspace baseline`。这样后续 API/Vue/Reviewer 任务能看到已通过 integration 但尚未由 Codex 提交的前序 Worker 成果，同时生成 patch 时不会重复包含这些既有改动。
- Worker prompt 必须显式写出 `Workspace Root`，并禁止通过 `Target Root` 绝对路径绕过 workspace。
- 如果 workspace baseline 同步了目标工作区未提交改动，Agent prompt 必须包含 `Workspace Baseline Evidence`，提醒 ReviewerCLI 按当前 workspace 内容审核，不得只按目标仓库 `HEAD` 判断。
- Integration apply 后必须同时记录 patch 级 `changedFiles` 和结果级 `result.changedFiles`，新增文件也必须被审计到。
- 前端只负责可视化和配置，不承担核心调度逻辑。

## MVP 模块

- `apps/api`：Fastify API。
- `apps/web`：React Flow UI。
- `apps/worker`：RabbitMQ consumer 和 Agent Runtime。
- `packages/core`：领域类型、状态机、任务规则。
- `packages/db`：PostgreSQL 连接、migration、repository。
- `packages/mq`：RabbitMQ 封装。
- `packages/cli-adapters`：MockAdapter 和后续真实 CLI adapter。
