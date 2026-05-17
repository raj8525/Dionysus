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
pnpm -s dionysus agent usage --target-root "/Volumes/MacMiniSSD/code/Coupon"
```

在目标项目执行：

```bash
cd /Volumes/MacMiniSSD/code/Coupon
git status --short --branch
```

如果目标项目不 clean，先识别来源，不要混入本轮工作。

## 创建目标

```bash
pnpm -s dionysus goal create \
  --title "简短目标" \
  --description "最终用户价值、范围、非目标、验收标准" \
  --target-root "/Volumes/MacMiniSSD/code/Coupon"
```

记录返回的 `goal-id`。

## 并行 WorkerCLI

把任务切成互不冲突的文件范围。每个任务都必须写清：

- 只允许修改哪些路径。
- 需要参考哪些 HTML / Vue / API / docs 文件。
- 预期产出是什么。
- 必须运行哪些测试。
- 禁止事项，例如不得整页注入 HTML、不得改成熟页面布局。

创建 Worker 任务：

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

为每个 Worker 产物创建 reviewer 任务，或让 Codex 读取 run / patch 后发起 reviewer：

```bash
pnpm -s dionysus task create \
  --goal-id "<goal-id>" \
  --role worker \
  --title "Reviewer: review WorkerA patch" \
  --description "按正确性、契约、测试、可维护性、UI一致性打分；低于90分必须给出返工清单"
```

Reviewer 低于 90 分：不要应用 patch，创建迭代 Worker 任务。

Reviewer 达到 90 分：Codex 继续做最终检查。

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
