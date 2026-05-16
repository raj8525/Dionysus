# Dionysus MVP 开发计划

日期：2026-05-16

## 目标

开发 Dionysus Agent Team 执行系统的第一版可运行 MVP，使 Codex 可以创建目标、驱动 Master 拆解任务、通过 RabbitMQ 调度 Agent Runtime、记录 PostgreSQL 证据，并在前端看到目标、任务、Agent 和里程碑流程。

## 第一阶段范围

本阶段先交付可运行骨架：

- TypeScript monorepo。
- Fastify API。
- Vite React 前端。
- PostgreSQL migration。
- RabbitMQ producer / consumer。
- MockAdapter。
- goals / tasks / runs / events / milestones 基础表。
- Dashboard / Flow 前端壳。
- Coupon target 配置。

## 非目标

- 不直接实现完整 Coupon。
- 不在第一阶段接入真实 Claude Code / Gemini / OpenCode 执行。
- 不在第一阶段实现完整通知渠道。
- 不在第一阶段自动改写 Coupon。

## 验收标准

- `pnpm install` 成功。
- `pnpm test` 成功。
- `pnpm typecheck` 成功。
- `pnpm db:migrate` 可连接数据库并创建 schema。
- `pnpm dev:api` 可启动 API。
- `pnpm dev:web` 可启动前端。
- API 可创建 goal。
- Flow 页面能展示目标和默认执行流程。

## 后续阶段

1. CLI Adapter 接入。
2. Document Compiler 和 Gap Scanner。
3. Spec/Test Gatekeeper。
4. Worker 隔离 workspace 和 patch queue。
5. Milestone Detector。
6. Codex E2E Campaign。
7. Notification Service。
8. Coupon 真实试运行。
