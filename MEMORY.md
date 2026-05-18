# Dionysus 项目记忆

本文件用于保存上下文压缩前的交接记录、重要决策和当前进度。未来会话继续开发 Dionysus 前，应先阅读 `AGENTS.md`，再阅读本文件的最新记录。

## 2026-05-18 交接记录

### 长期记忆规则

- 用户明确要求：每次上下文压缩前，必须把此前完整上下文、关键决策、当前状态、未完成事项写入项目根目录 `MEMORY.md`。
- 如果 `MEMORY.md` 不存在，必须新建；`AGENTS.md` 必须记录“部分长期记忆保存在 `MEMORY.md`，恢复上下文时先读它”。
- 当前 Dionysus 仓库已满足：根目录存在 `MEMORY.md`，且 `AGENTS.md` 已写入该规则。
- Coupon 目标仓库同样已满足：根目录存在 `MEMORY.md`，且 `AGENTS.md` 已写入该规则。

### 当前进行中的 Dionysus 修复

- 已确认 Dionysus 最新 runtime 健康，`codex heartbeat` 当前无 pending outbox。
- 已确认 Coupon 目标仓库 readiness 正常。
- 发现待修复缺口：Dionysus release record 已把目标标记为 `done`，但 `fastlane status` 仍会展示历史残留 worker/reviewer/integration 计数，容易误导 Codex 以为已发布目标还有待执行工作。
- 已实现 release 收口规则：当 Codex 记录 `passed + pushed` 的 release 后，Dionysus 会关闭或忽略该 goal 下已被发布结果取代的残留任务和集成队列。
- 已补充核心规则 `shouldCloseOutstandingWorkAfterRelease`，支持对已是 `done` 的目标重新记录 release 时也能做收口 reconcile。
- 已补充仓储层收口：残留非 `done/cancelled` task 进入 `cancelled`，相关 running run 收口，`queued/running` integration 进入 `cancelled`，待处理 patch 进入 `rejected`，并写入 `goal.release_cleanup_applied`。
- 已补充 `fastlane status` 关闭态：`done/failed/cancelled` 目标不再把历史残留 worker/reviewer/integration 计数展示为可执行工作。
- 已更新 `docs/specs/api.md` 与 `docs/specs/state-machine.md`。
- 已通过 `pnpm typecheck` 与 `pnpm test`，当前测试为 49 个文件、212 个测试通过。
- 下一步：重启 Dionysus runtime，用真实数据库重新记录已完成 Coupon release，确认 `fastlane status --goal-id 210e7d46-daf4-44a5-a460-d384a5ea2fba` 不再显示残留可执行计数；然后提交并推送。

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

## 2026-05-18 上下文压缩恢复记录

### 本次压缩恢复后的硬性规则

- 用户再次明确要求：每次上下文压缩前，必须把此前完整上下文、关键决策、当前状态、未完成事项写入项目根目录 `MEMORY.md`。
- 如果上下文是自动压缩导致的，恢复后必须先读取本文件，再把压缩摘要中的最新状态追加到本文件。
- `AGENTS.md` 已补强该规则：压缩前写入 `MEMORY.md`，压缩恢复后第一件事读取并续写 `MEMORY.md`。

### 当前 Coupon fast lane 目标

- Coupon 目标仓库：`/Volumes/MacMiniSSD/code/Coupon`。
- 当前 Dionysus goal：`017508c1-e8a2-4327-b1af-14a0f4008e03`。
- 标题：`D1成员基线只读闭环`。
- 目标：让最终用户在身份与权限页面看到 PostgreSQL 中真实租户成员、部门和角色绑定数据；本轮坚持数据先行和只读闭环，不实现新增、编辑、停用、重置密码写路径。
- 当前阶段：fast lane。

### 当前任务与风险

- Worker 1 数据基础任务：`6d5897f7-3eff-4985-871b-235f2755ad9e`。
- Worker 2 只读 API 任务：`a4e267b7-a8e7-4106-a106-fc83007feca8`。
- Worker 3 Vue 只读页面任务：`c6e823ec-517e-46c0-bc9e-1363d26482ab`。
- Reviewer 任务：`7ddba9da-7ef0-462e-98bb-893fec3818de`。
- WorkerA 第一次运行 `179270e3-59ce-48e9-bb32-aca366fc5a3a` 产出的 patch 已被 Codex 以 45 分拒绝，但 integration 曾误放行并污染 Coupon 工作区。
- WorkerB 第二次运行 `257b6f81-6ecd-4344-8a1a-0a9bb7b13b63` 正在重试；已知风险是它在隔离工作区中修改了 `apps/admin-api/internal/handler/admin/identity/identity_handler.go`，超出 Worker 1 数据基础任务范围。

### Dionysus 自身需要关注的缺陷

- Integration 曾把被 Codex 后续拒绝的 WorkerA patch 应用到 Coupon 工作区，说明现有流程仍存在“先污染目标仓库，再等 Codex 复核”的风险。
- 如果 WorkerB 的超范围 API 改动仍被 integration 放行，必须修复 Dionysus allowlist / integration guardrail。
- 正确行为是：Worker 1 只允许改 migration、规格、领域文档和测试证据；API handler 改动必须进入 Worker 2 任务。

### 下一步

1. 查询 WorkerB 运行结果：
   - `pnpm -s dionysus agent status --goal-id 017508c1-e8a2-4327-b1af-14a0f4008e03`
   - `pnpm -s dionysus run logs --run-id 257b6f81-6ecd-4344-8a1a-0a9bb7b13b63`
   - `pnpm -s dionysus integration list --goal-id 017508c1-e8a2-4327-b1af-14a0f4008e03`
2. 如果超范围 patch 被放行，优先修 Dionysus integration guardrail。
3. 如果 WorkerB 数据 patch 干净，先人工审查 SQL，再用真实 PostgreSQL 验证 migration。
4. Coupon 中被拒绝的 `migrations/039_d1_member_baseline_dataoundation.sql` 不能进入正式提交。
