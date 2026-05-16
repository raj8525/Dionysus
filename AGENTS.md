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
pnpm dev
```

## Codex CLI 入口

Codex 日常操作 Dionysus 优先使用统一 CLI，避免手写 `curl`：

```bash
pnpm dionysus system doctor
pnpm dionysus system doctor --brief
pnpm dionysus goal status --goal-id "<goal-id>"
pnpm dionysus goal intake --goal-id "<goal-id>"
pnpm dionysus goal bootstrap --goal-id "<goal-id>"
pnpm dionysus goal preflight --goal-id "<goal-id>"
pnpm dionysus goal gate-check --goal-id "<goal-id>"
pnpm dionysus goal remediation --goal-id "<goal-id>"
pnpm dionysus goal remediation-patch --goal-id "<goal-id>"
pnpm dionysus goal master-step --goal-id "<goal-id>"
pnpm dionysus goal release-ready --goal-id "<goal-id>"
pnpm dionysus goal detect-milestones --goal-id "<goal-id>"
pnpm dionysus goal run-cycle --goal-id "<goal-id>" --target-url "http://localhost:23101" --run-e2e --mode strict
pnpm dionysus integration list --goal-id "<goal-id>"
pnpm dionysus milestone request-e2e --milestone-id "<milestone-id>"
pnpm dionysus milestone create-campaign --milestone-id "<milestone-id>" --target-url "http://localhost:23101" --acceptance "主路径通过"
pnpm dionysus e2e cases --campaign-id "<campaign-id>"
pnpm dionysus e2e case-result --case-id "<case-id>" --status passed --result-json '{"evidence":"checked by Codex"}'
pnpm dionysus e2e run-campaign --campaign-id "<campaign-id>" --mode strict
pnpm dionysus milestone verdict --milestone-id "<milestone-id>" --verdict passed --reason "E2E passed"
pnpm dionysus milestone notify --milestone-id "<milestone-id>" --summary "里程碑完成" --target-url "http://localhost:23101"
pnpm dionysus notification deliver --notification-id "<notification-id>"
```

`e2e run-campaign` 有两种模式：

- `strict`：只自动通过通用 smoke / persistence；需要真实产品操作的 happy_path / negative_path 会标记 blocked，防止伪验收。
- `render-only`：只验证页面渲染和控制台错误，适合静态文档或演示型里程碑；不证明真实业务流程。

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
