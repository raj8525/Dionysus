# Dionysus

Dionysus 是给 Codex 使用的 Agent Team 执行系统。它的目标是把完整产品开发变成一条可控、可追溯、可验证、可持续运行的工程流水线。

当前试点目标项目：

```text
/Volumes/MacMiniSSD/code/Coupon
```

备份目录只读：

```text
/Volumes/MacMiniSSD/code/Coupon_backup
```

## 当前能力

- TypeScript monorepo。
- Fastify API。
- Vite + React Flow 前端。
- PostgreSQL migration。
- RabbitMQ worker runtime。
- MockAdapter。
- goal 创建。
- task 创建、入队、worker 消费、run/log/event 入库。
- Coupon 文档与页面 intake 扫描。
- gap finding 入库。
- 产品 build graph 入库。
- Flow 前端展示流水线和 Coupon 产品图。
- milestone candidate / E2E required / Codex verdict / notification 状态推进。
- CLI 探测：Claude Code / Gemini CLI / OpenCode，其中 OpenCode 模型会入库供前端选择。
- Spec/Test Gatekeeper：实现前检查目标项目是否具备 `docs/PLAN.md`、`docs/specs/`、`features_test/`。
- Target Preflight：真实试运行前同时检查目标 Git 工作区是否干净，以及 PLAN/specs/features_test 是否齐备。
- Patch Queue：Worker 产出补丁后进入 integration queue，等待主工作区集成验证。
- Worker 隔离工作区：CLI 在 `.dionysus/workspaces/` 的目标项目副本中运行，不直接改主项目目录。
- Worker CLI Adapter：默认仍用 MockAdapter；切换真实 CLI 后会用各 CLI 的非交互参数执行 Claude Code / Gemini CLI / OpenCode，并记录 stdout / stderr / exit code。
- Milestone Detector：只有 integration 通过、patch applied、测试 passed，且同时包含最终用户可见前端变更和后端 / API / 数据库变更时，才创建 milestone candidate。milestone 必须是最终用户可在浏览器中完成的完整功能模块；后端-only、测试-only、文档-only、基础设施-only、纯静态页面、mock 数据演示或 render-only 检查只能算 engineering checkpoint。
- E2E Campaign Manager：为 milestone 生成 smoke / happy path / negative path / persistence 浏览器验收用例。
- Notification Delivery：milestone 通过后创建通知并投递到 console / Telegram / email webhook / generic webhook。
- Notification Audit：每个通知通道独立记录 `sent` 或 `failed`，通道密钥不明文入库。
- Integration Worker：消费 `dionysus.integration`，只在目标 Git 工作区干净时自动 `git apply` patch。
- Integration Verification：可通过 `DIONYSUS_INTEGRATION_VERIFY_COMMANDS` 配置 patch 后验证命令，失败自动回滚。
- Integration Gate：patch 应用失败或目标工作区脏时会写入 Codex outbox blocker，流程停止等待 Codex 处理，避免 Worker 越过未集成产物继续开发。
- Role Queue Runtime：Master / RuleWriter / TestWriter / Worker 分别进入专用 RabbitMQ 队列。
- Sequential Dispatch：bootstrap 后自动串联任务；若 Agent 产出 patch，必须等 Integration Worker 成功应用并验证后，才会放行下一任务。
- Agent CLI Config：通过 API 为 Master / RuleWriter / TestWriter / Worker 分别配置 Claude Code、Gemini CLI、OpenCode 或 Mock。
- Role Prompt Builder：真实 CLI 执行前会注入目标目录、目标描述、任务描述、角色边界、SDD/TDD 门禁和固定输出格式，降低 Agent 漂移。
- Agents Dashboard：前端可查看四个固定角色的 CLI 配置、模型、启用状态，并触发 CLI 探测。
- Watchdog Run：`/api/watchdog/run` 可扫描超时 running / failed 任务，自动重投或标记 blocked。
- Watchdog Scheduler：worker runtime 会周期性投递 `dionysus.watchdog`，无需人工发现 Agent 停滞。
- Watchdog Dashboard：前端展示最近 watchdog run / retry / blocked 记录，并可手动触发巡检。
- Reviewer Rejection Guard：同一任务被 ReviewerCLI 第 10 次打回时，系统自动阻断任务并写入 Codex Outbox，要求 Codex 亲自接手，避免 WorkerCLI 无限返工消耗 token。

## 本地启动

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm dev:all
```

`pnpm dev:all` 会同时启动 API、Web、Worker。需要分别调试时，也可以单独运行 `pnpm dev:api`、`pnpm dev:web`、`pnpm dev:worker`。

默认地址：

```text
API: http://127.0.0.1:23100
Web: http://127.0.0.1:23101
```

Dashboard 首页会显示 PostgreSQL、RabbitMQ、Worker heartbeat 与 CLI 探测状态。Codex 也可以用 `pnpm dionysus system doctor --brief` 查看同一套健康信息。

启动真实项目 fast lane 前，用 readiness 一次性检查 Dionysus Runtime、Agent CLI 配置和目标项目入口状态：

```bash
pnpm dionysus system readiness --target-root /Volumes/MacMiniSSD/code/Coupon
```

只有返回 `status: "ready"` 时，才进入 `fastlane plan/start`。如果返回 `blocked`，先处理 `blockers`，避免 Worker 在目标项目工作区脏、CLI 仍是 mock 或 SDD/TDD 入口缺失时继续消耗 token。

如果目标项目只有已确认归属的既有改动，可以显式允许该路径，其他未知改动仍会阻断：

```bash
pnpm dionysus system readiness \
  --target-root /Volumes/MacMiniSSD/code/Coupon \
  --allow-dirty-path apps/admin-web/src/pages/login.vue
```

## 验证命令

```bash
pnpm typecheck
pnpm test
pnpm --filter @dionysus/web build
```

浏览器级冒烟：

```bash
pnpm exec node --input-type=module - <<'NODE'
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:23101/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.flowNode').length > 0);
console.log(await page.locator('h2').innerText());
console.log(await page.locator('.flowNode').count());
await browser.close();
NODE
```

## 创建 Coupon 目标

```bash
pnpm goal:create -- \
  --title "完整实现 Coupon SaaS 系统" \
  --description "读取 Coupon 文档和管理后台页面，按 SDD、TDD、主干提交和 Codex E2E 持续推进。" \
  --target-root /Volumes/MacMiniSSD/code/Coupon
```

## Codex Fast Lane

为了节省成本并提升速度，Codex 可以用 fast lane 直接把一个小功能拆给多个低成本 WorkerCLI 并行执行，再由 ReviewerCLI 做 90 分门禁。

先确认系统和 Coupon 目标项目可执行：

```bash
pnpm dionysus system readiness --target-root /Volumes/MacMiniSSD/code/Coupon
```

`fastlane start` 会自动执行同一套 readiness 门禁；如果未通过，不会创建 goal / task。存在已确认既有脏路径时，把同一组 `--allow-dirty-path` 传给 `fastlane start`。

需要先预演时加 `--dry-run`，它只执行 readiness 和计划生成，不创建 goal / task。

Coupon 模块开发优先使用数据先行模板，而不是手写 `--worker`。它会固定拆成：

- 数据基座 Worker：migration、完整 seed、契约和 features_test。
- 只读 API Worker：从 PostgreSQL 返回页面需要的全部字段。
- Vue 只读首页 Worker：接真实 API、保留成熟交互、禁止 HTML 注入。
- ReviewerCLI：90 分质量门禁，确认本轮只做读闭环，不混入写路径。

```bash
pnpm dionysus fastlane coupon-module-plan \
  --module "租户管理" \
  --title "租户管理只读闭环" \
  --description "让最终用户在酒店租户首页看到数据库中的完整租户事实数据" \
  --target-root /Volumes/MacMiniSSD/code/Coupon \
  --page "apps/admin-web/src/pages/hotels.vue" \
  --api "/api/admin/tenants" \
  --html-template "apps/admin-web/html/hotels.html"
```

确认计划后启动：

```bash
pnpm dionysus fastlane coupon-module-start \
  --module "租户管理" \
  --title "租户管理只读闭环" \
  --description "让最终用户在酒店租户首页看到数据库中的完整租户事实数据" \
  --target-root /Volumes/MacMiniSSD/code/Coupon \
  --page "apps/admin-web/src/pages/hotels.vue" \
  --api "/api/admin/tenants" \
  --html-template "apps/admin-web/html/hotels.html"
```

```bash
pnpm dionysus fastlane plan \
  --title "库存流水查询闭环" \
  --description "让最终用户在库存页看到真实库存流水" \
  --target-root /Volumes/MacMiniSSD/code/Coupon \
  --worker "后端 API::允许修改路径: apps/admin-api/internal/handler/inventory_inbound_handler.go, apps/admin-api/internal/handler/inventory_inbound_handler_test.go。补 GET /api/admin/inventory/transactions 与 handler 测试" \
  --worker "前端展示::允许修改路径: apps/admin-web/src/pages/inventory.vue。展示真实库存流水"
```

Worker 任务描述中的允许修改范围会被写入 patch 记录；Integration Worker 会在 `git apply` 前校验 `changedFiles`，超范围 patch 直接 blocked。

确认拆分后启动：

```bash
pnpm dionysus fastlane start \
  --title "库存流水查询闭环" \
  --description "让最终用户在库存页看到真实库存流水" \
  --target-root /Volumes/MacMiniSSD/code/Coupon \
  --worker "后端 API::补 GET /api/admin/inventory/transactions 与 handler 测试" \
  --worker "前端展示::在 inventory.vue 展示真实库存流水" \
  --reviewer "ReviewerCLI 90分门禁::检查契约、测试、UI、真实数据与可合并性"
```

`fastlane start` 会：

- 创建 Dionysus goal，并立即标记为 `fast_lane`。
- 将 `--worker` 转为已入队 Worker 任务。
- 创建 Reviewer 任务但默认不入队，避免没有 Worker 产物时假审核。
- 返回 `agent status`、`agent usage`、`codex heartbeat` 等下一步命令。
- `fast_lane` goal 会被 Master Control 自动扫描排除，避免复杂 Master 状态机为同一目标重复拆任务。

监控调用成本：

```bash
pnpm dionysus fastlane status --goal-id "<goal-id>"
pnpm dionysus agent usage --goal-id "<goal-id>"
pnpm dionysus agent usage --target-root /Volumes/MacMiniSSD/code/Coupon
```

`fastlane status` 会直接给出当前 phase、下一步动作和下一条命令，避免 Codex 手工从通用 `goal status` JSON 里猜测是否该 review Worker、等待 integration、启动 ReviewerCLI 或进入最终 E2E/发布。

ReviewerCLI 任务不能口头说“通过”后直接放行。Codex 审查 Reviewer 输出后，只有分数达到 90 才能执行：

```bash
pnpm dionysus task review --task-id "<reviewer-task-id>" --verdict approve --score 90 --reason "Reviewer gate accepted by Codex"
```

低于 90 或没有分数时，API 会返回 `REVIEWER_SCORE_GATE_BLOCKED`；这时必须 `--verdict reject` 并把具体修复项交回 WorkerCLI。

Coupon 管理后台页面任务有一条固定约束：`hotels.vue` 已经完成，不再参考 `apps/admin-web/html/hotels.html` 重写；其他页面迁移 Vue 时参考 `apps/admin-web/html/` 对应模板，但必须重写为响应式数据、接口调用、loading、error、empty state 和事件处理都完整的 Vue 页面，禁止通过 `v-html`、raw import 或长字符串注入 HTML。

手动标记已有目标为 fast lane：

```bash
pnpm dionysus goal fast-lane --goal-id "<goal-id>" --reason "Codex controls this goal directly"
```

取消试验目标：

```bash
pnpm dionysus goal cancel --goal-id "<goal-id>" --reason "smoke done"
```

## 查看已有目标

```bash
pnpm dionysus goal list --limit 10
pnpm dionysus goal status --goal-id "<goal-id>"
```

Dashboard 顶部也提供已有目标选择器，用于在历史 Coupon 目标、沙箱目标和当前试运行目标之间切换。

## 执行 Coupon intake

```bash
curl -X POST http://127.0.0.1:23100/api/goals/<goal-id>/intake
```

## 创建 Mock Worker 任务

```bash
pnpm exec tsx tools/dionysus.ts task create \
  --goal-id <goal-id> \
  --title "Mock Worker 验证任务" \
  --description "验证 RabbitMQ -> Worker -> task_runs/logs/events 的最小闭环。" \
  --role worker
```

## Gatekeeper 与 Patch Queue

```bash
curl -X POST http://127.0.0.1:23100/api/goals/<goal-id>/gate-check
curl -X POST http://127.0.0.1:23100/api/goals/<goal-id>/preflight
curl -X POST http://127.0.0.1:23100/api/patches \
  -H 'content-type: application/json' \
  --data '{"goalId":"<goal-id>","taskId":"<task-id>","patchText":"diff ...","changedFiles":["README.md"],"allowedFiles":["README.md"]}'
```

`preflight` 会返回：

- `git.clean` 与 `git.changes`
- SDD / TDD gate 检查结果
- `blockers` 汇总，供 Codex 判断是否允许进入真实实现

生成缺失门禁的建议文件草案，但不写入目标项目：

```bash
curl -X POST http://127.0.0.1:23100/api/goals/<goal-id>/preflight-remediation
```

将建议文件草案转换为 patch 并进入 integration queue：

```bash
curl -X POST http://127.0.0.1:23100/api/goals/<goal-id>/preflight-remediation/patch
```

规则：

- 如果目标 Git 工作区干净，Dionysus 会发布 integration 消息，由 Integration Worker 应用 patch。
- 如果目标 Git 工作区不干净，只创建 patch / integration 记录，不发布集成消息，避免污染当前未归属改动。

当目标工作区清理干净后，发布已经 queued 的 integration：

```bash
curl -X POST http://127.0.0.1:23100/api/goals/<goal-id>/integrations/release-ready
```

如果工作区仍然不干净，该接口返回 `status: "blocked"`，并列出仍在等待发布的 integration；业务阻塞不会使用 HTTP 409，避免 Dashboard 产生无意义控制台错误。

Codex 也可以让 Master 单步推进下一合法动作：

```bash
curl -X POST http://127.0.0.1:23100/api/goals/<goal-id>/master-step
```

Master Step 每次只执行一个动作：创建任务树、生成 preflight remediation patch、发布 queued integration、报告 dirty worktree blocker，或返回 `ready_for_implementation`。

Dashboard 的 “任务与运行证据” 面板会展示当前 goal 的任务树和最近 task runs，包括任务角色、状态、尝试次数、CLI、命令、退出码和日志预览，用于 Codex 判断 Agent 是否真的推进。

Worker Runtime 会按 `DIONYSUS_MASTER_CONTROL_INTERVAL_SECONDS` 周期投递 `dionysus.master_control`，扫描 active goals 并自动执行同一套 Master Step 决策；每次决策写入 `system_events`。默认只扫描最新 1 个 active goal，可用 `DIONYSUS_MASTER_CONTROL_GOAL_LIMIT` 放大范围，避免历史试验目标制造噪声。

## Milestone / E2E / Notification

Milestone 必须是最终用户能在浏览器里体验的完整功能模块，要求前端到后端打通，数据真实落库并可刷新后继续看到；工程 smoke、测试补齐、静态页面、mock 数据演示和基础设施修复不得触发 milestone 通知。自动检测 milestone 时，integration 结果还必须包含 `finalUserFeatureEvidence[]` 与 `realDataPersistenceEvidence[]` 两类显式证据。

```bash
curl -X POST http://127.0.0.1:23100/api/goals/<goal-id>/detect-milestones
pnpm dionysus integration evidence --integration-id "<integration-id>" --final-user-evidence "admin 登录后完成新增租户" --persistence-evidence "刷新后租户仍从 PostgreSQL 返回"
curl -X POST http://127.0.0.1:23100/api/milestones/<milestone-id>/e2e-campaigns \
  -H 'content-type: application/json' \
  --data '{"targetUrl":"http://127.0.0.1:5173","acceptance":["主要验收点"]}'
curl -X POST http://127.0.0.1:23100/api/milestones/<milestone-id>/notifications \
  -H 'content-type: application/json' \
  --data '{"summary":"里程碑已通过","targetUrl":"http://127.0.0.1:5173","verificationCommands":["pnpm test"],"residualRisks":[]}'
curl -X POST http://127.0.0.1:23100/api/notifications/<notification-id>/deliver
```

通知通道环境变量：

```env
# Telegram
DIONYSUS_TELEGRAM_BOT_TOKEN=
DIONYSUS_TELEGRAM_CHAT_ID=

# Email webhook：由外部邮件网关接收 JSON 后发邮件
DIONYSUS_EMAIL_WEBHOOK_URL=
DIONYSUS_EMAIL_TO=

# Generic webhook
DIONYSUS_NOTIFICATION_WEBHOOK_URL=
```

规则：

- console 通道始终启用。
- Telegram 只有在 bot token 和 chat id 同时存在时启用。
- email 采用 webhook 方式，避免在 MVP 内直接管理 SMTP 密钥和模板。
- 每个通道单独记录 `sent` 或 `failed`，不会因为某个外部通道失败而丢失其他通道证据。

## Bootstrap Role Chain

```bash
curl -X POST http://127.0.0.1:23100/api/goals/<goal-id>/bootstrap
curl -s "http://127.0.0.1:23100/api/tasks?goalId=<goal-id>"
```

预期结果：第一个 Master 自动入队；运行时按优先级继续投递 RuleWriter、TestWriter、Worker、Review Master。

## Agent CLI 配置

前端入口：

```text
http://127.0.0.1:23101
```

Dashboard 下方的 “角色 CLI 配置” 面板可直接配置 `Master`、`RuleWriter`、`TestWriter`、`Worker`。

查看当前角色 CLI 配置：

```bash
curl http://127.0.0.1:23100/api/agent-cli-configs
```

验证某个 CLI 模型是否能被当前本机 CLI 解析：

```bash
curl -X POST http://127.0.0.1:23100/api/cli/validate-model \
  -H 'content-type: application/json' \
  --data '{"cliType":"opencode","model":"minimax/MiniMax-M2.7"}'
```

预期返回会包含 `resolvedModel`。例如 `minimax/MiniMax-M2.7` 会按 `DIONYSUS_OPENCODE_MODEL_ALIASES` 解析为 `minimax-cn-coding-plan/MiniMax-M2.7`，再与 `opencode models` 的输出比对。

Dashboard 保存 OpenCode 角色配置时会自动执行同一验证：

- 模型可用：页面显示 `inputModel -> resolvedModel`，并保存 `resolvedModel`。
- 模型不可用：阻止保存，展示失败原因和建议模型。

为某个角色配置 CLI：

```bash
curl -X PUT http://127.0.0.1:23100/api/agent-cli-configs \
  -H 'content-type: application/json' \
  --data '{"role":"master","cliType":"mock","enabled":true}'
```

支持角色：

```text
master
rule_writer
test_writer
worker
```

支持 CLI：

```text
mock
claude_code
gemini_cli
opencode
```

没有配置时默认使用 `mock`，避免 Dionysus 在未确认 CLI 可用前误调用真实 Agent。

## Worker CLI 切换

默认安全模式：

```env
DIONYSUS_WORKER_CLI_TYPE=mock
```

切换真实 CLI 时，先用 `/api/cli/probe` 验证可用，再配置：

```env
DIONYSUS_WORKER_CLI_TYPE=claude_code
DIONYSUS_WORKER_CLI_MODEL=
```

真实 CLI 默认非交互参数：

- Claude Code：`claude --print --output-format text --permission-mode acceptEdits [--model <model>] <prompt>`
- Gemini CLI：`gemini --prompt <prompt> --output-format text --skip-trust --approval-mode auto_edit [--model <model>]`
- OpenCode：`opencode run --dir <cwd> --format default [--model <model>] --dangerously-skip-permissions <prompt>`

运行时超时：

```env
DIONYSUS_AGENT_RUN_TIMEOUT_MS=1200000
```

超时后 Dionysus 会终止 CLI 进程组，run 的 `exit_code` 固定记录为 `124`，避免 OpenCode / Gemini / Claude 任一进程卡死导致队列停摆。

可覆盖命令与默认参数：

```env
DIONYSUS_CLAUDE_CODE_COMMAND=claude
DIONYSUS_CLAUDE_CODE_PERMISSION_MODE=acceptEdits
DIONYSUS_GEMINI_CLI_COMMAND=gemini
DIONYSUS_GEMINI_CLI_OUTPUT_FORMAT=text
DIONYSUS_GEMINI_CLI_APPROVAL_MODE=auto_edit
DIONYSUS_OPENCODE_COMMAND=opencode
DIONYSUS_OPENCODE_FORMAT=default
DIONYSUS_OPENCODE_SKIP_PERMISSIONS=true
DIONYSUS_OPENCODE_MODEL_ALIASES=minimax=minimax-cn-coding-plan
```

`DIONYSUS_OPENCODE_MODEL_ALIASES` 用于兼容本地 OpenCode 配置中的 provider 别名。例如本地配置写 `minimax/MiniMax-M2.7`，但 `opencode models` 暴露的实际 provider 是 `minimax-cn-coding-plan`，Dionysus 会在调用 OpenCode 前解析为 `minimax-cn-coding-plan/MiniMax-M2.7`。

如确实需要完全自定义命令参数，仍可使用模板变量：

```env
DIONYSUS_CLAUDE_CODE_ARGS="--print --output-format text --permission-mode acceptEdits {prompt}"
DIONYSUS_GEMINI_CLI_ARGS="--prompt {prompt} --output-format text --skip-trust --approval-mode auto_edit"
DIONYSUS_OPENCODE_ARGS="run --dir {cwd} --format default --model {model} --dangerously-skip-permissions {prompt}"
```

集成验证命令：

```env
DIONYSUS_INTEGRATION_VERIFY_COMMANDS=pnpm test && pnpm typecheck
```

## Watchdog

手动运行一次 watchdog：

```bash
curl -X POST http://127.0.0.1:23100/api/watchdog/run \
  -H 'content-type: application/json' \
  --data '{"runningTimeoutMinutes":15,"limit":50}'
```

查看最近 watchdog 事件：

```bash
curl 'http://127.0.0.1:23100/api/watchdog/events?limit=20'
```

行为：

- `running` 且超过超时时间：未达最大次数则重新入队，达到最大次数则 `blocked`。
- `failed`：未达最大次数则重新入队，达到最大次数则 `blocked`。
- 每次处理都会写入 `task_events`，返回值包含 task、原状态和决策。

worker 自动巡检配置：

```env
DIONYSUS_WATCHDOG_INTERVAL_SECONDS=60
DIONYSUS_WATCHDOG_RUNNING_TIMEOUT_MINUTES=15
```

worker 启动后会消费 `dionysus.watchdog` 队列，并按间隔自动投递巡检消息。

## 下一步

1. Coupon 真实小功能试运行。
