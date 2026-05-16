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
