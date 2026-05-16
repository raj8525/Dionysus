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
- Worker CLI 模板 Adapter：默认仍用 MockAdapter，允许通过环境变量切换 Claude Code / Gemini CLI / OpenCode。
- Milestone Detector：integration 通过、patch applied、测试 passed 后才创建 milestone candidate。
- E2E Campaign Manager：为 milestone 生成 smoke / happy path / negative path / persistence 浏览器验收用例。
- Notification Delivery：milestone 通过后创建通知并投递到 console / Telegram / email webhook / generic webhook。
- Notification Audit：每个通知通道独立记录 `sent` 或 `failed`，通道密钥不明文入库。
- Integration Worker：消费 `dionysus.integration`，只在目标 Git 工作区干净时自动 `git apply` patch。
- Integration Verification：可通过 `DIONYSUS_INTEGRATION_VERIFY_COMMANDS` 配置 patch 后验证命令，失败自动回滚。
- Role Queue Runtime：Master / RuleWriter / TestWriter / Worker 分别进入专用 RabbitMQ 队列。
- Sequential Dispatch：bootstrap 后自动从 Master 串联到 RuleWriter、TestWriter、Worker、Review Master。
- Agent CLI Config：通过 API 为 Master / RuleWriter / TestWriter / Worker 分别配置 Claude Code、Gemini CLI、OpenCode 或 Mock。
- Role Prompt Builder：真实 CLI 执行前会注入目标目录、目标描述、任务描述、角色边界、SDD/TDD 门禁和固定输出格式，降低 Agent 漂移。
- Agents Dashboard：前端可查看四个固定角色的 CLI 配置、模型、启用状态，并触发 CLI 探测。
- Watchdog Run：`/api/watchdog/run` 可扫描超时 running / failed 任务，自动重投或标记 blocked。
- Watchdog Scheduler：worker runtime 会周期性投递 `dionysus.watchdog`，无需人工发现 Agent 停滞。
- Watchdog Dashboard：前端展示最近 watchdog run / retry / blocked 记录，并可手动触发巡检。

## 本地启动

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm dev:api
pnpm dev:worker
pnpm dev:web
```

默认地址：

```text
API: http://127.0.0.1:23100
Web: http://127.0.0.1:23101
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
  --data '{"goalId":"<goal-id>","taskId":"<task-id>","patchText":"diff ...","changedFiles":["README.md"]}'
```

`preflight` 会返回：

- `git.clean` 与 `git.changes`
- SDD / TDD gate 检查结果
- `blockers` 汇总，供 Codex 判断是否允许进入真实实现

生成缺失门禁的建议文件草案，但不写入目标项目：

```bash
curl -X POST http://127.0.0.1:23100/api/goals/<goal-id>/preflight-remediation
```

## Milestone / E2E / Notification

```bash
curl -X POST http://127.0.0.1:23100/api/goals/<goal-id>/detect-milestones
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

可覆盖命令模板：

```env
DIONYSUS_CLAUDE_CODE_COMMAND=claude
DIONYSUS_CLAUDE_CODE_ARGS=-p {prompt}
DIONYSUS_GEMINI_CLI_COMMAND=gemini
DIONYSUS_GEMINI_CLI_ARGS=--prompt {prompt}
DIONYSUS_OPENCODE_COMMAND=opencode
DIONYSUS_OPENCODE_ARGS=run --model {model} {prompt}
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
