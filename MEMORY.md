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

## 2026-05-18 上下文压缩恢复记录：Coupon D1 支持授权只读闭环

### 本次恢复后新增事实

- 用户再次要求：每次上下文压缩前，必须把此前完整上下文写入项目根目录 `MEMORY.md`；若文件不存在则新建，同时在 `AGENTS.md` 说明长期记忆位置。
- 已确认 Dionysus 根目录 `AGENTS.md` 和 `MEMORY.md` 均已包含该规则；本条记录保存本次压缩恢复后的最新执行状态。
- 当前 Coupon fast lane 目标：`6a9c7a31-634d-42de-ad47-40dae42f715c`，标题为 `D1支持授权只读闭环`。
- 当前目标是让 Coupon `/identity/support-grants` 页面读取 PostgreSQL 中真实 support grant 数据；本轮只做只读闭环，不做新增、审批、撤销写路径。
- 已启动三个 Worker：
  - 数据确认 Worker：任务 `241475a7-278f-451d-9ea3-1140a16ed092`，run `a82934dc-30ae-4f38-9a3e-6cb7c12b6235`，已成功，结论为数据基座可支持只读页面。
  - 后端 API Worker：任务 `60e3514a-7797-4a8c-b245-516485997858`，run `b514f01b-fcfc-4b78-8822-0191e6f638e1`，恢复时仍在运行，正在修复 `ListSupportGrants` 的租户过滤、视图读取和状态标签。
  - 前端 Vue Worker：任务 `1ac8b0ea-a8d0-4b97-8612-c75325275e3c`，run `929de992-1d5c-4306-907c-7ec0b7ad592b`，已成功但补丁集成失败。
- 前端补丁集成失败暴露 Dionysus 缺陷：`allowedFiles` 从中文任务描述中解析时把普通中文逗号后的说明误拆成路径，导致合法文件 `apps/admin-web/tests/e2e/identity-support-grants.spec.js` 被判定为越权。
- Coupon 主工作区恢复检查时仍为 clean；前端和后端 Worker 补丁尚未进入 Coupon 主工作区。

### 下一步

1. 继续轮询后端 API Worker，等待其完成或失败。
2. 修复 Dionysus allowed path 解析，或用正确允许路径重新创建前端任务。
3. 所有 Worker 补丁集成并由 Codex 审查后，才启动 ReviewerCLI 90 分门禁。
4. 最终在 Coupon 主工作区执行 Go 测试、前端构建、浏览器 E2E、GitNexus 检查，再提交并推送。

## 2026-05-18 Dionysus allowed path 解析修复记录

### 完成内容

- 修复 Worker 集成门禁的 `allowedFiles` 解析缺陷：当任务描述使用中文内联说明时，不再把 `刷新`、`状态标签`、`scope/到期时间展示` 等普通说明误判为允许路径。
- 新增 `apps/worker/src/allowed-scope.ts`，把 allowed scope 解析从 `worker.ts` 抽成可测试模块。
- 新增 `apps/worker/src/allowed-scope.test.ts`，复现并锁定以下场景：
  - `允许修改路径: apps/...vue, apps/...spec.js。参考 ...` 只提取句号前的两个真实文件路径。
  - bullet 形式的文件范围仍可被正确解析。
- 当前已通过：
  - `pnpm exec vitest run apps/worker/src/allowed-scope.test.ts`
  - `pnpm exec vitest run apps/worker/src/allowed-scope.test.ts apps/worker/src/target-root.test.ts packages/core/src/integration-applier.test.ts`
  - `pnpm typecheck`
  - `pnpm test`，50 个测试文件、226 个测试通过。

### 仍需处理

- 已失败的前端 integration 不会自动重放，因为它记录的是旧解析结果；需要在当前 Coupon goal 中重新创建前端 Worker 任务，且允许路径必须明确写为 `apps/admin-web/tests/e2e/identity-support-grants.spec.js`。
- 修复提交后需要重启 Dionysus runtime，确保后续 Worker 使用新解析逻辑。

## 2026-05-18 上下文压缩恢复记录：FastLane Reviewer 门禁继续修复

### 本次恢复后确认

- 用户新增长期规则：每次上下文压缩前，都必须把完整交接上下文写入项目根目录 `MEMORY.md`；如果没有该文件，则创建，并在 `AGENTS.md` 记录历史记忆位置。
- Dionysus 根目录 `AGENTS.md` 已经记录：长期上下文、压缩前交接记录和重要历史决策保存在 `MEMORY.md`；压缩恢复后第一件事是读取 `MEMORY.md` 并追加最新状态。
- 本次压缩恢复后已读取 Dionysus `AGENTS.md`、`MEMORY.md` 和当前 git 状态。
- 当前工作区只有 `packages/core/src/coupon-data-first-gate.test.ts` 存在本轮未提交改动。

### 当前红灯测试

- 已在 `packages/core/src/coupon-data-first-gate.test.ts` 增加测试：当旧的 `FastLane Worker` 被显式 `cancelled` 并由新的 Worker 成功替代后，不应继续阻塞 `FastLane Reviewer` 启动。
- 红灯结果：`pnpm exec vitest run packages/core/src/coupon-data-first-gate.test.ts` 失败，当前实现仍要求所有 FastLane Worker 都是 `done`，导致 cancelled superseded worker 误阻塞 reviewer。

### 下一步

1. 修改 `selectFastLaneReviewerFollowupTasks`，只把非 `cancelled` 的 FastLane Worker 视为 active worker。
2. 同步检查 CLI fastlane status 是否也有相同判断缺陷，必要时补测试和修复。
3. 跑相关测试、全量测试、更新本文件，再提交并推送 Dionysus。

## 2026-05-18 Dionysus FastLane cancelled Worker 门禁修复记录

### 完成内容

- 修复 `selectFastLaneReviewerFollowupTasks`：`cancelled` 的 FastLane Worker 被视为已显式退出/被替代，不再阻塞 Reviewer 启动。
- 保持严格门禁：非 `cancelled` 的 active Worker 只要仍是 `created`、`queued`、`running`、`needs_review`、`blocked` 或 `failed`，Reviewer 仍不会启动。
- 同步修复 `tools/dionysus-fastlane.ts` 的 `fastlane status` 判断，避免 CLI 状态显示和 API 调度逻辑不一致。
- 新增测试覆盖：旧前端 Worker cancelled、重跑 Worker done 后，Reviewer 可以进入 `ready_for_reviewer`。

### 验证结果

- `pnpm exec vitest run packages/core/src/coupon-data-first-gate.test.ts tools/dionysus-fastlane.test.ts` 通过，25 个测试。
- `pnpm typecheck` 通过。
- `pnpm test` 通过，50 个测试文件、228 个测试。

### 后续注意

- 下一轮 Coupon fast lane 如果某个 Worker 因 Dionysus 集成门禁或 Codex 判断被取消并重跑，Reviewer 不应再被已取消的旧 Worker 卡住。
- 取消 Worker 必须仍由 Codex 或明确门禁决定；不要把失败任务自动改为 cancelled 来绕过质量门禁。

## 2026-05-18 上下文恢复记录：继续推进 Dionysus 可用性

### 本次恢复后确认

- 已按项目规则重新读取 Dionysus `AGENTS.md`、`MEMORY.md` 和本地 Dionysus Skill。
- 当前 Dionysus 工作区恢复时为 clean，`main` 与 `origin/main` 同步。
- 上一轮已完成并推送 `fix(fastlane): ignore cancelled workers for reviewer gate`，runtime 已自愈到新 commit。

### 本轮目标

继续从“真实 Coupon 开发中暴露的问题”出发，优先修 Dionysus 本身的硬缺口，而不是做表面 UI。下一步先重新运行 doctor/readiness/usage 和测试，结合 docs/PLAN 与现有 TODO，选择一个能提高 Codex 控制力、Agent 产出可靠性或发布证据闭环的缺口按 TDD 修复。

## 2026-05-18 Dionysus milestone E2E passed verdict 门禁修复记录

### 完成内容

- 修复里程碑判定漏洞：`recordCodexVerdict({ verdict: "passed" })` 不再只看 milestone 是否处于 `e2e_running`。
- 新增 `evaluateMilestoneVerdictGate`：`passed` verdict 必须至少存在一个 E2E campaign，且该 milestone 下所有 campaign 状态都必须是 `passed`。
- 如果任一 campaign 仍是 `created`、`running`、`failed` 或 `blocked`，API 会返回 `409 MILESTONE_E2E_GATE_BLOCKED`，不得把 milestone 标记为 `passed`。
- `failed` / `blocked` verdict 仍按原状态机进入 `e2e_failed` / `e2e_blocked`。
- 更新 `docs/specs/e2e-and-notification.md`，明确该门禁属于 E2E 与通知契约。

### TDD 证据

- 红灯：`pnpm exec vitest run packages/core/src/milestone-orchestration.test.ts` 初始失败，原因是 `evaluateMilestoneVerdictGate is not a function`。
- 绿灯：
  - `pnpm exec vitest run packages/core/src/milestone-orchestration.test.ts` 通过，5 个测试。
  - `pnpm typecheck` 通过。
  - `pnpm test` 通过，50 个测试文件、229 个测试。

### 为什么重要

这条门禁防止 Dionysus 在 happy path / negative path / persistence 仍未通过或被 blocked 时向 Codex/用户宣称里程碑完成，避免重演“看起来有流程，实际上没验收”的问题。

## 2026-05-18 Dionysus milestone notification 门禁修复记录

### 完成内容

- 修复里程碑通知漏洞：`POST /api/milestones/:id/notifications` 现在必须先检查 milestone 状态。
- 新增 `evaluateMilestoneNotificationGate`：只有 milestone 状态为 `passed` 时才允许创建“里程碑已完成”通知。
- 如果 milestone 仍是 `candidate`、`e2e_required`、`e2e_running`、`e2e_failed`、`e2e_blocked` 或 `cancelled`，API 返回 `409 MILESTONE_NOTIFICATION_GATE_BLOCKED`，避免用户收到未验收成果的误报。
- 更新 `docs/specs/e2e-and-notification.md`，把通知门禁写入契约。

### TDD 证据

- 红灯：`pnpm exec vitest run packages/core/src/milestone-orchestration.test.ts` 初始失败，原因是 `evaluateMilestoneNotificationGate is not a function`。
- 绿灯：
  - `pnpm exec vitest run packages/core/src/milestone-orchestration.test.ts` 通过，6 个测试。
  - `pnpm typecheck` 通过。
  - `pnpm test` 通过，50 个测试文件、230 个测试。

### 为什么重要

Dionysus 的用户通知必须是最终发布证据，而不是流程装饰。该修复确保用户只会在 Codex E2E verdict 已经通过之后收到 milestone 完成通知。

## 2026-05-18 Dionysus E2E case passed 证据门禁修复记录

### 完成内容

- 新增 `validateE2ECaseResultEvidence`：`status=passed` 的 E2E case-result 必须包含严格浏览器证据。
- 必要证据包括：
  - `mode="strict"`
  - 非空 `targetUrl`
  - 非空 `screenshotPath`
  - `consoleErrors` 数组
- API `POST /api/e2e/cases/:id/result` 在缺少上述证据时返回 `409 E2E_CASE_EVIDENCE_REQUIRED`，不得把人工口头判断或空 JSON 记为 E2E 通过。
- 同步更新：
  - `AGENTS.md` 中的 `e2e case-result` 示例。
  - `docs/specs/e2e-and-notification.md`。
  - `docs/specs/api.md`。
  - `tools/dionysus.ts` help 文本。

### TDD 证据

- 红灯：`pnpm exec vitest run packages/core/src/e2e-results.test.ts` 初始失败，原因是 `validateE2ECaseResultEvidence is not a function`。
- 绿灯：
  - `pnpm exec vitest run packages/core/src/e2e-results.test.ts` 通过，3 个测试。
  - `pnpm typecheck` 通过。
  - `pnpm test` 通过，50 个测试文件、231 个测试。

### 为什么重要

这条门禁防止 Dionysus / Codex 用 `{"note":"checked"}` 这类弱证据把 happy path、negative path 或 persistence 标记为 passed。以后里程碑通知链路必须建立在真实浏览器证据上。

## 2026-05-18 上下文压缩恢复记录：严格 E2E 自动执行范围收紧

### 用户新增长期规则

- 每次上下文压缩前，必须把尽可能完整的交接上下文写入项目根目录 `MEMORY.md`。
- 如果项目根目录没有 `MEMORY.md`，必须先创建。
- `AGENTS.md` 必须记录：历史上下文和压缩前交接记忆保存在 `MEMORY.md`。
- 如果上下文已经自动压缩，恢复后第一件事是读取 `AGENTS.md` 和 `MEMORY.md`，再把恢复点、当前状态和下一步追加回 `MEMORY.md`。

### 本次恢复后确认

- 已读取 Dionysus 根目录 `AGENTS.md`、`MEMORY.md` 和 git 状态。
- Dionysus 当前位于 `main`，与 `origin/main` 同步，但存在本轮未提交改动。
- Coupon 根目录 `AGENTS.md` 已包含 `MEMORY.md` 规则；Coupon 根目录 `MEMORY.md` 已存在并记录 D1 支持授权只读闭环验收。

### 本轮未提交目标

继续修复 Dionysus E2E 验收门禁：严格模式下系统不应自动把 `persistence` 用例当作可执行的通用刷新检查通过，因为“刷新后数据仍存在”必须由 Codex 在真实业务流程中完成创建/读取/刷新/复核并提交明确 case-result 证据。

### 已完成改动

- `packages/core/src/e2e-results.ts`
  - 新增 `E2ECaseType`。
  - 新增 `shouldAutoRunE2ECase`。
  - `strict` 模式只允许自动执行 `smoke`。
  - `render-only` 仍允许自动执行所有 case，因为它只用于工程诊断，不能用于 milestone verdict。
- `tools/dionysus.ts`
  - `runE2ECase` 改为调用 `shouldAutoRunE2ECase`。
- `packages/core/src/e2e-results.test.ts`
  - 新增测试：严格模式只自动执行 smoke；`happy_path`、`negative_path`、`persistence` 都不自动执行。
- `AGENTS.md`
  - 更新 E2E 模式说明：`strict` 只自动执行通用 smoke，其余必须 Codex 提交明确 case-result。
- `docs/specs/e2e-and-notification.md`
  - 更新契约：登录、业务输入、提交、异常流、刷新持久性必须由 Codex 明确执行并逐条写入结果。

### 已运行验证

- `pnpm exec vitest run packages/core/src/e2e-results.test.ts` 通过。
- `pnpm typecheck` 通过。
- `pnpm test` 通过，50 个测试文件、232 个测试。

### 下一步

1. 检查最终 diff。
2. 提交并推送 Dionysus。
3. 执行 `pnpm -s dionysus system runtime heal`。
4. 执行 `pnpm -s dionysus system doctor --brief`。
5. 执行 `pnpm -s dionysus system readiness --target-root /Volumes/MacMiniSSD/code/Coupon`。

## 2026-05-18 Dionysus render-only E2E 诊断与 milestone verdict 隔离修复记录

### 背景

上一轮把 `strict` 模式收紧为只自动执行通用 smoke，`happy_path`、`negative_path`、`persistence` 都必须由 Codex 执行真实最终用户流程并提交 case-result。恢复后继续检查发现一个新的可用性缺口：`render-only` 命令虽然存在，但 `POST /api/e2e/cases/:id/result` 只接受 `mode=strict` 的 passed 结果，导致 render-only 诊断模式无法正常记录通过结果。

### 完成内容

- `validateE2ECaseResultEvidence` 改为允许 `mode=strict` 或 `mode=render-only` 的浏览器证据记录为 case-level passed。
- `evaluateMilestoneVerdictGate` 改为接收 campaign status 与 case result modes。
- `milestone verdict passed` 新增强门禁：
  - 至少存在一个 E2E campaign。
  - 所有 campaign 状态必须为 `passed`。
  - 所有已通过 case-result 的 `mode` 必须全部为 `strict`。
  - 任一 case-result 使用 `render-only`，即使 campaign 状态为 passed，也不得把 milestone 标记为 passed。
- `packages/db/src/repository.ts` 在 `recordCodexVerdict` 时会读取每个 campaign 下 passed case 的 `result_json.mode`，并交给 core verdict gate 判断。
- 同步更新：
  - `docs/specs/api.md`
  - `docs/specs/e2e-and-notification.md`
  - `features_test/dionysus-mvp.feature.md`

### TDD 证据

- 红灯：
  - `pnpm exec vitest run packages/core/src/e2e-results.test.ts packages/core/src/milestone-orchestration.test.ts` 初始失败。
  - 失败点包括 render-only passed case 被拒绝，以及 verdict gate 不识别 `e2eCampaigns` 证据结构。
- 绿灯：
  - `pnpm exec vitest run packages/core/src/e2e-results.test.ts packages/core/src/milestone-orchestration.test.ts` 通过，2 个测试文件、12 个测试。
  - `pnpm typecheck` 通过。
  - `pnpm test` 通过，50 个测试文件、234 个测试。

### 为什么重要

这次修复把“工程诊断”和“最终用户里程碑验收”分开：Codex 可以用 render-only 快速检查页面是否渲染、是否有控制台错误，但 Dionysus 不会允许这种弱证据触发 milestone passed 或用户通知。

## 2026-05-18 Dionysus readiness 上下文记忆门禁修复记录

### 背景

用户明确要求：每次上下文压缩前必须把完整交接上下文写入项目根目录 `MEMORY.md`，如果没有则新建，并在 `AGENTS.md` 中记录历史记忆位置。恢复后必须先读取 `AGENTS.md` 和 `MEMORY.md`。此前 Dionysus 的 `system readiness` 只检查 Runtime、CLI、目标 Git、`docs/PLAN.md`、`docs/specs/` 和 `features_test/`，没有把长期记忆入口作为 fast lane 前置门禁。

### 完成内容

- `tools/dionysus-readiness.ts`
  - `ReadinessTargetInput` 新增 `hasMemoryMd` 和 `agentsMentionsMemory`。
  - readiness 缺少 `MEMORY.md` 时返回 blocker：`目标项目缺少 MEMORY.md，无法保存上下文压缩交接记录`。
  - readiness 发现 `AGENTS.md` 未提到 `MEMORY.md` 时返回 blocker：`目标项目 AGENTS.md 未记录 MEMORY.md 上下文恢复规则`。
- `tools/dionysus.ts`
  - `inspectReadinessTarget` 现在检查目标根目录 `MEMORY.md` 是否存在。
  - 读取目标 `AGENTS.md` 并检测是否提到 `MEMORY.md`。
- 同步更新：
  - `AGENTS.md`
  - `docs/specs/api.md`
  - `features_test/dionysus-mvp.feature.md`

### TDD 证据

- 红灯：
  - `pnpm exec vitest run tools/dionysus-readiness.test.ts` 初始失败，缺失 MEMORY 门禁时 readiness 仍返回 `ready`。
- 绿灯：
  - `pnpm exec vitest run tools/dionysus-readiness.test.ts` 通过，6 个测试。
  - `pnpm typecheck` 通过。
  - `pnpm test` 通过，50 个测试文件、235 个测试。

### 为什么重要

Dionysus 的长期目标是让 Codex 可以跨上下文持续调度 Agent Team 开发 Coupon。如果目标项目没有 `MEMORY.md` 或 `AGENTS.md` 未声明恢复规则，fast lane 即使启动也无法保证压缩后能恢复真实状态。这次修复把上下文连续性变成系统门禁，而不是靠人类或当前会话自觉。

## 2026-05-18 Dionysus fastlane advance 与 ReviewerCLI 自动接力记录

### 背景

继续推进 Dionysus “可用于真实 Coupon 功能开发”的目标时，发现 fast lane 仍有一个效率缺口：WorkerCLI 产出后，旧流程要求 Codex 先逐个 `task review approve` Worker，之后才会启动 ReviewerCLI。这样 ReviewerCLI 没有真正承担“便宜模型先审查 Worker 成果”的职责，Codex 仍然被迫过早介入，和成本/速度目标不一致。

### 完成内容

- `tools/dionysus-fastlane.ts`
  - 新增 `extractFastLaneAdvanceTaskIds`。
  - `buildFastLaneStatus` 现在在所有未取消 Worker 都处于 `needs_review` 或 `done`，且没有待处理 integration 时，进入 `ready_for_reviewer`。
  - ReviewerCLI 启动条件不再要求所有 Worker 已被 Codex approve。
  - 保留数据先行门禁：如果数据基座仍是 `needs_review` 且 API/Vue Worker 仍是 `created`，仍要求 Codex 先审查并 approve 数据基座。
- `tools/dionysus.ts`
  - 新增 `pnpm dionysus fastlane advance --goal-id "<goal-id>"`。
  - 该命令复用 `fastlane status` 的 phase 判断；只有 `ready_for_data_followups` 和 `ready_for_reviewer` 会自动调用 `task enqueue`。
  - 其他 phase 返回 `no_op`，不得自动 approve Worker、绕过 ReviewerCLI 或跳过 Codex E2E。
- 同步更新：
  - `AGENTS.md`
  - `docs/specs/api.md`
  - `features_test/dionysus-mvp.feature.md`
  - `/Users/yangyu/.codex/skills/dionysus/SKILL.md`

### TDD 证据

- 红灯：
  - `pnpm exec vitest run tools/dionysus-fastlane.test.ts` 初始失败。
  - 失败点：Worker 为 `needs_review` 时仍进入 `worker_review`，不会启动 ReviewerCLI。
- 绿灯：
  - `pnpm exec vitest run tools/dionysus-fastlane.test.ts` 通过，16 个测试。
  - `pnpm typecheck` 通过。
  - `pnpm test` 通过，50 个测试文件、235 个测试。

### 为什么重要

这次改动把 fast lane 从“Codex 先审 Worker，再启动 Reviewer”推进到“ReviewerCLI 先审 Worker 产物，Codex 最后裁决”。它更接近用户要求的节省成本和提高速度：低成本 CLI 负责批量产出和一轮质量筛选，Codex 只负责最终架构判断、E2E 和发布。

### 下一步

1. 提交并推送 Dionysus。
2. 运行 `pnpm -s dionysus system runtime heal`。
3. 运行 `pnpm -s dionysus system doctor --brief`。
4. 运行 `pnpm -s dionysus system readiness --target-root /Volumes/MacMiniSSD/code/Coupon`。
5. 后续可进一步让 `goal supervise` 自动调用 `fastlane advance`，减少 Codex 手动轮询。

## 2026-05-18 Dionysus supervise 自动执行 fastlane advance 记录

### 背景

上一轮新增了 `pnpm dionysus fastlane advance --goal-id "<goal-id>"`，但 Codex 仍需要先运行 `fastlane status`，发现 `ready_for_data_followups` 或 `ready_for_reviewer` 后，再手动执行 `fastlane advance`。这仍然保留了不必要的人工轮询点。为了让 Dionysus 更接近 7x24 连续推进，`goal supervise` 应该在这些安全 phase 自动调用 advance。

### 完成内容

- `tools/dionysus-supervise.ts`
  - 新增 `shouldAdvanceFastLaneDuringSupervision`。
  - `buildSupervisionStepRecord` 可记录 `fastLaneStatus` 和 `fastLaneAdvance` 证据。
- `tools/dionysus.ts`
  - `superviseGoal` 每轮会读取 `GET /api/goals/:id/status` 并复用 `buildFastLaneStatus`。
  - 当 phase 为 `ready_for_data_followups` 或 `ready_for_reviewer` 且存在入队命令时，自动调用 `advanceFastLane`，记录本轮 advance 结果，然后继续下一轮。
  - 其他 phase 不自动推进；`reviewer_review`、`codex_final`、`e2e_required` 和 blocker 仍交给 Codex。
- 同步更新：
  - `AGENTS.md`
  - `docs/specs/api.md`
  - `features_test/dionysus-mvp.feature.md`
  - `/Users/yangyu/.codex/skills/dionysus/SKILL.md`

### TDD 证据

- 红灯：
  - `pnpm exec vitest run tools/dionysus-supervise.test.ts` 初始失败，原因是 `shouldAdvanceFastLaneDuringSupervision is not a function`。
- 绿灯：
  - `pnpm exec vitest run tools/dionysus-supervise.test.ts tools/dionysus-fastlane.test.ts` 通过，24 个测试。
  - `pnpm typecheck` 通过。
  - `pnpm test` 通过，50 个测试文件、237 个测试。

### 为什么重要

这一步把“状态可见”推进到“安全状态自动推进”。Dionysus 不再只告诉 Codex 下一步该入队哪个 Reviewer 或 API/Vue Worker，而是在 `goal supervise` 中直接完成安全入队，减少人工盯盘和无效等待，同时仍保留 Codex 在 Reviewer 分数、最终 E2E 和发布阶段的硬裁决权。

## 2026-05-18 supervise Codex 裁决态修复记录

### 背景

- `goal supervise` 已能在 `ready_for_data_followups` 和 `ready_for_reviewer` 自动执行 `fastlane advance`。
- 新发现缺口：当 fast lane 到达 `reviewer_review` 或 `codex_final` 时，队列里通常没有 queued/running task；旧逻辑会把它误报为 `blocked/no active Dionysus work`。
- 这会混淆两类完全不同状态：正常等待 Codex 裁决，和系统真的没有任务可做。

### 本次修复

- `summarizeSupervisionStep` 增加 `fastLaneStatus` 输入。
- `reviewer_review` 和 `codex_final` 明确返回 `codex_required`。
- `goal supervise` 停止时把 `fastLaneStatus` 写入 outbox payload，便于 Codex 恢复上下文后知道为什么停在裁决点。
- 同步更新 `docs/specs/api.md`、`AGENTS.md` 和 Dionysus skill。

### TDD 证据

- 红灯：`pnpm exec vitest run tools/dionysus-supervise.test.ts` 先失败，旧行为返回 `blocked/no active Dionysus work`。
- 绿灯：同一测试文件通过，`reviewer_review` 和 `codex_final` 均返回 `codex_required`。

### 验证结果

- `pnpm exec vitest run tools/dionysus-supervise.test.ts tools/dionysus-fastlane.test.ts` 通过，26 个测试。
- `pnpm typecheck` 通过。
- `pnpm test` 通过，50 个测试文件、239 个测试。

## 2026-05-19 Worker 隔离控制力修复记录

### 背景

- Coupon 试点中发现 Worker 任务虽然应在 isolated workspace 产出 patch，但真实 CLI 仍可能根据 prompt 或上下文中的绝对路径直接写入目标项目主工作区。
- 旧逻辑在发现目标项目主工作区发生变化时只记录 warning，并继续排队 patch 或 dispatch 后续任务；这不足以约束低成本 CLI。
- 同时 `allowed-scope` 解析只识别多层目录，例如 `docs/specs/`，会漏掉 `migrations/`、`features_test/` 这类仓库顶层目录，导致合法数据基座 patch 被误判越权。

### 完成内容

- `apps/worker/src/allowed-scope.ts`
  - 支持从 `允许修改路径:` bullet list 中解析仓库顶层目录范围，例如 `migrations/`、`features_test/`。
- `packages/core/src/target-mutation.ts`
  - 未解释的目标项目主工作区变化从 `continue/warning` 改为 `block/error`。
  - 只有同一 goal 中其他 task 的 `passed` integration 能解释该变化时，才允许继续。
- `apps/worker/src/worker.ts`
  - Worker / RuleWriter / TestWriter run 结束后，如果 target root mutation decision 为 `block`，立即 `completeTaskRun(exitCode=1)` 并 `markTaskBlocked`。
  - 阻断后不创建 patch、不 dispatch 后续任务。
- 同步更新：
  - `AGENTS.md`
  - `docs/specs/architecture.md`
  - `docs/specs/api.md`
  - `features_test/dionysus-mvp.feature.md`

### TDD 证据

- 红灯：
  - `pnpm exec vitest run apps/worker/src/allowed-scope.test.ts packages/core/src/target-mutation.test.ts` 初始失败。
  - 失败点：`migrations/`、`features_test/` 未被解析；未解释 target root mutation 仍返回 `continue`。
- 绿灯：
  - `pnpm exec vitest run apps/worker/src/allowed-scope.test.ts packages/core/src/target-mutation.test.ts` 通过，8 个测试。
  - `pnpm typecheck` 通过。
  - `pnpm test` 通过，50 个测试文件、240 个测试。

### 为什么重要

这次修复把 Dionysus 从“靠 prompt 要求 Worker 不乱写”推进到“Runtime 发现绕过 workspace 就直接阻断”。它直接改善 Dionysus 对低成本 CLI Worker 的控制力，避免 Coupon 主工作区被 Agent 用绝对路径悄悄改坏，也避免合法 migration / features_test patch 因 allowed scope 解析缺陷被错误拦截。

### 运行状态

- Dionysus commit `5bc897a fix(worker): block direct target root mutations` 已提交并推送到 `main`。
- `pnpm -s dionysus system runtime heal` 已重启 API / Worker，原因是旧 Worker 仍运行 `1a84cb2`；重启后 runtime commit 已对齐 `5bc897a`。
- `pnpm -s dionysus system doctor --brief` 通过：API、PostgreSQL、RabbitMQ、Worker Runtime 均 ok；有效 Worker CLI 配置为 OpenCode + `minimax-cn-coding-plan/MiniMax-M2.7`。
- `pnpm -s dionysus system readiness --target-root /Volumes/MacMiniSSD/code/Coupon` 返回 `ready`，Coupon 工作区干净，`AGENTS.md` / `MEMORY.md` / `docs/PLAN.md` / `docs/specs/` / `features_test/` 均满足。
- 旧 Codex Outbox blocker `f638fb5e-042d-4783-a9d3-37e77a34f5de` 已 ack；该 blocker 的根因是旧 allowed scope 解析漏掉 `migrations/`，本次已修复。`pnpm -s dionysus codex heartbeat --limit 5` 当前显示无待处理 Codex 事件。

## 2026-05-19 运行期 Git Guard 修复记录

### 背景

- Coupon D1 RBAC 试点暴露出更深的控制力缺口：即使 Worker 被要求在 isolated workspace 中产出 patch，真实 CLI 仍可能在子进程里直接执行 `git commit` / `git push`。
- 上一轮的 target root mutation 检测只能在 run 结束后阻断，无法阻止 Agent 在检测前已经提交或推送。
- 本轮按 TDD 修复真实 CLI Adapter，使 Worker / RuleWriter / TestWriter 子进程运行期间就无法执行仓库写操作。

### 完成内容

- `packages/cli-adapters/src/types.ts`
  - `AgentRunInput` 新增 `targetRoot`、`workspacePath`。
- `packages/cli-adapters/src/template-adapter.ts`
  - 当 run 带有 `targetRoot` 时创建临时 `git` wrapper 并把目录前置到子进程 `PATH`。
  - Git Guard 允许 `git --version` 等只读检查。
  - Git Guard 阻断 `add`、`commit`、`push`、`apply`、`checkout`、`switch`、`reset`、`merge`、`rebase`、`pull`、`fetch`、`stash`、`clean`、`rm`、`mv`、`tag`、`worktree` 等会改变仓库或远端状态的命令。
  - 被阻断时 stderr 写入 `Dionysus git guard blocked ...`，退出码为 `97`。
- `apps/worker/src/worker.ts`
  - Worker run 传入 `targetRoot` 和 `workspacePath`。
  - RuleWriter / TestWriter run 传入 `targetRoot` 和 `workspacePath`；Master 保持不启用 Git Guard。
- 同步更新：
  - `AGENTS.md`
  - `docs/specs/architecture.md`
  - `docs/specs/api.md`
  - `features_test/dionysus-mvp.feature.md`
  - `/Users/yangyu/.codex/skills/dionysus/SKILL.md`

### TDD 证据

- 红灯：
  - 新增 `blocks Agent CLI attempts to commit from inside a guarded run` 后，`pnpm exec vitest run packages/cli-adapters/src/real-cli-adapters.test.ts` 失败。
  - 失败表现：假 CLI 的 `git commit --allow-empty` 真实执行成功，退出码为 `0`，说明旧 adapter 没有运行期 Git Guard。
  - 该红灯测试产生了一个本地空提交 `cc598a5 agent should not commit`；已立即用 `git reset --soft HEAD~1` 撤回，未推送，工作区只保留本轮源码改动。
- 绿灯：
  - `pnpm exec vitest run packages/cli-adapters/src/real-cli-adapters.test.ts` 通过，10 个测试。
  - `pnpm typecheck` 通过。
  - `pnpm test` 通过，50 个测试文件、242 个测试。

### 为什么重要

这次修复把 Dionysus 对低成本 CLI Worker 的控制从“事后发现越权”推进到“运行期禁止 Agent 自行提交、推送或应用 patch”。后续 Coupon 试点中，WorkerCLI 可以读取 git 状态做审查，但不能绕过 Dionysus 的 patch / Integration / Codex release 流程。

### 下一步

1. 提交并推送 Dionysus。
2. 运行 `pnpm -s dionysus system runtime heal`，确保 API / Worker 使用包含 Git Guard 的新 commit。
3. 再运行 `pnpm -s dionysus system doctor --brief` 和 `pnpm -s dionysus system readiness --target-root /Volumes/MacMiniSSD/code/Coupon`。
4. 回到 Coupon D1 RBAC 目标，优先修复 `writeMemberAudit` 当前 best-effort 导致的角色/权限审计 fail-close 缺口。

## 2026-05-19 上下文压缩恢复记录：Coupon D1 现状复核

### 恢复事实

- Git Guard 修复已完成、提交并推送为 Dionysus commit `91f7536 fix(runtime): block agent git write commands`。
- runtime 已在前序步骤自愈到该 commit，Coupon readiness 曾确认 ready。
- 当前用户请求不是继续实现 Dionysus，而是分析 Coupon 当前项目进度，重点分析 D1 基础身份与租户模块各子模块情况。
- Coupon 侧需要重点判断：租户、酒店/门店/部门、成员、RBAC、支持授权/代操作、审计和细粒度权限运行时是否已达到“最终用户可体验完整功能模块”的标准。

### 下一步

1. 在 Coupon 仓库交叉核查规格、后端 API、前端 Vue、测试和 PostgreSQL 数据。
2. 输出 D1 子模块进度、证据、主要风险和优先级。
3. 后续若继续实现，优先回到 D1 RBAC 写路径和权限/审计硬化。

## 2026-05-19 上下文压缩恢复记录：Coupon D1 分析继续

### 恢复事实

- 本轮再次从上下文压缩后恢复，已重新读取 Coupon `AGENTS.md`、`MEMORY.md` 和 Dionysus Skill。
- Dionysus runtime 当前健康：API、PostgreSQL、RabbitMQ、Worker 均 ok；Worker effective run config 为 OpenCode + `minimax-cn-coding-plan/MiniMax-M2.7`，runtime fallback 仍显示 mock 但有效配置来自角色配置。
- Coupon 当前有未提交的 Codex 改动，属于 D1 RBAC 审计 fail-close 后端硬化：
  - `apps/admin-api/internal/handler/admin/identity/identity_handler.go`
  - `apps/admin-api/internal/handler/admin/identity/identity_handler_test.go`
  - 另外按上下文恢复规则更新了 Coupon `MEMORY.md`。
- 活跃 Dionysus goal 是 `d7ebaf67-f7d1-49f6-970d-3366da5c34de`：`D1 RBAC 角色权限写路径硬化`，状态 `fast_lane`。该目标尚未完成，因为 `role-detail.vue` 的编辑基础资料和权限矩阵最终用户写闭环仍缺。
- Coupon GitNexus 索引已落后：indexed commit `beefd20`，current commit `0988f73`。后续提交前需要刷新索引或记录工具 blocker。

### 已验证事实

- Coupon PostgreSQL D1 数据基座存在真实数据：租户、门店、部门、成员视图、角色视图、权限、角色权限、支持授权和租户审计均有数据。
- `go test ./apps/admin-api/internal/handler/admin/identity -count=1` 通过。
- `go test ./apps/admin-api/internal/handler -run 'TestTenant|TestHotel|TestRealDB' -count=1` 通过。
- `pnpm --filter @coupon/admin-web build` 通过，仅 Vite chunk size warning。

### 下一步

- 对用户输出 D1 子模块完成度分析。
- 若进入实现，继续完成 RBAC：先补 `role-detail.vue` E2E 红灯，再实现角色详情页编辑资料和权限矩阵保存，随后运行浏览器 E2E、GitNexus detect/analyze、提交推送。

## 2026-05-19 Coupon D1 RBAC 试点验证记录

### 背景

- 活跃 Coupon 试点 goal：`d7ebaf67-f7d1-49f6-970d-3366da5c34de`，标题为 `D1 RBAC 角色权限写路径硬化`。
- 本轮由 Codex 直接完成最终实现和质量门禁，Dionysus 作为目标、运行状态和证据记录系统继续使用。
- Dionysus runtime 当前健康，effective Worker CLI 配置为 OpenCode + `minimax-cn-coding-plan/MiniMax-M2.7`。

### Coupon 当前成果

- 后端 RBAC 角色写路径完成严格审计和事务回滚：
  - `CreateRole`
  - `UpdateRole`
  - `AssignPermissions`
- 前端完成角色详情页最终用户写闭环：
  - 编辑角色基础资料。
  - 编辑权限矩阵。
  - 保存后重新读取 PostgreSQL-backed API。
- 修复 `ListRoles` 返回权限 ID 误用 `role_permissions.id` 的问题，权限勾选状态现在可按真实 `permissions.id` 恢复。

### 验证证据

- `go test ./apps/admin-api/internal/handler/admin/identity -count=1` 通过。
- `go test ./apps/admin-api/internal/handler -count=1` 通过。
- `pnpm --filter @coupon/admin-web build` 通过。
- `git diff --check` 通过。
- 启动 `make admin-api` 后，`/api/admin/login` 返回 200，`expires_in=86400`。
- D1 关键 E2E 通过：
  - `pnpm exec playwright test tests/e2e/identity-roles-write.spec.js tests/e2e/identity-members-write.spec.js tests/e2e/identity-support-grants.spec.js tests/e2e/identity-audit-central.spec.js --project=chromium-desktop`
  - 33/33 passed。
- GitNexus 已刷新：
  - `npx gitnexus analyze` 成功。
  - 当前索引：`10382 nodes / 20551 edges / 188 clusters / 278 flows`。
  - `npx gitnexus status` 为 up-to-date。
  - `detect-changes` 风险 high，原因是 RBAC handler 和角色详情前端影响 15 条执行流；已由上述测试覆盖主要风险。

### 下一步

1. 在 Coupon 中提交并推送 RBAC 改动。
2. 用 Dionysus release / codex completion 能力为 goal `d7ebaf67-f7d1-49f6-970d-3366da5c34de` 记录完成证据。
3. 后续 Coupon D1 继续推进细粒度权限运行时、支持授权/代操作 enforcement 和审计 fail-close 全覆盖。
