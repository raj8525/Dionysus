# Dionysus Agent Instructions

本仓库是 Dionysus Agent Team 执行系统。Dionysus 的直接用户是 Codex，不是人类。

## 工作原则

- 永远用中文向用户汇报。
- 代码标识符、接口路径、环境变量、命令保持英文。
- 默认目标项目是 `/Volumes/MacMiniSSD/code/Coupon`。
- 不修改 `/Volumes/MacMiniSSD/code/Coupon_backup`。
- Dionysus 采用主干开发：长期只使用 `main`，最多增加 `gray`。
- Worker 不直接提交目标项目 `main`，只能在隔离 workspace 输出 patch。
- 所有实现必须先有 `docs/PLAN.md`、`docs/specs/`、`features_test/`。
- 任务状态、运行记录、日志、里程碑和通知必须写入 PostgreSQL。
- 异步任务必须通过 RabbitMQ。
- 里程碑出现后必须触发 Codex 浏览器级 E2E 验收。
- Coupon 管理后台页面规则：`tenants.vue` 是成熟集团租户管理页，`hotels.vue` 是真实酒店门店/部门页；两者只做必要接口、字段和小范围交互增量。其他页面迁移 Vue 时参考 `apps/admin-web/html/` 对应模板，但必须重写为动态 Vue 页面，禁止 HTML 注入。

## 必读文档

1. `docs/PLAN.md`
2. `docs/specs/architecture.md`
3. `docs/specs/state-machine.md`
4. `docs/specs/api.md`
5. `docs/specs/e2e-and-notification.md`
6. `features_test/dionysus-mvp.feature.md`

## 本地启动

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm dev:all
```

`pnpm dev:all` 会同时启动 API、Web、Worker。只调试单个模块时才使用 `pnpm dev:api`、`pnpm dev:web` 或 `pnpm dev:worker`。

## Codex CLI 入口

Codex 日常操作 Dionysus 优先使用统一 CLI，避免手写 `curl`：

```bash
pnpm dionysus system doctor
pnpm dionysus system doctor --brief
pnpm dionysus system readiness --target-root "/Volumes/MacMiniSSD/code/Coupon"
pnpm dionysus system runtime heal
pnpm dionysus system runtime start
pnpm dionysus system runtime status
pnpm dionysus system runtime stop
pnpm dionysus system worker start
pnpm dionysus agent probe
pnpm dionysus agent list
pnpm dionysus agent validate-model --cli opencode --model "minimax/MiniMax-M2.7"
pnpm dionysus agent config list
pnpm dionysus agent config set --role worker --cli opencode --model "minimax/MiniMax-M2.7" --enabled true
pnpm dionysus agent status --goal-id "<goal-id>"
pnpm dionysus agent usage --goal-id "<goal-id>"
pnpm dionysus agent usage --target-root "/Volumes/MacMiniSSD/code/Coupon"
pnpm dionysus fastlane coupon-module-plan --module "租户管理" --title "租户管理只读闭环" --description "让最终用户在租户管理页看到数据库中的完整集团租户事实数据" --target-root /Volumes/MacMiniSSD/code/Coupon --page "apps/admin-web/src/pages/tenants.vue" --api "/api/admin/tenants" [--data-only]
pnpm dionysus fastlane coupon-module-start --module "租户管理" --title "租户管理只读闭环" --description "让最终用户在租户管理页看到数据库中的完整集团租户事实数据" --target-root /Volumes/MacMiniSSD/code/Coupon --page "apps/admin-web/src/pages/tenants.vue" --api "/api/admin/tenants" [--data-only]
pnpm dionysus fastlane plan --title "库存流水查询闭环" --description "让最终用户在库存页看到真实库存流水" --target-root /Volumes/MacMiniSSD/code/Coupon --worker "后端::实现 API 和测试" --worker "前端::接入 Vue 页面"
pnpm dionysus fastlane start --title "库存流水查询闭环" --description "让最终用户在库存页看到真实库存流水" --target-root /Volumes/MacMiniSSD/code/Coupon --worker "后端::实现 API 和测试" --worker "前端::接入 Vue 页面"
pnpm dionysus fastlane status --goal-id "<goal-id>"
pnpm dionysus goal list --limit 10
pnpm dionysus goal cancel --goal-id "<goal-id>" --reason "smoke done"
pnpm dionysus goal fast-lane --goal-id "<goal-id>" --reason "Codex controls this goal directly"
pnpm dionysus release record --goal-id "<goal-id>" --target-root "/path/to/project" --branch main --commit-sha "<sha>" --status passed --pushed true --changed-file "path" --verification-json '[{"command":"pnpm test","status":"passed"}]' --summary "..."
pnpm dionysus release list --goal-id "<goal-id>"
pnpm dionysus run logs --run-id "<run-id>"
pnpm dionysus goal status --goal-id "<goal-id>"
pnpm dionysus goal intake --goal-id "<goal-id>"
pnpm dionysus goal bootstrap --goal-id "<goal-id>"
pnpm dionysus goal preflight --goal-id "<goal-id>"
pnpm dionysus goal gate-check --goal-id "<goal-id>"
pnpm dionysus goal remediation --goal-id "<goal-id>"
pnpm dionysus goal remediation-patch --goal-id "<goal-id>"
pnpm dionysus goal master-step --goal-id "<goal-id>"
pnpm dionysus goal release-ready --goal-id "<goal-id>" [--allow-dirty-path "apps/admin-web/src/pages/login.vue"]
pnpm dionysus goal detect-milestones --goal-id "<goal-id>"
pnpm dionysus goal run-cycle --goal-id "<goal-id>" --target-url "http://localhost:23101" --run-e2e --mode strict [--allow-dirty-path "apps/admin-web/src/pages/login.vue"]
pnpm dionysus goal supervise --goal-id "<goal-id>" --iterations 5 --interval-seconds 30 [--allow-dirty-path "apps/admin-web/src/pages/login.vue"]
pnpm dionysus integration list --goal-id "<goal-id>"
pnpm dionysus integration retry --integration-id "<integration-id>"
pnpm dionysus task enqueue --task-id "<task-id>"
pnpm dionysus task review --task-id "<task-id>" --verdict approve --score 90 --reason "reviewed by Codex"
pnpm dionysus milestone request-e2e --milestone-id "<milestone-id>"
pnpm dionysus milestone create-campaign --milestone-id "<milestone-id>" --target-url "http://localhost:23101" --acceptance "主路径通过"
pnpm dionysus e2e cases --campaign-id "<campaign-id>"
pnpm dionysus e2e case-result --case-id "<case-id>" --status passed --result-json '{"evidence":"checked by Codex"}'
pnpm dionysus e2e run-campaign --campaign-id "<campaign-id>" --mode strict
pnpm dionysus milestone verdict --milestone-id "<milestone-id>" --verdict passed --reason "E2E passed"
pnpm dionysus milestone notify --milestone-id "<milestone-id>" --summary "里程碑完成" --target-url "http://localhost:23101"
pnpm dionysus notification deliver --notification-id "<notification-id>"
pnpm dionysus codex heartbeat --limit 5
pnpm dionysus codex outbox --limit 5
pnpm dionysus codex reconcile
pnpm dionysus codex ack --event-id "<event-id>"
```

## CLI 完成标记

所有真实 CLI Agent 的最终输出最后一行必须包含：

```text
DIONYSUS_DONE_JSON={"status":"done","modelCalls":1}
```

Dionysus CLI Adapter 会在 stdout/stderr 中检测该标记；一旦检测到，会等待短暂 grace period 后主动终止 CLI 进程组，并把本次 run 视为正常完成。这样可以避免 OpenCode / MiniMax 已经输出最终报告却继续停留在“是否继续”的会话状态，拖慢后续 task review、ReviewerCLI 和 Codex E2E。

`modelCalls` 会同时作为模型调用计数回执；旧的 `DIONYSUS_USAGE_JSON` 仍兼容，但新任务优先使用 `DIONYSUS_DONE_JSON`。

`e2e run-campaign` 有两种模式：

- `strict`：只自动通过通用 smoke / persistence；需要真实产品操作的 happy_path / negative_path 会标记 blocked，防止伪验收。
- `render-only`：只验证页面渲染和控制台错误，适合静态文档或演示型里程碑；不证明真实业务流程。

## Codex Outbox

Dionysus 主动请求 Codex 介入时必须写入 PostgreSQL `codex_outbox`，不要只把问题写在 Agent 输出里。

常见事件：

- `blocker`：目标被阻断，需要 Codex 清理工作区、改计划或询问用户。
- `e2e_required`：出现里程碑，需要 Codex 执行浏览器级 E2E。
- `release_ready`：内部门禁通过，等待 Codex 最终验证、提交和推送。
- `user_notify`：需要 Codex 用中文通知用户查看结果。

Codex 的固定循环：

```bash
pnpm dionysus codex heartbeat --limit 5
# 处理最高优先级事件
pnpm dionysus codex ack --event-id "<event-id>"
```

Dashboard 也有 `Codex Outbox / 待 Codex 介入事项` 面板，用于查看 pending 事件、payload 线索和建议命令。非 `release_ready` 事件可以在面板中 ack；`release_ready` 必须先执行 `pnpm dionysus release record ... --codex-outbox-event-id "<event-id>"`，面板不会直接放行普通 ack。

处理 `release_ready` 时，Codex 完成最终验证、提交和推送后，必须先把发布结果写回 Dionysus，再 ack 对应 Outbox：

```bash
pnpm dionysus release record --goal-id "<goal-id>" --codex-outbox-event-id "<event-id>" --target-root "/path/to/project" --branch main --commit-sha "<sha>" --status passed --pushed true --changed-file "path" --verification-json '[{"command":"pnpm test","status":"passed"}]' --summary "..."
pnpm dionysus codex ack --event-id "<event-id>"
```

`release record` 是 Codex 发布闭环的正式证据，必须包含 commit、branch、是否 push、改动文件、验证命令和中文摘要。`status=passed` 且 `pushed=true` 的 release record 会自动把对应 goal 标记为 `done`，所以不要再手工 cancel 已发布目标。`status=failed` / `status=blocked` 会分别把仍处于活动状态的 goal 标记为 `failed` / `blocked`。`release_ready` 没有对应 `--codex-outbox-event-id` 的 release record 时，ack 会被 API 拒绝；只有人工破例才使用 `pnpm dionysus codex ack --event-id "<event-id>" --force`。

`codex heartbeat` 会先自动执行一次 `codex reconcile`，把已经由 integration queue 证明解决的旧 blocker 自动 ack，避免 Codex 被陈旧阻塞误导。需要单独核查清理结果时运行：

```bash
pnpm dionysus codex reconcile
```

## Agent CLI 配置优先级

Agent Runtime 执行任务时以 PostgreSQL `agent_cli_configs` 为准。`.env` 中的 `DIONYSUS_WORKER_CLI_TYPE` / `DIONYSUS_WORKER_CLI_MODEL` 只用于没有角色配置时的兼容 fallback；不要用它们覆盖 Dashboard 中保存的 `Master`、`RuleWriter`、`TestWriter`、`Worker` CLI / 模型。

`pnpm dionysus agent status --goal-id "<goal-id>"` 是 Codex 监督 Agent Team 的首选入口。它必须同时查看 Runtime health、角色 CLI 配置、具体 Agent 实例、任务、run 和 CLI usage；如果发现 running run 没有绑定 `agent_id`，或有 running run 但没有 working Agent，必须先修复 Runtime/数据库状态，不能继续假装系统正在正常推进。

`system doctor --brief` 和 Dashboard 的 Worker 状态会同时展示 Worker 心跳与 effective run config。心跳中的 `runtime.workerCliType` 只是进程 fallback；真实任务执行优先使用 PostgreSQL `agent_cli_configs` 中的角色配置。看到 runtime fallback 为 `mock` 时，不得直接断言 Worker 仍在用 mock，必须同时检查 `worker.effectiveRunConfig` 或 `agent config list`。

`pnpm dionysus goal supervise --goal-id "<goal-id>"` 是连续推进入口。每轮必须复用同一套 Agent 实例和 CLI usage 统计口径；如果目标项目存在已识别且不属于本轮的脏路径，必须显式传入同一组 `--allow-dirty-path`，让 preflight 和 master-step 保持一致。如果它返回 blocker 或 e2e_required，先处理 `codex_outbox`，不要只看前端或任务列表猜测状态。

如果 API 或 Worker 未启动，先运行 `pnpm dionysus system runtime start`。它会以本地后台进程启动 API 与 Worker，pid 写入 `.dionysus/pids/`，日志写入 `.dionysus/logs/api.log` 与 `.dionysus/logs/worker.log`，并等待 API `/health.ok=true` 后才返回。停止时使用 `pnpm dionysus system runtime stop`，不要手动留下孤儿进程。

如果 doctor/readiness 显示 `Worker Runtime 未就绪`、`worker.status=stale` 或 pid 缺失，优先运行 `pnpm dionysus system runtime heal`。它会在进程缺失时启动缺失进程，在 Worker 心跳过期但进程仍存在时重启 runtime；自愈后必须再跑 `pnpm dionysus system doctor --brief`，不要只反复运行 readiness。

## Integration 文件范围与受保护文件门禁

Dionysus 不只依赖 prompt 约束 Worker。每个 Worker 任务必须写清允许修改范围，格式优先使用：

```text
允许修改路径:
- apps/admin-web/src/pages/inventory.vue
- apps/admin-web/src/pages/inventory/
```

Worker Runtime 会从任务描述中提取 `Allowed files:`、`Allowed paths:`、`允许修改路径:`、`允许修改文件:`、`文件范围:` 或 `只允许修改:`，把结果写入 `patches.allowed_files_json`。Integration Worker 在应用 patch 前先校验 patch 的 `changedFiles` 是否全部落在允许范围内；超范围直接 `blocked`，不会执行 `git apply`。

Integration Worker 还会检查受保护文件：

```env
DIONYSUS_PROTECTED_FILES=apps/admin-web/src/pages/tenants.vue&&apps/admin-web/src/pages/hotels.vue
DIONYSUS_ALLOW_PROTECTED_FILES=
```

规则：

- `DIONYSUS_PROTECTED_FILES` 命中的 patch 默认 `blocked`，不会执行 `git apply`。
- 只有 Codex 明确判断本轮任务允许修改成熟文件时，才临时设置 `DIONYSUS_ALLOW_PROTECTED_FILES`。
- Coupon 当前默认保护 `apps/admin-web/src/pages/tenants.vue` 和 `apps/admin-web/src/pages/hotels.vue`：前者承载集团租户管理成熟交互，后者承载真实酒店门店/部门管理，均不得被 Worker 整页重写或语义回退。

## Fast Lane

默认推进真实 Coupon 功能时，Codex 优先使用 fast lane，而不是完整 Master 状态机：

启动 fast lane 前先运行 readiness，确认 Dionysus Runtime、四类 Agent CLI 配置、目标项目 git 状态和 SDD/TDD 文件入口都满足基本条件：

```bash
pnpm dionysus system readiness --target-root /Volumes/MacMiniSSD/code/Coupon
```

如果返回 `blocked`，先处理 `blockers`，不要继续创建 Worker 任务。

如果 blocker 只是已确认归属的既有改动，且本轮任务不会触碰该文件，可以显式允许该文件再复查：

```bash
pnpm dionysus system readiness --target-root /Volumes/MacMiniSSD/code/Coupon --allow-dirty-path apps/admin-web/src/pages/login.vue
```

只能允许具体文件或明确目录，不能把未知改动一概放行。

`fastlane start` 会自动执行同一套 readiness 门禁；未通过时不会创建 goal 或 task。如需允许已确认既有改动，必须把同一组 `--allow-dirty-path` 传给 `fastlane start`。

需要先确认门禁和拆分是否正确时，用 `--dry-run` 预演；它不会创建 goal 或 task。

Coupon 模块开发优先用专用数据先行模板，避免 Codex 手写 Worker 时漏掉 seed、读接口、Vue 动态数据或 E2E 验收：

```bash
pnpm dionysus fastlane coupon-module-plan \
  --module "租户管理" \
  --title "租户管理只读闭环" \
  --description "让最终用户在租户管理页看到数据库中的完整集团租户事实数据" \
  --target-root /Volumes/MacMiniSSD/code/Coupon \
  --page "apps/admin-web/src/pages/tenants.vue" \
  --api "/api/admin/tenants"
```

如果当前目标只是补齐数据库测试数据或 seed，不需要派生 API/Vue 实现任务，必须使用 `--data-only`：

```bash
pnpm dionysus fastlane coupon-module-plan \
  --module "酒店管理" \
  --title "酒店模块测试数据基座" \
  --description "只补充酒店模块 PostgreSQL 测试数据" \
  --target-root /Volumes/MacMiniSSD/code/Coupon \
  --page "apps/admin-web/src/pages/hotels.vue" \
  --api "/api/admin/hotels" \
  --data-only
```

`--data-only` 只创建“数据基座 Worker + 数据基座 ReviewerCLI”，不会创建 API Worker 或 Vue Worker。适用场景是已有页面/API 基本成立，但主 PostgreSQL 缺少完整虚拟数据、状态枚举或验收样本。Codex 审查通过后可以直接运行 migration、验证数据库和 API，再记录 release。

Codex 应用数据基座 Worker 产物时，必须优先使用受限 seed 入口，而不是手写 `docker compose ... < migration.sql`：

```bash
pnpm dionysus coupon seed plan \
  --target-root /Volumes/MacMiniSSD/code/Coupon \
  --migration "migrations/026_hotel_store_create_fields.sql" \
  --verify-sql "SELECT COUNT(*) FROM tenant_stores;"

pnpm dionysus coupon seed apply \
  --target-root /Volumes/MacMiniSSD/code/Coupon \
  --migration "migrations/026_hotel_store_create_fields.sql" \
  --verify-sql "SELECT COUNT(*) FROM tenant_stores;" \
  --record-event
```

`coupon seed plan/apply` 只允许目标项目 `migrations/*.sql`，会拒绝路径穿越和危险 SQL，并固定通过目标项目 Docker PostgreSQL 执行。这样 Dionysus 可以生成测试数据，Codex 负责最终安全应用和验收。

传入 `--goal-id <goal-id>` 时会自动把 seed apply 结果写入 Dionysus PostgreSQL `system_events`；没有 goal 但需要留证据时使用 `--record-event`。不要只保留终端输出。

前端 Dashboard 的 `Data Evidence / Coupon 数据基座执行证据` 面板会显示最近的 `coupon.seed*` 事件，包括 migration、执行状态和 verify SQL 输出。Codex 检查 seed 证据时优先看这个面板或 `/api/system-events?prefix=coupon.seed`。

该模板固定生成 3 个 Worker 和 1 个 Reviewer：

- 数据基座：先补 `migrations/`、完整虚拟数据、契约和 `features_test/`。
- 只读 API：只做从 PostgreSQL 读取的接口和测试，不做写接口。
- Vue 只读首页：页面读取真实接口数据，禁止 `v-html`、raw HTML import 或长字符串整页模板。
- Reviewer：90 分门禁，确认数据、接口、页面、E2E 证据和本轮无写路径。

`--data-only` 例外：只生成数据基座 Worker 和数据基座 Reviewer，不生成后续 API/Vue 阶段。

分阶段入队规则：

- `coupon-module-start` 只会立即入队“数据基座”Worker。
- “只读 API”和“Vue 只读首页”Worker 先保持 `created`，不得抢跑。
- API 层会阻断提前 `task enqueue`，数据基座未完成时返回 `COUPON_DATA_FIRST_GATE_BLOCKED`，不是仅靠 prompt 约束。
- 数据基座 Worker 完成后，Codex 必须先 review/approve 数据 patch；approve 后 API 会自动并发派发“只读 API”和“Vue 只读首页”Worker，`fastlane status` 也会在需要手动处理时返回两个入队命令。
- 只有数据、API、Vue 三个 Worker 都 done，才能启动 ReviewerCLI。
- `--data-only` 下没有 API/Vue 阶段；数据基座 Worker 完成后直接进入数据基座 Reviewer 和 Codex 最终审核。

启动时使用：

```bash
pnpm dionysus fastlane coupon-module-start \
  --module "租户管理" \
  --title "租户管理只读闭环" \
  --description "让最终用户在租户管理页看到数据库中的完整集团租户事实数据" \
  --target-root /Volumes/MacMiniSSD/code/Coupon \
  --page "apps/admin-web/src/pages/tenants.vue" \
  --api "/api/admin/tenants"
```

只补测试数据时启动：

```bash
pnpm dionysus fastlane coupon-module-start \
  --module "酒店管理" \
  --title "酒店模块测试数据基座" \
  --description "只补充酒店模块 PostgreSQL 测试数据" \
  --target-root /Volumes/MacMiniSSD/code/Coupon \
  --page "apps/admin-web/src/pages/hotels.vue" \
  --api "/api/admin/hotels" \
  --data-only
```

```bash
pnpm dionysus fastlane start \
  --title "库存流水查询闭环" \
  --description "让最终用户在库存页看到真实库存流水" \
  --target-root /Volumes/MacMiniSSD/code/Coupon \
  --worker "后端 API::补 GET /api/admin/inventory/transactions 与 handler 测试" \
  --worker "前端展示::在 inventory.vue 展示真实库存流水" \
  --reviewer "ReviewerCLI 90分门禁::检查契约、测试、UI、真实数据与可合并性"
```

启动后固定用专用状态入口判断下一步，不要手工从通用 JSON 里猜：

```bash
pnpm dionysus fastlane status --goal-id "<goal-id>"
```

规则：

- `fastlane start` 会创建一个 `fast_lane` goal，并把每个 `--worker` 转成已入队 Worker 任务。
- `fast_lane` goal 不会被 Master Control 自动扫描，避免完整 Master 状态机重复拆任务。
- Reviewer 任务默认只创建不入队，避免没有 Worker 产物时假审核。
- Worker 产出 patch 并完成 integration 后，再用 `pnpm dionysus task enqueue --task-id "<reviewer-task-id>"` 启动 Reviewer。
- 如已有集成产物需要立即审核，可显式加 `--queue-reviewers`。
- Reviewer 任务 `approve` 必须带 `--score 90` 或更高；低于 90 或没有分数会被 API 以 `REVIEWER_SCORE_GATE_BLOCKED` 拒绝。低于 90 时必须用 `--verdict reject` 并写清 Worker 修复项。
- 同一任务被 ReviewerCLI 第 10 次 reject 时，Dionysus 会阻断任务并写入 Codex Outbox；Codex 必须亲自接手，不能继续重排 WorkerCLI。
- Coupon 页面任务必须在 worker prompt 中显式写清：`tenants.vue` 和 `hotels.vue` 保持现有语义与布局，只做必要接口、字段或路由增量；其他页面才参考对应 HTML 模板重写为 Vue。
- `fastlane status` 必须能明确区分：等待 Worker、等待 Worker review、等待 integration、可启动 Reviewer、等待 Reviewer review、Codex final、blocked、closed。
- 过程监控固定使用：

```bash
pnpm dionysus agent status --goal-id "<goal-id>"
pnpm dionysus agent usage --goal-id "<goal-id>"
pnpm dionysus codex heartbeat --limit 5
```

## 目标项目配置

Coupon 试点项目路径：

```text
/Volumes/MacMiniSSD/code/Coupon
```

Coupon 备份路径：

```text
/Volumes/MacMiniSSD/code/Coupon_backup
```

备份目录只读，不得写入。
