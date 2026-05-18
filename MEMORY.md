# Dionysus 项目记忆

本文件用于保存上下文压缩前的交接记录、重要决策和当前进度。未来会话继续开发 Dionysus 前，应先阅读 `AGENTS.md`，再阅读本文件的最新记录。

## 2026-05-18 runtime heal 旧 commit 自愈修复

### 背景

- Dionysus 曾出现“代码已提交并推送，但 API / Worker runtime 仍运行旧 commit”的情况。
- 原 `pnpm dionysus system runtime heal` 只检查 pid、进程和 worker 心跳是否 stale；如果进程健康、心跳正常，即使 worker 心跳中的 `codeCommitSha` 不是当前仓库 HEAD，也会返回 `no_action`。
- 这会让 Codex 误以为新门禁已经生效，实际 Worker 仍可能使用旧逻辑继续污染目标仓库。

### 已完成

- 已按 TDD 添加失败测试：健康 runtime 但 worker `runtime.codeCommitSha` 落后于当前 HEAD 时必须返回 `restart`。
- 已修复 `buildRuntimeHealPlan`：支持传入 `currentCodeCommitSha`，并比较 `/health.worker.runtime.codeCommitSha`、兼容旧的 `metadata.codeCommitSha` / `worker.codeCommitSha`。
- 已修复 CLI `system runtime heal`：执行前读取当前 Dionysus 仓库 `git rev-parse HEAD`，并把该 commit 传入 heal plan；输出中包含 `currentCodeCommitSha`，方便 Codex 审计。
- 已更新 `AGENTS.md` 与 `docs/specs/api.md`，明确 runtime 旧 commit 也属于必须 heal 的条件。

### 已验证

- 红灯：新增测试先失败，原行为返回 `no_action`。
- 绿灯：`pnpm exec vitest run tools/dionysus-runtime.test.ts` 通过。
- 局部回归：`pnpm exec vitest run tools/dionysus-runtime.test.ts tools/dionysus-doctor.test.ts` 通过。
- 类型检查：`pnpm typecheck` 通过。

### 下一步

- 跑全量 `pnpm test`。
- 提交并推送 Dionysus。
- 提交后运行 `pnpm -s dionysus system runtime heal`，确认当前 runtime 如果仍在旧 commit，会被自动重启。

### 完成结果

- 全量验证通过：`pnpm test` 通过，49 个测试文件、224 个测试。
- 已提交并推送 commit `1a23864 fix(runtime): restart stale commit runtime`。
- 真实自愈验证通过：提交后运行 `pnpm -s dionysus system runtime heal`，系统识别 worker runtime 仍在旧 commit `a1850f53e2daddf44ffde27bed8ec7f62a2066ac`，当前 HEAD 为 `1a23864001378c0f9a6b838d4158f46e9f809694`，自动执行 restart。
- `pnpm -s dionysus system doctor --brief` 通过，worker runtime `codeCommitSha` 已更新为 `1a23864001378c0f9a6b838d4158f46e9f809694`，API、PostgreSQL、RabbitMQ、Worker 均健康。

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

## 2026-05-18 压缩后续写记录

### 当前事实

- 已按用户要求再次确认长期记忆规则：上下文压缩前必须写入本文件，压缩恢复后必须先读本文件并续写最新事实。
- Coupon 当前工作区已恢复干净：`## main...origin/main`。
- Dionysus 当前工作区有未提交的集成门禁修复：
  - `apps/worker/src/worker.ts`
  - `docs/specs/state-machine.md`
  - `packages/core/src/integration-applier.test.ts`
  - `packages/core/src/integration-applier.ts`
- 修复目标：Integration Worker 自动应用 patch 前必须要求至少一个验证命令；没有验证命令时返回 `blocked`，不修改目标工作区。
- 已通过局部测试：
  - `pnpm exec vitest run packages/core/src/integration-applier.test.ts packages/core/src/dispatch-policy.test.ts`
  - 结果：2 个测试文件、12 个测试通过。
- 本轮 Dionysus 修复已完成全量验证：`pnpm typecheck` 通过，`pnpm test` 通过（49 个测试文件、213 个测试）。
- 尚未完成本轮 Dionysus 修复的提交、推送和 runtime 重启。

### 当前 Coupon fast lane 运行状态

- Goal ID：`017508c1-e8a2-4327-b1af-14a0f4008e03`
- 当前任务：`FastLane Worker 1: D1成员基线 数据基座`
- 当前尝试：attempt 3 / max_attempts 3。
- WorkerC run id：`affedf97-56f4-46d3-8c15-5f3793fd5906`，仍在运行。
- WorkerB patch `ea4881dd-309b-44b2-b08a-99ad2cc6866d` 已被 integration 拦截，原因是触碰了不允许的 API handler 文件。
- WorkerA patch `9984cf0f-94c9-4bc3-961a-159cf963280c` 曾被旧 integration 应用，但已被 Codex 拒绝，Coupon 工作区已清理。

### 下一步

1. 继续轮询 WorkerC run logs 和 integration list。
2. 如果 WorkerC 产出 patch，必须先看 integration 状态、changedFiles、verificationCommands，再决定是否接受。
3. 如果 WorkerC 失败或输出不可信，Codex 接手 Worker 1 数据基座任务。
4. 完成 Dionysus 集成门禁修复的 `pnpm typecheck` 与 `pnpm test`，通过后提交、推送并重启 runtime。

## 2026-05-18 Codex 接手任务回写机制

### 背景

- Coupon D1 成员数据基座 Worker 多次失败后由 Codex 接手完成，并已在 Coupon `main` 提交 `7a5b292 feat(identity): add d1 member data foundation`。
- 原 Dionysus fast lane 只认“数据基座 Worker 状态为 done”，而该 Worker 已被取消，导致 API/Vue 只读 Worker 被 `COUPON_DATA_FIRST_GATE_BLOCKED` 阻止入队。

### 已改进

- 新增 `task codex-complete` API/CLI：Codex 接手并完成任务后，可用证据把任务标记为 `done`。
- 该入口会记录 `task.codex_complete` 事件，并复用 `dispatchNextTaskAfterReview` 触发后续任务分发。
- 已同步更新 Dionysus `AGENTS.md` 和本地 `/Users/yangyu/.codex/skills/dionysus/SKILL.md`。

### 当前用途

- 对 Coupon 目标 `017508c1-e8a2-4327-b1af-14a0f4008e03`，下一步应对数据基座任务 `6d5897f7-3eff-4985-871b-235f2755ad9e` 执行 `task codex-complete`，证据包含 Coupon commit `7a5b292`、PostgreSQL 视图计数和 GitNexus detect-changes low。

## 2026-05-18 上下文压缩恢复记录

### 当前事实

- `task codex-complete` 已在 Dionysus `main` 提交并推送：`e0fc889 feat(tasks): allow codex completion handoff`。
- Dionysus API / worker runtime 已通过 `pnpm -s dionysus system runtime heal` 重启，doctor 显示 worker runtime commit 为 `e0fc88956a8e09ce276da7bbcae94508b615412a`。
- 已对 Coupon goal `017508c1-e8a2-4327-b1af-14a0f4008e03` 的数据基座任务 `6d5897f7-3eff-4985-871b-235f2755ad9e` 执行 `task codex-complete`，并触发后续任务。
- 当前后续任务：
  - API 只读任务：`a4e267b7-a8e7-4106-a106-fc83007feca8`，run `f4ad05f5-0016-406e-b5ac-d7f5405fd554`，压缩前仍在运行。
  - Vue 只读页面任务：`c6e823ec-517e-46c0-bc9e-1363d26482ab`，run `5f0693c4-60da-43bf-a29a-85afa1f9bdc9`，integration 已应用到 Coupon，任务状态为 `needs_review`。
- Coupon 工作区当前有 Dionysus Vue patch：`apps/admin-web/src/pages/identity/members.vue` 修改中，尚未通过 Codex review / E2E，不得提交。

### 下一步

1. 查询 `agent status` 和 `integration list`，确认 API Worker 是否完成并产生可审查 patch。
2. 若 API Worker 完成，审查 API + Vue patch，并运行对应测试。
3. 如果 API Worker 长时间停滞或失败，按用户规则由 Codex 接手，但必须记录接手原因和证据。
4. D1 成员只读闭环必须通过浏览器 E2E 后才可提交 Coupon。

## 2026-05-18 Reviewer workspace 同步缺陷记录

### 当前事实

- Coupon goal `017508c1-e8a2-4327-b1af-14a0f4008e03` 的 API Worker 和 Vue Worker 已完成并被 Codex 验收。
- ReviewerCLI run `bcbc4def-1fbc-437a-bdd2-c3a8dea9bc56` 输出 `BLOCKED / 35`，但其核心结论是误报：它声称 `ListMembers` 未读取 `v_identity_members`。
- 目标工作区真实代码已经读取 `v_identity_members`，真实 PostgreSQL API curl 和浏览器 E2E 均证明成员姓名、手机号、角色、部门已正确返回和展示。
- Codex 已在 Dionysus 中使用 `task review approve --score 91` 覆盖 ReviewerCLI 误判，并记录原因：Reviewer 隔离 workspace 未同步已集成 patch。

### Dionysus 后续修复方向

- Reviewer 任务启动前必须基于目标工作区当前状态重新创建或 rebase workspace。
- Reviewer prompt 中必须包含当前已应用 integration ids、changed files、目标工作区 commit/dirty diff 摘要。
- Reviewer 若发现与 Codex/目标工作区证据冲突，应先读取目标工作区或 integration evidence，而不是只信自己的隔离 workspace。
- 对 `BLOCKED` Reviewer 结论增加 Codex evidence override 机制，要求记录“为何覆盖 Reviewer 结论”。

## 2026-05-18 上下文压缩后恢复记录

### 当前待收尾

- 本轮压缩发生在 Coupon D1 成员只读闭环验收完成之后、提交之前。
- Dionysus 工作区当前仅有 `MEMORY.md` 修改，用于记录 Reviewer workspace 未同步导致的误判。
- 该缺陷是 Dionysus fast lane 的关键流程问题：ReviewerCLI 必须在 review 前看到目标工作区当前已集成 patch，否则会持续产出过期结论。

### 下一步

1. 提交并推送 Dionysus `MEMORY.md`。
2. 后续开发 Dionysus 时优先修复 Reviewer workspace sync/rebase 和 review prompt evidence。
3. Coupon 本轮提交后应写入 Dionysus release record，标记 goal `017508c1-e8a2-4327-b1af-14a0f4008e03` 已通过 Codex E2E。

## 2026-05-18 Reviewer workspace baseline 修复记录

### 当前事实

- 已确认 ReviewerCLI 误判的根因：Dionysus 使用 `git clone` 创建 isolated workspace，只复制目标仓库 `HEAD`，不会复制 integration 已应用但 Codex 尚未提交的目标工作区改动。
- 已按 TDD 修复：
  - 新增 workspace 测试，复现目标工作区 tracked diff 与 untracked 文件无法进入 reviewer workspace 的问题。
  - `createIsolatedWorkspace` 现在会同步目标工作区当前 tracked diff 和 untracked 文件，并在 workspace 内提交为 `dionysus workspace baseline`。
  - 同步后的既有改动不会出现在 Worker 生成的新 patch 中，避免重复集成。
  - `.dionysus-workspace` 记录 `synced_target_changes=true/false`。
  - `workspace.created` task event 记录 `syncedTargetChanges`。
  - Role prompt 在同步过目标未提交改动时加入 `Workspace Baseline Evidence`，提醒 Reviewer 不得只按目标仓库 `HEAD` 判断。

### 已验证

- `pnpm exec vitest run packages/core/src/workspace.test.ts packages/core/src/role-prompt.test.ts` 通过。
- `pnpm typecheck` 通过。
- `pnpm test` 通过：49 个测试文件、215 个测试。

### 下一步

- 提交并推送该 Dionysus 修复。
- 后续再跑 Coupon fast lane 时，ReviewerCLI 应能看到前序 integration 已应用但未提交的成果，降低“基于旧代码误判”的概率。

## 2026-05-18 上下文压缩恢复记录：Coupon D1 角色权限只读闭环

### 本次恢复后必须记住的规则

- 用户再次明确要求：每次上下文压缩前，必须把此前完整上下文、关键决策、当前状态、未完成事项写入项目根目录 `MEMORY.md`。
- 如果上下文自动压缩，恢复后第一件事必须读取 `AGENTS.md` 和 `MEMORY.md`，再把压缩摘要中的最新状态追加到 `MEMORY.md`。
- Dionysus `AGENTS.md` 已包含该规则；本条记录用于补齐本次压缩后的最新运行状态。

### 已完成的 Dionysus 修复

- 已提交并推送 commit `40789d7 fix(runtime): sync target worktree into agent workspaces`。
- 修复内容：
  - `createIsolatedWorkspace` 会同步目标工作区当前 tracked diff 和 untracked 文件，并提交为 `dionysus workspace baseline`。
  - `.dionysus-workspace` 记录 `synced_target_changes=true/false`。
  - Worker task event 记录 `syncedTargetChanges`。
  - Role prompt 在同步过目标未提交改动时加入 `Workspace Baseline Evidence`。
- 已验证：
  - `pnpm exec vitest run packages/core/src/workspace.test.ts packages/core/src/role-prompt.test.ts` 通过。
  - `pnpm typecheck` 通过。
  - `pnpm test` 通过，49 个测试文件、215 个测试。
- Dionysus runtime 已重启，`system doctor --brief` 显示 worker runtime commit 为 `40789d7c41a8b61471a954bc7b7b41027a7105bc`。

### 当前 Coupon fast lane 目标

- Goal ID：`b6d57422-4efb-4cd9-af70-6bb0c59ea516`
- 标题：`D1角色权限只读闭环`
- 目标：让最终用户在 `identity/roles` 页面看到 PostgreSQL-backed 的真实角色、权限点和角色权限矩阵，只读展示，不实现新增、编辑、删除、授权写路径。
- 当前有效 Worker CLI：OpenCode，模型 `minimax-cn-coding-plan/MiniMax-M2.7`。

### 当前任务与运行

- 后端 Worker 任务：`f9f2b507-fb60-4af5-b02d-5a130da432a2`
  - Assigned Agent：`WorkerC`
  - Run ID：`1da1a8a7-cfde-45db-b92f-414ab1d85ff7`
  - 压缩前状态：`running`
  - 允许修改范围：`apps/admin-api/internal/handler/admin/identity/identity_handler.go`、`apps/admin-api/internal/handler/admin/identity/identity_handler_test.go`
- 前端 Worker 任务：`160b49d6-fd8d-49cd-928d-41625003a7c6`
  - Assigned Agent：`WorkerD`
  - Run ID：`edebd0cc-b956-4078-89e4-77261a7a8be1`
  - 压缩前状态：`running`
  - 允许修改范围：`apps/admin-web/src/pages/identity/roles.vue`
- Reviewer 任务：`aacda8ba-f8f4-4c18-9e99-d55765801614`
  - 压缩前状态：`created`，尚未入队。

### 下一步

1. 轮询 `agent status`、`integration list` 和两个 run logs。
2. Worker patch 完成后检查文件范围与质量，不得跳过 Codex 审查。
3. 两个 Worker 任务都完成后再入队 Reviewer。
4. Reviewer 通过后由 Codex 在 Coupon 中执行 Go 测试、前端 build、浏览器 E2E、提交、推送和 release record。

## 2026-05-18 上下文压缩恢复记录：Coupon D1 角色权限闭环继续

### 本次恢复后新增事实

- Coupon 目标仓库已按用户要求继续维护 `MEMORY.md`，并在本次压缩恢复后追加最新状态。
- Dionysus goal `b6d57422-4efb-4cd9-af70-6bb0c59ea516` 正在推进 `D1角色权限只读闭环`。
- 后端 Worker 任务 `f9f2b507-fb60-4af5-b02d-5a130da432a2` 已完成并集成到 Coupon 工作区。
- 前端 Worker 任务 `160b49d6-fd8d-49cd-928d-41625003a7c6` 第一轮因越权生成 `package-lock.json` 被 Codex 拒绝；第二轮 run `c47bd27d-644e-4e5b-bfc3-cf5adfaefdfe` 压缩前仍需轮询。
- Dionysus 暴露出 fast lane 缺陷：单个 Worker approve 后过早调度 Reviewer。原 Reviewer 任务 `aacda8ba-f8f4-4c18-9e99-d55765801614` 已被取消。后续应修复调度策略，确保所有必要 Worker 完成后再进入 Reviewer。

### 下一步

1. 在 Dionysus 中继续查询 frontend run `c47bd27d-644e-4e5b-bfc3-cf5adfaefdfe` 和 integration list。
2. 如果前端集成通过，由 Codex 审查 Coupon `roles.vue` 是否真正动态读取真实接口、保留只读目标、符合 D1 页面体验。
3. 通过后再执行 Reviewer 或 Codex final review，并记录所有 release / E2E 证据。
4. 后续 Dionysus 需要补一个调度测试：Reviewer 不得在同一 goal 的 required Worker 全部 done 前自动启动。

## 2026-05-18 Coupon D1 角色权限闭环运行复盘

### 当前结果

- Goal `b6d57422-4efb-4cd9-af70-6bb0c59ea516` 已完成 Worker 与 Reviewer 阶段。
- 后端 Worker 通过并集成；前端 Worker 第一轮因越权生成 `package-lock.json` 被拒绝，第二轮通过并集成。
- Reviewer 1 被取消，原因是 Dionysus 在后端 Worker done 后过早调度 Reviewer，前端尚未完成。
- Reviewer 2 初评 88 分，指出 `features_test` 缺少 `permissions[]` 字段结构 BDD 断言。
- Codex 已在 Coupon `features_test/d1-identity-module.feature.md` 补充 BDD 场景，并将 Reviewer 2 按 92 分批准。

### 验证证据

- Coupon 已通过：
  - `go test ./apps/admin-api/internal/handler/admin/identity -count=1`
  - `go test ./... -count=1`
  - `pnpm --filter @coupon/admin-web build`
  - 浏览器 E2E `/identity/roles`：7 个角色、租户管理员 7 个权限、3 个高危权限、无新增入口，截图 `/tmp/coupon-d1-roles-e2e.png`
- GitNexus：
  - `impact ListRoles` 为 HIGH，影响集中在 identity role list handler 路由链。
  - `detect-changes` 为 medium，受影响流程集中在 `IdentityRoleListHandler → RoleItem`。

### Dionysus 待改进

- fast lane Reviewer 调度必须增加“全部必要 Worker done”门禁，不能任一 Worker approve 后立即跑 Reviewer。
- Reviewer 分数低于 90 但 verdict 写 PASS 时，Dionysus/Codex 应按分数门禁处理为未通过，除非 Codex 修复扣分项并记录批准原因。
- Worker 隔离 workspace 的前端依赖验证仍会诱导 Agent 尝试 `npm install`；后续应在 prompt 或 workspace 准备阶段提供正确的 `NODE_PATH` / 构建命令证据，避免生成 `package-lock.json`。

## 2026-05-18 上下文压缩恢复记录：记忆规则确认

### 本次恢复后新增事实

- 用户要求：每次上下文压缩前，必须把完整交接上下文写入项目根目录 `MEMORY.md`；如果不存在则新建，同时在 `AGENTS.md` 中记录历史记忆位置。
- Dionysus 的 `AGENTS.md` 已记录：长期上下文、压缩前交接记录和重要历史决策保存在根目录 `MEMORY.md`；压缩恢复后第一件事是读取并追加最新状态。
- 本次压缩恢复后已读取 Dionysus `AGENTS.md` 和 `MEMORY.md`，并在此处追加恢复记录。

### 下一步

1. 继续修复 Dionysus fast lane：Reviewer 不得在同一 goal 的必要 Worker 全部 `done` 前启动。
2. 补充 TDD 测试，覆盖 Reviewer 过早调度和低于 90 分不得批准的门禁。
3. 优化 Worker / Reviewer prompt，避免前端任务诱导 CLI 执行 `npm install` 并生成 `package-lock.json`。

## 2026-05-18 Dionysus fast lane 调度修复记录

### 完成内容

- 修复 API review 自动调度缺陷：`dispatchNextTaskAfterReview` 不再在任意一个 `FastLane Worker` approve 后直接拉起 `FastLane Reviewer`。
- 新增 `selectFastLaneReviewerFollowupTasks`：只有同一 goal 的全部 `FastLane Worker` 都为 `done`，才允许选择 `created` 状态的 `FastLane Reviewer`。
- 保留 Coupon 数据先行门禁：数据基座 Worker approve 后仍会优先并发派发只读 API / Vue 只读首页 Worker。
- 如果下一个 created 任务是 Reviewer 但 Worker 尚未全部完成，API 会记录 `review.fastlane_reviewer_held` 事件并停止调度。
- 优化前端 Worker prompt：当任务涉及 `apps/admin-web` 或 `@coupon/admin-web` 时，明确禁止 `npm install`、禁止生成/修改 `package-lock.json`，建议使用 `pnpm --filter @coupon/admin-web build`；如果 isolated workspace 缺依赖，则报告 blocker，由 Codex 在目标项目根执行最终验证。

### 测试证据

- 先写失败测试并确认红灯：
  - `packages/core/src/coupon-data-first-gate.test.ts` 新增 Reviewer 不得过早启动测试，初始失败为 `selectFastLaneReviewerFollowupTasks is not a function`。
  - `packages/core/src/role-prompt.test.ts` 新增前端依赖门禁测试，初始失败为缺少 `## 前端依赖与构建门禁`。
- 绿灯验证：
  - `pnpm exec vitest run packages/core/src/coupon-data-first-gate.test.ts packages/core/src/task-review.test.ts packages/core/src/role-prompt.test.ts` 通过，22 个测试。
  - `pnpm typecheck` 通过。
  - `pnpm test` 通过，49 个测试文件、218 个测试。

### 下一步

1. 重启 Dionysus runtime，确保 API / Worker 使用包含该调度修复的新代码。
2. 下一轮 Coupon fast lane 应观察：API/Vue Worker 未全部 done 前，Reviewer 任务只保持 `created`，不会被自动排队。

## 2026-05-18 Dionysus Agent usage 全量展示修复记录

### 完成内容

- 补齐 `/api/usage/agent-cli` 的 Agent 实例基线：返回值会合并 `agents` 表中的全部内置 Agent，即使某个 Agent 尚未产生任何 `task_runs`，也会以 `cliCalls=0`、`modelCalls=0` 出现在 `byAgentInstance` 中。
- `AgentInstanceCliUsage` 增加 `agentStatus` 字段，Dashboard 的按 Agent 实例卡片会显示空闲、工作中、阻塞或禁用状态。
- 历史上未绑定 `agent_id` 的 run 会显示为“历史未绑定 Master/Worker/...”，避免和真实 Master、WorkerA-D 实例混淆。
- 更新 `docs/specs/api.md`，明确 usage 接口必须展示 Master、RuleWriter、TestWriter、WorkerA-D 的全貌，而不是只展示已经调用过 CLI 的 Agent。

### 测试证据

- 先写失败测试：`packages/core/src/agent-cli-usage.test.ts` 要求无调用的 `Master` / `WorkerB` 也出现在 `byAgentInstance`，初始失败，因为旧实现只返回有 run 的 `WorkerA`。
- 绿灯验证：
  - `pnpm exec vitest run packages/core/src/agent-cli-usage.test.ts apps/web/src/agent-usage-display.test.ts` 通过，10 个测试。
  - `pnpm typecheck` 通过。
  - `pnpm --filter @dionysus/web build` 通过；仅有 React Flow 依赖的 `"use client"` bundling warning，不阻塞。
  - `pnpm test` 通过，49 个测试文件、219 个测试。

### 下一步

1. 提交并推送本次 Dionysus usage 可视化修复。
2. 重启 Dionysus runtime，让 API 使用新代码。
3. 用 `pnpm dionysus agent usage --target-root "/Volumes/MacMiniSSD/code/Coupon"` 实测返回中是否包含全部 Agent 实例。

## 2026-05-18 Dionysus release record 证据门禁修复记录

### 完成内容

- 新增 release 证据门禁：`status=passed` 且 `pushed=true` 的 release record 必须包含：
  - 至少 1 个 `changedFiles`
  - 至少 1 条 `status=passed` 的验证命令
  - 非空中文/文本摘要
- API `POST /api/releases` 会在证据不足时返回 `409 RELEASE_RECORD_EVIDENCE_REQUIRED`，不得把 goal 自动置为 `done`。
- CLI `pnpm dionysus release record` 也会在本地构造 payload 阶段提前失败，避免空证据 release 写入数据库。
- 更新 `docs/specs/api.md`，把该门禁写入 API 契约。

### 测试证据

- 先写失败测试：
  - `packages/core/src/release-record.test.ts` 初始失败为 `validateReleaseRecordEvidence is not a function`。
  - `tools/dionysus-release-record.test.ts` 初始失败为缺证据 release 没有抛错。
- 绿灯验证：
  - `pnpm exec vitest run tools/dionysus-release-record.test.ts packages/core/src/release-record.test.ts` 通过，13 个测试。
  - `pnpm typecheck` 通过。
  - `pnpm test` 通过，49 个测试文件、223 个测试。
- 实际 CLI 验证：
  - 运行缺少 `--changed-file`、`--verification-json`、`--summary` 的 `pnpm dionysus release record ... --status passed --pushed true`，命令失败并返回门禁错误，没有写入 release record。

### 下一步

1. 提交并推送本次 release record 证据门禁。
2. 重启 Dionysus runtime，使 API 使用新门禁。
