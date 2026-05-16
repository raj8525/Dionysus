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
- Patch Queue：Worker 产出补丁后进入 integration queue，等待主工作区集成验证。
- Worker 隔离工作区：CLI 在 `.dionysus/workspaces/` 的目标项目副本中运行，不直接改主项目目录。
- Worker CLI 模板 Adapter：默认仍用 MockAdapter，允许通过环境变量切换 Claude Code / Gemini CLI / OpenCode。

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
curl -X POST http://127.0.0.1:23100/api/patches \
  -H 'content-type: application/json' \
  --data '{"goalId":"<goal-id>","taskId":"<task-id>","patchText":"diff ...","changedFiles":["README.md"]}'
```

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

## 下一步

1. Worker isolated workspace 补丁自动生成。
2. Milestone Detector 自动判定。
3. E2E Campaign Manager。
4. Email / Telegram Notification Delivery。
5. Coupon 真实小功能试运行。
