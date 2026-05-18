# Dionysus 项目记忆

本文件用于保存上下文压缩前的交接记录、重要决策和当前进度。未来会话继续开发 Dionysus 前，应先阅读 `AGENTS.md`，再阅读本文件的最新记录。

## 2026-05-18 交接记录

### 当前状态

- Dionysus 位于 `/Volumes/MacMiniSSD/code/Dionysus`，目标项目试点为 `/Volumes/MacMiniSSD/code/Coupon`。
- 当前 runtime 健康：API、PostgreSQL、RabbitMQ、Worker heartbeat 均可用。
- Coupon readiness 已通过，角色 CLI 配置均为真实 CLI：
  - Master: `claude_code`
  - RuleWriter: `gemini_cli`
  - TestWriter: `opencode`，模型 `minimax-cn-coding-plan/MiniMax-M2.7`
  - Worker: `opencode`，模型 `minimax-cn-coding-plan/MiniMax-M2.7`
- 当前策略仍是 `Codex-directed fast lane`，不追求 Paperclip 式自组织；Codex 控制目标、质量门禁、E2E 和发布。

### 本轮修复

- 发现真实问题：`codex outbox` 中有陈旧 pending blocker，尤其是任务被取消或目标关闭后仍会误导 Codex。
- 发现状态机问题：Worker 任务被取消后，如果之前的 CLI run 延迟完成，`completeTaskRun` 仍可能把 task 从 `cancelled` 改回 `needs_review`。
- 已新增状态机规则：
  - `deriveTaskStatusAfterRunCompletion` 会保留 `cancelled`、`done`、`blocked` task，不让晚到的 run 复活任务。
  - 已关闭 run 的重复完成回调记录 `task.run_completion_ignored`。
  - `codex outbox reconcile` 会自动关闭 payload 中 `taskId` 指向 `done/cancelled` task 的 blocker。
- 已更新 `docs/specs/state-machine.md` 记录该门禁。

### 已通过验证

- `pnpm exec vitest run packages/core/src/state-machine.test.ts packages/core/src/codex-outbox.test.ts`
- `pnpm typecheck`
- `pnpm test`：49 个测试文件，208 个测试通过。

### 真实数据库验证

- 已重启 Dionysus runtime，API / Worker 使用当前代码运行。
- 已重新取消任务 `590dcb47-b662-4fe0-a52d-1d6657816819`，状态正确变为 `cancelled`。
- 已执行 `pnpm -s dionysus codex reconcile`，自动 ack 当前 D1 goal 的陈旧 blocker `43fd5272-e573-4d68-86ad-1f8c6c43e869`。
- 已为 Coupon commit `e17d179` 写入 release record `58d65bcf-2337-4a3c-99b5-a99e13c988b4`，D1 租户编辑/冻结/启用闭环发布证据已进入 Dionysus。
- 已取消过时宽目标：
  - `b09820e9-d237-4c00-93a1-dc4c264e488e`
  - `fac710c3-e31b-4d56-a0d1-3b67b83262e6`
  - `5676b73a-9ea6-455c-89bc-6885ad9542a5`
- 已再次执行 `pnpm -s dionysus codex heartbeat --limit 5`，当前没有待 Codex 介入的 Outbox 事件。

### 下一步

- 提交并推送本轮 Dionysus 改动。
- 下一轮应基于干净 Outbox 选择 Coupon 的下一个单模块闭环，不再启用多模块大范围 goal。
