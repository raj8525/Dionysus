---
name: dionysus
description: Use when Codex needs to develop a project through Dionysus with low-cost CLI agents such as OpenCode/MiniMax, Gemini CLI, or Claude Code: create goals, split parallel worker tasks, run reviewer gates, inspect logs, enforce evidence, and decide when Codex must do final E2E or quality review.
---

# Dionysus

Dionysus 是给 Codex 用的 Agent Team 执行系统。目标不是让 Agent 自组织得很好看，而是让 Codex 用更便宜的 CLI Agent 并行产出，ReviewerCLI 先筛掉低质量结果，最后由 Codex 保证质量。

## 默认策略

优先使用 **Codex-directed fast lane**：

1. Codex 先读目标项目 `AGENTS.md` 和关键文档，自己确定当前最小可交付目标。
2. Codex 把目标拆成 1-4 个互不冲突的 WorkerCLI 任务。
3. WorkerCLI 只在 Dionysus 隔离 workspace 中工作，产出 patch、测试命令、风险说明。
4. ReviewerCLI 审核 Worker 产物并打分；低于 90 分退回 Worker 迭代。
5. 达到 90 分后，Codex 亲自检查 diff、运行测试、必要时做浏览器 E2E。
6. 只有 Codex 认可后，才应用到目标项目、提交、推送、通知用户。

复杂 Master / RuleWriter / TestWriter 状态机只在高风险功能、契约变化、财务/权限/库存链路或用户明确要求时启用。

## 每次开始

在 Dionysus 根目录执行：

```bash
cd /Volumes/MacMiniSSD/code/Dionysus
git status --short --branch
pnpm -s dionysus system doctor --brief
pnpm -s dionysus system readiness --target-root "/Volumes/MacMiniSSD/code/Coupon"
pnpm -s dionysus agent usage --target-root "/Volumes/MacMiniSSD/code/Coupon"
```

在目标项目执行：

```bash
cd /Volumes/MacMiniSSD/code/Coupon
git status --short --branch
```

如果 readiness 返回 `blocked`，先处理 `blockers`，不要启动 WorkerCLI。常见 blockers 包括目标项目不 clean、Worker 仍是 mock、真实 CLI 不可用、目标项目缺少 `AGENTS.md` / `docs/PLAN.md` / `docs/specs/` / `features_test/`。

如果目标项目存在明确属于用户或另一个 Agent 的既有改动，且本轮 Worker 文件范围不会碰它，可以显式允许该路径后再检查：

```bash
pnpm -s dionysus system readiness \
  --target-root "/Volumes/MacMiniSSD/code/Coupon" \
  --allow-dirty-path "apps/admin-web/src/pages/login.vue"
```

只允许已经识别归属的路径；不要用目录级允许掩盖不明改动。

## Fast Lane 目标创建

Coupon 真实模块优先使用专用数据先行模板，除非任务不是 Coupon 模块或需要非常特殊的拆分。它固定按“数据基座 → 只读 API → Vue 只读首页 → ReviewerCLI”拆任务，避免漏掉数据库虚拟数据、接口字段、动态页面和最终用户验收。

```bash
pnpm -s dionysus fastlane coupon-module-plan \
  --module "租户管理" \
  --title "租户管理只读闭环" \
  --description "让最终用户在酒店租户首页看到数据库中的完整租户事实数据" \
  --target-root "/Volumes/MacMiniSSD/code/Coupon" \
  --page "apps/admin-web/src/pages/hotels.vue" \
  --api "/api/admin/tenants" \
  --html-template "apps/admin-web/html/hotels.html"
```

确认计划后启动：

```bash
pnpm -s dionysus fastlane coupon-module-start \
  --module "租户管理" \
  --title "租户管理只读闭环" \
  --description "让最终用户在酒店租户首页看到数据库中的完整租户事实数据" \
  --target-root "/Volumes/MacMiniSSD/code/Coupon" \
  --page "apps/admin-web/src/pages/hotels.vue" \
  --api "/api/admin/tenants" \
  --html-template "apps/admin-web/html/hotels.html"
```

`coupon-module-start` 和普通 `fastlane start` 一样会先执行 readiness，支持 `--allow-dirty-path` 和 `--dry-run`。本模板默认禁止写路径，写接口只能在只读闭环验收后作为下一轮模块里程碑。

分阶段入队规则：

- `coupon-module-start` 只立即入队“数据基座”Worker。
- “只读 API”和“Vue 只读首页”Worker 先保持 `created`，避免跳过数据库虚拟数据。
- 数据基座完成后，Codex 先 review/approve，再运行 `fastlane status` 获取 API/Vue 入队命令。
- API/Vue 可以在数据基座通过后并发；ReviewerCLI 必须等全部 Worker done 后才启动。

```bash
pnpm -s dionysus fastlane plan \
  --title "简短目标" \
  --description "最终用户价值、范围、非目标、验收标准" \
  --target-root "/Volumes/MacMiniSSD/code/Coupon" \
  --worker "后端::明确文件范围、验收标准、测试命令" \
  --worker "前端::明确文件范围、验收标准、测试命令"
```

确认拆分后启动。`fastlane start` 会自动执行 readiness；如果目标项目存在未允许的脏改动、Worker 仍为 mock、CLI 不可用或 SDD/TDD 入口缺失，会直接失败，不会创建 goal / task：

```bash
pnpm -s dionysus fastlane start \
  --title "简短目标" \
  --description "最终用户价值、范围、非目标、验收标准" \
  --target-root "/Volumes/MacMiniSSD/code/Coupon" \
  --worker "后端::允许修改路径: apps/admin-api/internal/handler/example.go, apps/admin-api/internal/handler/example_test.go。验收标准、测试命令" \
  --worker "前端::允许修改路径: apps/admin-web/src/pages/example.vue。验收标准、测试命令" \
  --reviewer "ReviewerCLI 90分门禁::检查契约、测试、UI、真实数据与可合并性"
```

如需在已确认的既有脏路径旁边启动无关任务，必须把同一组 `--allow-dirty-path` 传给 `fastlane start`。

不确定是否会通过门禁时，先加 `--dry-run`。它会执行 readiness 和计划生成，但不创建 goal/task：

```bash
pnpm -s dionysus fastlane start \
  --title "门禁预演" \
  --description "只验证 readiness 和任务拆分，不启动 Worker" \
  --target-root "/Volumes/MacMiniSSD/code/Coupon" \
  --worker "后端::只读检查" \
  --dry-run
```

记录返回的 `goal-id`。`fastlane start` 通过 readiness 后会创建 `fast_lane` goal、入队 Worker 任务，并创建但默认不入队 Reviewer 任务。`fast_lane` goal 会被 Master Control 排除，防止完整 Master 状态机重复拆任务。

## 并行 WorkerCLI

把任务切成互不冲突的文件范围。每个任务都必须写清：

- 只允许修改哪些路径。
- 需要参考哪些 HTML / Vue / API / docs 文件。
- 预期产出是什么。
- 必须运行哪些测试。
- 禁止事项，例如不得整页注入 HTML、不得改成熟页面布局。

文件范围不是只给 Agent 看的提示词，而是 Dionysus 的硬门禁。Worker Runtime 会从任务描述中提取以下标记，并写入 `patches.allowed_files_json`：

```text
允许修改路径:
- apps/admin-web/src/pages/inventory.vue
- apps/admin-web/src/pages/inventory/
```

也支持 `Allowed files:`、`Allowed paths:`、`file scope:`、`允许修改文件:`、`文件范围:`、`只允许修改:`。Integration Worker 会在 `git apply` 前校验 patch 的 `changedFiles`，任何文件不在允许范围内都会直接 `blocked`，不会修改目标项目。创建 Worker 时不要省略文件范围。

Coupon 管理后台固定补充规则：

- 模块开发坚持“数据先行、先读后写”：先补数据库表结构和完整虚拟数据，再做只读接口和页面读取，最后才做写路径。
- `hotels.vue` 已经完成，不再参考 `apps/admin-web/html/hotels.html` 重写。
- 其他页面迁移 Vue 时参考 `apps/admin-web/html/` 对应模板，但必须重写为动态 Vue 页面。
- Worker prompt 必须显式写清：禁止 `v-html`、raw HTML import、长字符串整页模板；必须有响应式数据、接口调用、loading、error、empty state 和真实用户交互。
- `hotels.vue` 只允许在明确需要时做接口、路由或小范围交互增量，不允许重新套模板。

优先用 `fastlane start --worker` 创建 Worker。只有需要人工追加任务时才单独创建：

```bash
pnpm -s dionysus task create \
  --goal-id "<goal-id>" \
  --role worker \
  --title "WorkerA: ..." \
  --description "明确文件范围、验收标准、测试命令"
```

并行度建议：

- 1 个 Worker：高风险核心链路。
- 2 个 Worker：前端 + 后端可拆。
- 3-4 个 Worker：多个独立页面、文档/测试/实现分离，且文件范围不重叠。

## ReviewerCLI 门禁

Reviewer 任务默认由 `fastlane start` 创建但不入队，避免没有 Worker 产物时假审核。Worker patch 产出并完成 integration 后，再入队 reviewer：

```bash
pnpm -s dionysus task enqueue --task-id "<reviewer-task-id>"
```

如果已有普通 goal 需要切入 fast lane，先手动标记：

```bash
pnpm -s dionysus goal fast-lane --goal-id "<goal-id>" --reason "Codex controls this goal directly"
```

Reviewer 低于 90 分：不要应用 patch，创建迭代 Worker 任务。

Reviewer 达到 90 分：Codex 继续做最终检查。

Reviewer 任务 approve 时必须把分数交给 API：

```bash
pnpm -s dionysus task review --task-id "<reviewer-task-id>" --verdict approve --score 90 --reason "Reviewer gate accepted by Codex"
```

没有 `--score` 或低于 90 会被 API 拒绝。低于 90 时必须使用 `--verdict reject`，并在 `--reason` 中写清 WorkerCLI 需要修复的具体问题。

## Codex 最终检查

Codex 必须亲自做：

```bash
pnpm -s dionysus goal status --goal-id "<goal-id>"
pnpm -s dionysus integration list --goal-id "<goal-id>"
pnpm -s dionysus run logs --run-id "<run-id>"
```

对目标项目运行匹配范围的测试。前端到后端完整用户功能才算 milestone；milestone 必须写入：

```bash
pnpm -s dionysus integration evidence \
  --integration-id "<integration-id>" \
  --final-user-evidence "最终用户在浏览器完成主路径" \
  --persistence-evidence "刷新后真实数据库数据仍可见"
```

然后由 Codex 执行浏览器 E2E，不能用 render-only、mock 数据或开发者命令冒充。

## 安全规则

- 不让 CLI Agent 直接写目标项目；必须通过 Dionysus workspace patch。
- 如果 prompt、cwd 或 workspace marker 泄漏 Target Root，Dionysus 应阻断任务。
- 如果目标项目 git status 变化但不是 Codex 应用 patch 的结果，立即停下并隔离产物。
- 不追求“很多 Agent working”，只追求合法证据推进。

## 成本/速度原则

- 便宜 CLI 做批量产出、初稿、页面迁移、测试草案、重复修复。
- ReviewerCLI 先筛掉明显低质产物。
- Codex 只做架构判断、质量裁决、E2E 和合并。
- 当 Dionysus 流程本身拖慢产出时，回到 fast lane，不启用复杂 Master 流程。
