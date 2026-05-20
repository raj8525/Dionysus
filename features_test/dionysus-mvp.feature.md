# Dionysus MVP BDD 测试说明

## 覆盖规格

- `docs/specs/architecture.md`
- `docs/specs/state-machine.md`
- `docs/specs/api.md`
- `docs/specs/e2e-and-notification.md`

## 场景 1：创建目标

Given Dionysus API 已启动
When Codex 提交一个 goal
Then PostgreSQL 中必须出现 goal 记录
And goal 状态为 `created`
And 系统事件中记录 `goal.created`

## 场景 1.1：系统 Doctor 必须检查真实依赖

Given Dionysus API 已启动
When Codex 运行 `pnpm dionysus system doctor`
Then 返回必须包含 API health、PostgreSQL health、RabbitMQ health、Worker health 和 CLI probe
And `/health` 不得只返回静态 ok，必须检查数据库连接
And Worker 必须通过 `worker.started` 或 `worker.heartbeat` system event 证明 Runtime 正在运行
And 如果 Worker 心跳超过 `DIONYSUS_WORKER_HEALTH_MAX_AGE_SECONDS`，doctor 必须显示 stale 或 missing

## 场景 1.2：Codex 可以用 CLI 管理 Dionysus Runtime

Given Codex 在 Dionysus 仓库根目录
When Codex 运行 `pnpm dionysus system runtime start`
Then CLI 必须启动 API 与 Worker 后台进程
And pid 文件必须写入 `.dionysus/pids/`
And 日志必须写入 `.dionysus/logs/api.log` 与 `.dionysus/logs/worker.log`
And CLI 必须等待 API `/health` 可访问后才返回
And Codex 可以立刻执行依赖 API 的下一条命令，不需要手动 `sleep`
When Codex 运行 `pnpm dionysus system runtime status`
Then CLI 必须显示 API 与 Worker 是否仍在运行
When Codex 运行 `pnpm dionysus system runtime stop`
Then CLI 必须停止由 Dionysus 管理的 API 与 Worker

## 场景 2：任务状态机拒绝非法迁移

Given 一个状态为 `created` 的 task
When 系统试图直接迁移到 `done`
Then 状态机必须拒绝
And 返回非法迁移错误

## 场景 3：里程碑不能跳过 E2E

Given 一个状态为 `candidate` 的 milestone
When 系统试图直接迁移到 `passed`
Then 状态机必须拒绝
And 要求先进入 `e2e_required`

## 场景 4：Flow 页面展示目标执行链路

Given Dionysus API 已启动
When Codex 创建 Coupon goal
And 前端请求 `/api/flow/current`
Then 响应必须包含 goal、PLAN、specs、features_test、Workers、Integration Queue、Milestone、Codex E2E、Notify User 节点
And 节点之间必须按执行顺序连接

## 场景 4.1：Codex 和 Dashboard 可以列出已有目标

Given Dionysus 已经创建过多个 goal
When Codex 执行 `pnpm dionysus goal list --limit 10`
Then Dionysus 必须返回最近目标列表
And Dashboard 必须提供已有目标选择器
And 选择目标后必须加载该目标详情、流程图、任务、运行证据和 Agent CLI usage

## 场景 4.2：Codex 可以读取单个目标聚合状态

Given 一个 Coupon goal 已经存在
When Codex 执行 `pnpm dionysus goal status --goal-id "<goal-id>"`
Then Dionysus 必须返回 goal、summary、tasks、runs、integrations、milestones、releases、usage 和 pendingCodexOutbox
And summary 必须包含任务、运行、集成、里程碑、发布记录的状态聚合
And summary 必须包含 `cliCalls`、`modelCalls`、`pendingCodexOutbox` 和 `nextOwner`

## 场景 5：里程碑通过后生成通知

Given 一个 milestone 已通过 Codex E2E
When Notification Service 发送通知
Then 通知内容必须包含已完成功能、启动方式、使用方式、验收方式、E2E 证据、main commit、已知风险和下一步计划

## 场景 5.1：里程碑不能绕过 Codex verdict

Given Master 创建了 milestone candidate
When Master 请求 E2E
Then milestone 状态必须进入 `e2e_required`
When Codex 提交 `passed` verdict
Then milestone 状态才能进入 `passed`

## 场景 6：文档编译和缺口扫描

Given 一个指向 Coupon 项目的 goal
When Codex 调用 `/api/goals/:id/intake`
Then Dionysus 必须扫描 `AGENTS.md`、`docs/`、管理后台 HTML / Vue 页面
And 将文档清单写入 `documents`
And 将 `待补充`、`未定义`、`占位`、`后续`、`P1` 等缺口写入 `document_findings`
And 生成产品构建图节点和依赖边

## 场景 6.1：Master 生成 SDD/TDD 任务树

Given 一个已经创建的 goal
When Codex 调用 `/api/goals/:id/bootstrap`
Then Dionysus 必须创建 Master、RuleWriter、TestWriter、Worker、Master Review 任务
And Worker 任务必须排在规格和测试任务之后

## 场景 6.2：角色任务必须自动串联

Given bootstrap 已创建任务树
When 第一个 Master 任务完成
Then Dionysus 必须自动投递 RuleWriter 任务
And RuleWriter 完成后必须投递 TestWriter
And TestWriter 完成后必须投递 Worker
And Worker 完成后必须投递 Review Master

## 场景 6.3：每个角色必须读取独立 CLI 配置

Given Codex 为 Master、RuleWriter、TestWriter 或 Worker 配置了 CLI 类型和模型
When 对应角色任务被 Runtime 消费
Then Dionysus 必须读取数据库中的 `agent_cli_configs`
And 使用该角色配置的 CLI Adapter 执行
And run 记录必须保存实际使用的 cli_type 和 cli_model
And 未配置角色必须默认使用 `mock`

## 场景 6.4：真实 Agent 执行前必须收到强约束角色 Prompt

Given 一个角色任务即将执行
When Runtime 调用 Agent CLI
Then prompt 必须包含目标目录、目标描述、任务标题、任务描述、角色边界、SDD/TDD 门禁和输出格式
And Master prompt 必须禁止直接写业务实现代码
And RuleWriter prompt 必须限制为 specs 产出
And TestWriter prompt 必须限制为 features_test 和测试产出
And Worker prompt 必须要求 gate-check 通过、隔离 workspace 和 patch 证据

## 场景 6.5：前端必须能配置固定角色 CLI

Given Dionysus Web UI 已启动
When Codex 打开 Dashboard
Then 页面必须展示 Master、RuleWriter、TestWriter、Worker 四个角色配置卡
And 每个角色必须能选择 CLI、填写模型、启用或禁用并保存
And 页面必须提供 CLI 探测入口
And 保存 OpenCode 配置前必须调用 `/api/cli/validate-model`
And 如果模型可用，页面必须显示 input model 到 resolved model 的映射并保存 resolved model
And 如果模型不可用，页面必须阻止保存并显示原因与建议模型
And React Flow 控制台不得出现缺失 handle 的 edge warning

## 场景 6.5.1：Codex CLI 必须能配置固定角色 CLI

Given Dionysus API 已启动
When Codex 运行 `pnpm dionysus agent config set --role worker --cli opencode --model minimax/MiniMax-M2.7`
Then CLI 必须先调用 `/api/cli/validate-model`
And 如果模型可用，必须保存 resolved model 到 `agent_cli_configs`
And 如果模型不可用，必须拒绝保存并返回失败原因
And Codex 不需要打开前端就能配置 Master、RuleWriter、TestWriter、Worker

## 场景 6.5.2：Codex CLI 必须能监督具体 Agent 实例

Given Dionysus API 已启动
When Codex 运行 `pnpm dionysus agent status --goal-id "<goal-id>"`
Then CLI 必须读取 `/health`、`/api/agent-cli-configs`、`/api/agents`、`/api/tasks`、`/api/runs` 和 `/api/usage/agent-cli`
And 输出必须包含 Agent 实例总数、idle 数、working 数、blocked 数、disabled 数
And 输出必须包含最近 run 中已绑定与未绑定具体 Agent 的数量
And 如果 running run 没有 `agent_id`，必须把 runtime 标记为 `blocked`

## 场景 6.5.3：Codex CLI 必须给出系统级派工判断

Given Dionysus API 已启动
When Codex 运行 `pnpm dionysus system audit --target-root "<target-root>"`
Then CLI 必须合并 readiness、Agent CLI usage、pending Codex outbox 和可选 goal status
And 输出必须包含 `ready`、`needs_attention` 或 `blocked`
And readiness blocker 必须使 audit 返回 `blocked`
And pending Codex outbox 必须使 audit 返回 `needs_attention`
And 高失败率角色必须使 audit 返回 `needs_attention` 并给出查看 usage 或日志的下一步命令
And 如果高失败率角色的最后一次运行晚于最后一次失败且状态已成功，audit 必须返回 `ready` 并把历史失败写入 `notes`
And 没有 blocker、没有 warning、且存在真实 CLI / 模型调用证据时，audit 才能返回 `ready`

## 场景 6.5.4：Fast Lane 必须支持只读报告型任务

Given Codex 需要让 WorkerCLI 做模块验收、缺口扫描或方案评审
When Codex 运行 `pnpm dionysus fastlane start --report-only ...`
Then Worker prompt 必须明确禁止修改文件
And Worker prompt 必须说明无需 patch，交付物是证据报告
And Reviewer prompt 必须评审 Worker report 的证据强度和可执行性
And Reviewer prompt 不得要求 integration patch
And nextCommands 必须提示 report-only 产出后再启动 Reviewer

## 场景 6.6：真实 CLI Adapter 必须可执行且不会卡死系统

Given Dionysus 已配置 Claude Code、Gemini CLI 或 OpenCode
When Runtime 调用真实 CLI Adapter
Then Adapter 必须使用该 CLI 的非交互参数执行
And 必须记录 stdout、stderr、exit_code、cli_type 和 cli_model
And 如果 CLI 超过 `DIONYSUS_AGENT_RUN_TIMEOUT_MS` 未退出
Then Runtime 必须终止 CLI 进程组
And task_run 的 exit_code 必须记录为 `124`
And stderr 必须包含超时原因
And Watchdog 可以基于该失败继续重试或标记 blocked

## 场景 6.7：OpenCode 模型必须在运行前可验证

Given Codex 为 OpenCode 配置了模型 `minimax/MiniMax-M2.7`
When Codex 调用 `/api/cli/validate-model`
Then Dionysus 必须先解析 provider alias
And 返回 `resolvedModel=minimax-cn-coding-plan/MiniMax-M2.7`
And 必须通过 `opencode models` 验证该模型可用
And 如果模型不可用，必须返回 `available=false`、失败原因和可选建议模型
And 不得等到 Worker 执行任务时才发现模型解析失败

## 场景 7：Spec/Test Gatekeeper 阻止无规格实现

Given 一个指向目标项目的 goal
When Codex 调用 `/api/goals/:id/gate-check`
Then Dionysus 必须检查 `docs/PLAN.md`、`docs/specs/`、`features_test/`
And 将检查结果写入 `gate_checks`
And 如果缺少任一门禁，则返回 `blocked`

## 场景 7.0：Codex CLI 覆盖完整 Goal 生命周期

Given Dionysus API 已启动
When Codex 需要推进一个 goal 的 intake、bootstrap、gate-check、remediation、remediation-patch、master-step、release-ready、integration list 或 release record
Then `pnpm dionysus` 必须提供对应命令
And 命令必须映射到已有 API 端点
And Codex 不需要手写 `curl` 或临时脚本才能操作 Dionysus

## 场景 7.0.3：Codex 发布完成后必须写回 release record

Given Dionysus 产生了 `release_ready` Codex Outbox
When Codex 完成最终验证、提交和推送
Then Codex 必须调用 `pnpm dionysus release record`
And PostgreSQL 必须保存 goal_id、target_root、branch、commit_sha、status、pushed、changed_files、verification 和 summary
And 系统事件必须记录 `release.recorded`
And Codex 才能 ack 对应 Outbox
And 如果 Codex 在没有对应 release record 时 ack `release_ready`，API 必须返回 `409 CODEX_OUTBOX_ACK_BLOCKED`

## 场景 7.0.1：Codex CLI 提供单步推进循环

Given Dionysus API 已启动
When Codex 运行 `pnpm dionysus goal run-cycle --goal-id <id>`
Then CLI 必须执行 preflight、master-step、detect-milestones
And 返回 blocker、nextOwner、nextActions
And 如果传入 `--target-url`，必须创建或复用 E2E campaign
And 如果未显式传入 `--run-e2e`，不得自动提交 E2E 结果或 milestone verdict

## 场景 7.0.2：Codex CLI 提供持续监督循环

Given Dionysus API、RabbitMQ 和 Worker 已启动
When Codex 运行 `pnpm dionysus goal supervise --goal-id <id> --iterations 5`
Then CLI 必须每轮检查 Agent runtime 状态和运行一次 goal run-cycle
And 如果 runtime blocked、业务 blocked 或 E2E 需要 Codex 介入，必须停止并返回原因
And 如果仍可推进，必须继续下一轮直到达到 iteration 上限

## 场景 7.1：Target Preflight 必须阻止脏工作区试运行

Given 一个指向目标项目的 goal
When Codex 调用 `/api/goals/:id/preflight`
Then Dionysus 必须检查目标 Git 工作区是否干净
And 必须同时运行 PLAN / specs / features_test gate
And 如果 Git 脏或任一 gate blocked，则 preflight 返回 `blocked`
And response 必须包含 blockers 汇总

## 场景 7.1.1：Readiness 必须保护上下文压缩记忆

Given Codex 准备对目标项目启动 fast lane
When Codex 运行 `pnpm dionysus system readiness --target-root <target>`
Then Dionysus 必须检查目标根目录存在 `MEMORY.md`
And 必须检查目标 `AGENTS.md` 提到 `MEMORY.md`
And 如果缺少任一项，readiness 必须返回 `blocked`
And `fastlane start` 不得创建 goal 或 task

## 场景 7.2：Preflight Remediation 只能生成草案

Given target preflight 因缺少 PLAN / specs / features_test 被阻塞
When Codex 调用 `/api/goals/:id/preflight-remediation`
Then Dionysus 必须返回缺失文件的 path 和 content 草案
And 不得直接写入目标项目主工作区
And Codex 必须在审查草案后决定是否应用

## 场景 7.3：Preflight Remediation Patch 必须尊重 Git 干净门禁

Given target preflight 因缺少 PLAN / specs / features_test 被阻塞
When Codex 调用 `/api/goals/:id/preflight-remediation/patch`
Then Dionysus 必须将草案转换为 git patch
And 必须创建 patch 与 integration queue 记录
And 如果目标 Git 工作区不干净，不得发布 integration 消息
And 如果目标 Git 工作区干净，才允许发布 integration 消息

## 场景 7.4：清理工作区后必须能恢复 queued integration

Given integration queue 中存在 queued patch
When Codex 调用 `/api/goals/:id/integrations/release-ready`
Then Dionysus 必须先检查目标 Git 工作区
And 如果工作区仍然不干净，返回 `status: blocked` 和 queued integrations
And 业务阻塞不得触发前端控制台 HTTP 错误
And 如果工作区干净，必须发布 integration 消息

## 场景 7.5：Master 必须能单步推进下一合法动作

Given Codex 已创建一个 goal
When Codex 调用 `/api/goals/:id/master-step`
Then Dionysus 必须根据任务树、SDD/TDD 门禁、integration queue 和目标 Git 状态决定一个下一步动作
And 如果没有 Master 任务树，必须先创建并投递 Master 任务
And 如果存在 queued integration 且目标 Git 不干净，必须返回 `blocked_dirty_worktree`
And 如果存在 queued integration 且目标 Git 干净，必须发布 integration 消息
And 如果缺少 PLAN/specs/features_test，必须只创建 preflight remediation patch，不直接写目标仓库
And 如果全部门禁通过，才允许进入实现准备状态

## 场景 7.6：Worker Runtime 必须周期性运行 Master Control

Given Dionysus worker 已启动
When 达到 `DIONYSUS_MASTER_CONTROL_INTERVAL_SECONDS`
Then worker 必须投递 `dionysus.master_control` 消息
And 消费该消息后必须扫描 active goals
And 每个 goal 只能推进一个合法 Master Step
And 决策结果必须写入 `system_events`
And Dashboard 必须能展示最近的 `master_control.step` 与 `master_control.run` 事件

## 场景 7.7：隔离 Agent 不得绕过 workspace 修改目标项目

Given Worker / RuleWriter / TestWriter 在 isolated workspace 中运行
When Runtime 发现目标项目主工作区在本次 run 期间发生变化
Then 如果该变化可由同一 goal 中另一个 `passed` integration 解释，必须记录 `target_root_mutation_explained_by_integration` 并继续
And 如果该变化无法解释，必须记录 `target_root_mutation_blocked`
And 当前 task 必须进入 `blocked`
And Runtime 不得为该 task 排队 patch 或自动 dispatch 下一任务

## 场景 7.7.1：真实 CLI Agent 不得自行提交或推送仓库

Given Worker / RuleWriter / TestWriter 通过真实 CLI Adapter 执行
And Runtime 已为本次 run 创建 isolated workspace
When Agent CLI 进程尝试执行 `git commit`、`git push`、`git apply`、`git reset` 或其他仓库写操作
Then Dionysus Git Guard 必须阻断该命令
And CLI run 必须返回非零退出码
And stderr 必须包含 `Dionysus git guard blocked`
But Agent CLI 仍可以执行 `git --version`、`git status`、`git diff` 等只读检查

## 场景 7.8：允许修改路径必须支持仓库顶层目录

Given Worker 任务描述包含 `允许修改路径:`
And 列表中包含 `migrations/`、`features_test/`、`docs/specs/`
When Runtime 解析 allowed file scope
Then `patches.allowed_files_json` 必须包含这些目录前缀
And Integration 不得把合法的 `migrations/*.sql` 或 `features_test/*` 误判为越权

## 场景 8：Worker patch 必须进入 Integration Queue

Given Worker 完成隔离 workspace 内的实现
When Worker 提交 patch
Then Dionysus 必须写入 `patches`
And 同时创建 `integration_queue` 记录
And task event 必须记录 `patch.queued`

## 场景 8.1：Integration Queue 自动应用 patch

Given `integration_queue` 中存在 queued patch
And 目标主工作区是干净 Git 状态
When integration worker 消费消息
Then Dionysus 必须先执行 `git apply --check`
And 成功后应用 patch
And 如果配置了验证命令，必须执行验证命令
And 将 patch 标记为 `applied`
And 将 integration 标记为 `passed`

## 场景 8.2：脏工作区必须阻止集成

Given 目标主工作区存在未提交改动
When integration worker 尝试应用 patch
Then Dionysus 必须拒绝应用
And 将 integration 标记为 `failed`
And result_json 必须记录 dirty worktree 原因

## 场景 8.3：验证失败必须自动回滚

Given patch 已成功应用
And integration 验证命令失败
When integration worker 处理结果
Then Dionysus 必须反向应用 patch 回滚
And 目标 Git 工作区必须恢复干净
And integration 必须标记为 `failed`

## 场景 8.4：Coupon 模块必须优先生成数据先行只读计划

Given Codex 准备开发 Coupon 的一个完整业务模块
When Codex 运行 `pnpm dionysus fastlane coupon-module-plan`
Then Dionysus 必须固定生成数据基座、只读 API、Vue 只读首页和 ReviewerCLI 四类任务
And 数据基座任务必须要求先补数据库表结构、完整虚拟数据、契约和 `features_test/`
And 只读 API 任务必须禁止写接口进入本轮范围
And Vue 任务必须要求读取真实接口数据并禁止 `v-html`、raw HTML import 或长字符串整页模板
And 存在 HTML 原型且不是成熟页面时，Vue 任务必须要求保留模板核心信息架构、视觉层级和内容密度
And Vue 任务必须要求 Worker 按最终用户任务流区分页内上下文切换和明确 CTA 跳转，不得机械复刻 HTML 或机械禁止所有跳转
And ReviewerCLI 必须执行 90 分门禁，检查数据、接口、页面、模板一致性、产品语义、功能入口、E2E 证据和本轮无写路径

## 场景 8.5：Coupon 数据先行模板必须分阶段入队

Given Codex 运行 `pnpm dionysus fastlane coupon-module-start`
When Dionysus 创建 Coupon 模块任务树
Then 只有数据基座 Worker 可以立即入队
And 只读 API 和 Vue 只读首页 Worker 必须保持 `created`
And 如果 Codex 或脚本提前调用 `task enqueue`，API 必须返回 `COUPON_DATA_FIRST_GATE_BLOCKED`
When 数据基座 Worker 已完成且 Codex approve
Then API 必须自动并发派发只读 API 和 Vue 只读首页 Worker
And `fastlane status` 必须在自动派发未发生或需要人工介入时提示入队命令
And ReviewerCLI 必须等全部 Worker 至少达到 `needs_review` 或 `done`，且 integration queue 无待处理项后才能启动
And Codex 可以运行 `fastlane advance` 自动入队安全 phase 的下一批任务
And `fastlane advance` 不得自动 approve Worker 或绕过 ReviewerCLI
And `goal supervise` 必须在这些安全 phase 自动执行等价的 advance 并继续下一轮
And 当 fast lane 进入 `reviewer_review` 或 `codex_final` 时，`goal supervise` 必须返回 `codex_required`，不能误报为无活跃任务 blocker

## 场景 9：Master 自动识别里程碑候选

Given integration queue 已通过
And patch 已应用
And 测试状态为 passed
And patch 同时包含最终用户可见前端变更和后端 / API / 数据库变更
When Codex 或 Master 触发 milestone detection
Then Dionysus 必须创建 milestone candidate
And milestone 不得跳过 Codex E2E

Given integration queue 已通过
And patch 已应用
And 测试状态为 passed
But patch 只包含后端 smoke、测试、文档或基础设施变更
When Codex 或 Master 触发 milestone detection
Then Dionysus 不得创建 milestone candidate
And 该结果只能记录为 engineering checkpoint

## 场景 10：E2E campaign 必须覆盖浏览器级验收

Given milestone candidate 已进入 E2E 阶段
When Dionysus 创建 E2E campaign
Then 必须包含 smoke、happy path、negative path、persistence 用例
And Codex 执行后才能写入 verdict

## 场景 10.1：E2E case 结果必须逐条落库

Given Dionysus 已创建 E2E campaign
When Codex 执行浏览器级用例
Then 每条 case 必须能写入 passed、failed、blocked 或 skipped
And 必须保存失败原因与截图、控制台日志、网络错误等证据 JSON
And campaign 状态必须由所有 case 状态自动汇总

## 场景 10.2：Codex CLI 必须能自动执行通用浏览器 E2E

Given Dionysus 已创建 E2E campaign
When Codex 运行 `pnpm dionysus e2e run-campaign --campaign-id <id> --mode strict`
Then 只有通用 smoke 用例可以通过 Playwright 打开目标 URL、截图并回写结果
And 需要业务特定操作的 happy_path / negative_path / persistence 在 strict 模式下必须标记 blocked
And 系统不得把未执行的业务流程伪造成 passed

## 场景 10.3：render-only 只能作为诊断证据

Given Dionysus 已创建 E2E campaign
When Codex 运行 `pnpm dionysus e2e run-campaign --campaign-id <id> --mode render-only`
Then Dionysus 可以记录包含 `mode=render-only` 的浏览器渲染结果
And 这些结果只能用于工程诊断
And `milestone verdict passed` 必须拒绝包含 render-only case-result 的 campaign
And 只有所有 case-result 都是 `mode=strict` 时才能作为 milestone passed 证据

## 场景 11：里程碑通过后必须通知

Given Codex E2E verdict 为 passed
When Dionysus 生成 milestone notification
Then 通知正文必须包含实现内容、如何使用、如何验收和剩余风险
And 投递记录必须进入 `notification_deliveries`

## 场景 11.1：通知通道必须可审计且失败隔离

Given milestone notification 已创建
When Codex 调用 `/api/notifications/:id/deliver`
Then console 通道必须始终记录一次投递
And 如果配置 Telegram，必须向 Telegram API 投递
And 如果配置 email webhook，必须向邮件网关投递
And 每个通道必须独立记录 `sent` 或 `failed`
And 通道配置中的 token / secret 不得明文写入数据库

## 场景 12：Watchdog 必须处理停滞任务

Given 一个 task 处于 `running` 且超过超时时间
When Codex 调用 `/api/watchdog/run`
Then 未超过最大尝试次数的 task 必须重新入队
And 超过最大尝试次数的 task 必须标记为 `blocked`
And `failed` task 在未超过最大尝试次数时也必须重新入队
And 每个处理动作必须写入 `task_events`
And Watchdog 将 task 标记为 `blocked` 时必须写入 `codex_outbox` blocker 事件

## 场景 12.1：Worker Runtime 必须自动运行 Watchdog

Given Dionysus worker 已启动
When 达到 `DIONYSUS_WATCHDOG_INTERVAL_SECONDS`
Then worker 必须投递 `dionysus.watchdog` 消息
And 消费该消息后必须扫描停滞任务
And 巡检摘要必须写入 `system_events`

## 场景 12.2：Dashboard 必须展示 Watchdog 异常与巡检结果

Given Dionysus Web UI 已启动
When Codex 打开 Dashboard
Then 页面必须展示 Watchdog 面板
And 可以手动触发巡检
And 可以查看最近的 `watchdog.run`、`watchdog.retry_queued`、`watchdog.blocked` 记录
And 面板必须展示 checked、retry、blocked 摘要

## 场景 13：Dashboard 必须展示任务与运行证据

Given goal 下存在 tasks 和 task_runs
When Codex 打开 Dashboard
Then 页面必须展示任务标题、角色、状态、优先级和尝试次数
And 页面必须展示最近运行的 CLI、命令、状态、退出码和日志预览
And Codex 必须能一键刷新当前目标的证据

## 场景 14：Dionysus 主动请求 Codex 介入

Given Dionysus 正在监督一个 Coupon goal
And `goal run-cycle` 返回 `blocked`
When Codex 执行 `pnpm dionysus goal supervise --goal-id "<goal-id>"`
Then Dionysus 必须创建 `codex_outbox` 事件
And 事件类型必须是 `blocker`
And `pnpm dionysus codex heartbeat --limit 5` 必须能读到该事件
And 每轮监督必须读取具体 Agent 实例与 `GET /api/usage/agent-cli`，不能只依赖旧的 role config / task run 列表

## 场景 14.1：Codex 处理事件后 ack

Given `codex_outbox` 中存在 `pending` 事件
When Codex 完成处理并执行 `pnpm dionysus codex ack --event-id "<event-id>"`
Then 该事件状态必须变为 `acked`
And 后续 heartbeat 不应继续返回该事件

## 场景 14.2：Dashboard 展示 Codex Outbox 并保护 release_ready ack

Given `codex_outbox` 中存在 `pending` 的 `blocker`、`e2e_required`、`release_ready` 或 `user_notify` 事件
When Codex 打开 Dashboard
Then 页面必须展示待介入事件的类型、严重级别、摘要、payload 线索和建议处理命令
And 非 `release_ready` 事件必须能在 Dashboard 上 ack
And `release_ready` 事件在没有 release record 前必须禁用普通 ack，并提示先执行 `pnpm dionysus release record`
And Dashboard 必须至少每 5 秒自动刷新一次 pending Codex Outbox，也必须提供手动刷新按钮

## 场景 15：Dashboard 实时展示 Agent CLI / 模型调用统计

Given Dionysus 已经通过 Master、RuleWriter、TestWriter 或 Worker 发起过 CLI run
When Codex 或前端请求 `GET /api/usage/agent-cli?goalId=<goal-id>`
Then 返回每个 Agent 的累计 CLI 调用次数
And 返回每个 Agent 使用的 CLI 与模型维度调用次数
And 前端默认应按当前目标的 `targetRoot` 请求项目级累计统计
And CLI 输出 `DIONYSUS_USAGE_JSON={"modelCalls":3}` 时，Agent Runtime 必须把真实模型调用次数写入 `task_runs.model_call_count`
And 非 `mock` CLI 在没有 provider usage 回执时，`modelCalls` 必须按 Dionysus 发起的 CLI run 次数估算
And Dashboard 每 5 秒自动刷新该统计
And 统计口径必须来自 PostgreSQL `task_runs` 全量聚合，而不是只看最近列表分页

## 场景 15.0：Runtime 必须记录具体 Agent 实例

Given Dionysus 已经初始化默认 Agent 实例 `Master`、`RuleWriter`、`TestWriter`、`WorkerA`、`WorkerB`、`WorkerC`、`WorkerD`
When Agent Runtime 开始执行 queued task
Then Runtime 必须为该 task role claim 一个 enabled Agent
And `task_runs.agent_id` 必须写入该 Agent id
And Agent 状态必须变为 `working`
When run 完成、取消、被 Watchdog 重试或阻断
Then 如果该 Agent 没有其他 running run，状态必须回到 `idle`
And Dashboard 必须能同时展示 Agent 实例状态和每个实例的 CLI / 模型调用次数

## 场景 15.1：Codex 和 Dashboard 可以查看单次 run 的完整日志

Given 一个 Agent run 已经写入 `task_run_logs`
When Codex 执行 `pnpm dionysus run logs --run-id "<run-id>"`
Then Dionysus 必须返回该 run 的完整 stdout/stderr 分片
And 日志必须按 `sequence` 与创建时间排序
And Dashboard 的 Runs 面板必须能展开查看完整日志
And Agent Runtime 必须在 CLI 进程运行中流式写入日志
And `/api/runs` 的短预览不得替代完整日志诊断能力

## 场景 16：任务树可以先创建但不立即执行

Given Codex 需要按 SDD/TDD 顺序创建 TestWriter 与 Worker 任务
When Codex 执行 `pnpm dionysus task create --goal-id "<goal-id>" --role worker --no-queue`
Then 任务状态必须保持 `created`
And 系统不得向 RabbitMQ 投递该 Worker 任务
And 后续只能由 Master 或上一阶段成功后的调度逻辑放行

## 场景 17：Codex 可以取消错误排队的任务

Given 一个 Worker task 被过早排队或已被更小任务替代
When Codex 执行 `pnpm dionysus task cancel --task-id "<task-id>" --reason "..."`
Then task 状态必须变为 `cancelled`
And 系统必须记录 `task.cancelled` 事件
And 该 task 下仍处于 `running` 的 run 必须被收口，不能继续显示 running

## 场景 17.1：Codex 可以评审 Agent 产物

Given 一个 task 处于 `needs_review`
When Codex 执行 `pnpm dionysus task review --task-id "<task-id>" --verdict approve`
Then task 状态必须变为 `done`
And 系统必须记录 `task.review_approve` 事件
And Dionysus 必须只在 approve 后放行同一 goal 的下一条 created task
When Codex 执行 `pnpm dionysus task review --task-id "<task-id>" --verdict reject`
Then task 状态必须变为 `queued`
And Dionysus 必须重新投递到该 task 的角色队列
And Dionysus 不得放行下一条 task
When 同一个 task 第 10 次被 `verdict reject`
Then task 必须进入 `blocked`
And 系统必须写入 Codex Outbox `blocker`
And 系统不得继续投递当前 task 给 WorkerCLI
And Codex 必须亲自接手该任务
When Codex 执行 `pnpm dionysus task review --task-id "<task-id>" --verdict block --reason "需要人工澄清"`
Then task 状态必须变为 `blocked`
And blocker reason 必须保存在 task 上
And Dionysus 不得放行下一条 task

## 场景 17.2：成功 run 和 integration 都不能绕过 review

Given 一个 Agent run 成功且没有 patch
When Agent Runtime 更新任务状态
Then task 必须进入 `needs_review`
And Dionysus 必须记录 `dispatch.waiting_for_review`
And 不得自动 dispatch 下一条 task
Given 一个 Agent run 产生 patch 且 integration 已 applied
When Integration Worker 完成 patch 应用
Then Dionysus 必须记录 `integration.awaiting_task_review`
And 不得自动 dispatch 下一条 task

## 场景 18：有 patch 的任务必须等 integration 成功后再放行下一任务

Given RuleWriter、TestWriter 或 Worker run 成功并产生 patch
When Dionysus 将 patch 写入 integration queue
Then 当前任务不得立即 dispatch 下一优先级任务
And 当前任务必须记录 `dispatch.waiting_for_integration`
When integration worker 成功应用 patch 并通过验证命令
Then Dionysus 必须记录 `integration.awaiting_task_review`
And 只有 Codex 或 Master approve 当前 task 后，才能 dispatch 下一优先级 created task
And 如果 integration blocked 或 failed，必须创建 `codex_outbox` blocker，而不是继续放行 Worker

## 运行命令

```bash
pnpm test
```

## 当前预期

第一阶段应先出现红灯测试，然后通过实现转绿。
