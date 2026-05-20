import { describe, expect, it } from "vitest";
import { buildRolePrompt } from "./role-prompt.js";

const goal = {
  id: "goal-1",
  title: "完整实现 Coupon",
  description: "按 SDD 和 TDD 推进 Coupon 系统。",
  targetRoot: "/Volumes/MacMiniSSD/code/Coupon"
};

describe("role prompt builder", () => {
  it("gives Master orchestration constraints and forbids implementation coding", () => {
    const prompt = buildRolePrompt({
      role: "master",
      goal,
      task: {
        id: "task-1",
        title: "拆解目标",
        description: "生成计划和任务树",
        roleRequired: "master"
      }
    });

    expect(prompt).toContain("Target Root: /Volumes/MacMiniSSD/code/Coupon");
    expect(prompt).toContain("你不得写业务实现代码");
    expect(prompt).toContain("是否达到里程碑级成果");
    expect(prompt).toContain("Codex 执行浏览器级 E2E");
    expect(prompt).toContain("部分里程碑");
    expect(prompt).toContain("真实数据库持久化");
    expect(prompt).toContain('DIONYSUS_DONE_JSON={"status":"done","modelCalls":1}');
  });

  it("separates RuleWriter, TestWriter and Worker responsibilities", () => {
    const rulePrompt = buildRolePrompt({
      role: "rule_writer",
      goal,
      task: {
        id: "rule-task",
        title: "冻结契约",
        description: "编写 specs",
        roleRequired: "rule_writer"
      }
    });
    const testPrompt = buildRolePrompt({
      role: "test_writer",
      goal,
      task: {
        id: "test-task",
        title: "编写红灯测试",
        description: "编写 features_test",
        roleRequired: "test_writer"
      }
    });
    const workerPrompt = buildRolePrompt({
      role: "worker",
      goal,
      task: {
        id: "worker-task",
        title: "实现功能",
        description: "提交 patch",
        roleRequired: "worker"
      }
    });

    expect(rulePrompt).toContain("只能编写或修订 docs/specs/");
    expect(rulePrompt).toContain("隔离 workspace");
    expect(testPrompt).toContain("只能编写 features_test/");
    expect(testPrompt).toContain("先失败的红灯测试证据");
    expect(testPrompt).toContain("隔离 workspace");
    expect(testPrompt).toContain("不得使用 stub");
    expect(workerPrompt).toContain("gate-check 已通过");
    expect(workerPrompt).toContain("产出 patch");
    expect(workerPrompt).toContain("最小可验证交付物");
    expect(workerPrompt).toContain("最后一行必须单独输出完成标记");
  });

  it("forces Worker to write only inside the isolated workspace", () => {
    const prompt = buildRolePrompt({
      role: "worker",
      goal,
      workspacePath: "/tmp/dionysus-workspaces/Coupon-worker-task",
      task: {
        id: "worker-task",
        title: "实现功能",
        description: "提交 patch",
        roleRequired: "worker"
      }
    });

    expect(prompt).toContain("Workspace Root: /tmp/dionysus-workspaces/Coupon-worker-task");
    expect(prompt).toContain("Target Root: hidden from this role; use Workspace Root only");
    expect(prompt).toContain("当前 CLI 的工作目录就是隔离 workspace");
    expect(prompt).toContain("禁止直接写入 Target Root 绝对路径");
    expect(prompt).toContain("所有文件修改必须使用相对路径");
    expect(prompt).not.toContain("Target Root: /Volumes/MacMiniSSD/code/Coupon");
  });

  it("rewrites target root references for non-master workspace tasks", () => {
    const prompt = buildRolePrompt({
      role: "test_writer",
      goal: {
        ...goal,
        description: "以 /Volumes/MacMiniSSD/code/Coupon 作为目标项目。"
      },
      workspacePath: "/tmp/dionysus-workspaces/Coupon-test-task",
      task: {
        id: "test-task",
        title: "编写 E2E",
        description: "读取 /Volumes/MacMiniSSD/code/Coupon/apps/admin-web/src/pages/hotels.vue 后写测试。",
        roleRequired: "test_writer"
      }
    });

    expect(prompt).toContain("/tmp/dionysus-workspaces/Coupon-test-task/apps/admin-web/src/pages/hotels.vue");
    expect(prompt).toContain("必须视为 /tmp/dionysus-workspaces/Coupon-test-task");
    expect(prompt).not.toContain("/Volumes/MacMiniSSD/code/Coupon");
  });

  it("includes recent rejection feedback when a task is rerun after review reject", () => {
    const prompt = buildRolePrompt({
      role: "worker",
      goal,
      workspacePath: "/tmp/dionysus-workspaces/Coupon-worker-task",
      task: {
        id: "worker-task",
        title: "补齐数据基座",
        description: "补充文档和测试证据",
        roleRequired: "worker"
      },
      taskEvents: [
        {
          eventType: "task.review_reject",
          createdAt: "2026-05-17T08:00:00.000Z",
          payload: {
            verdict: "reject",
            reason: "只输出分析，没有修改文件或 patch。",
            reviewScore: null
          }
        }
      ]
    });

    expect(prompt).toContain("## 上次审查反馈");
    expect(prompt).toContain("必须逐条修复以下反馈");
    expect(prompt).toContain("只输出分析，没有修改文件或 patch。");
  });

  it("tells reviewers when the workspace includes integrated target worktree changes", () => {
    const prompt = buildRolePrompt({
      role: "worker",
      goal,
      workspacePath: "/tmp/dionysus-workspaces/Coupon-reviewer-task",
      workspaceSyncedTargetChanges: true,
      task: {
        id: "reviewer-task",
        title: "FastLane Reviewer 1: D1 ReviewerCLI 90 分质量门禁",
        description: "审查所有 Worker 产物。",
        roleRequired: "worker"
      }
    });

    expect(prompt).toContain("## Workspace Baseline Evidence");
    expect(prompt).toContain("已同步目标工作区当前未提交改动");
    expect(prompt).toContain("不要仅按目标仓库 HEAD 判断");
  });

  it("injects Worker report logs into report-only Reviewer prompts", () => {
    const prompt = buildRolePrompt({
      role: "worker",
      goal,
      workspacePath: "/tmp/dionysus-workspaces/Coupon-reviewer-task",
      task: {
        id: "reviewer-task",
        title: "FastLane Reviewer 1: D1 产品验收评审",
        description: "Report-only mode: review Worker reports, not integrated patches.",
        roleRequired: "worker"
      },
      taskEvents: [
        {
          eventType: "reviewer.worker_reports_evidence",
          createdAt: "2026-05-20T07:30:00.000Z",
          payload: {
            workerReports: [
              {
                taskId: "worker-1",
                taskTitle: "FastLane Worker 1: D1 E2E 覆盖审计",
                taskStatus: "needs_review",
                runId: "run-1",
                runStatus: "succeeded",
                finishedAt: "2026-05-20T07:29:00.000Z",
                logExcerpt: "缺口：/identity/members/:id 缺少直达详情 E2E。"
              }
            ]
          }
        }
      ]
    });

    expect(prompt).toContain("## Worker Report Evidence");
    expect(prompt).toContain("从同一 goal 的 Worker run logs 自动注入");
    expect(prompt).toContain("不要用重新探索代码替代对 Worker 报告的审查");
    expect(prompt).toContain("FastLane Worker 1: D1 E2E 覆盖审计");
    expect(prompt).toContain("Run ID: run-1");
    expect(prompt).toContain("/identity/members/:id 缺少直达详情 E2E");
  });

  it("blocks report-only Reviewer prompts when no Worker report evidence exists", () => {
    const prompt = buildRolePrompt({
      role: "worker",
      goal,
      workspacePath: "/tmp/dionysus-workspaces/Coupon-reviewer-task",
      task: {
        id: "reviewer-task",
        title: "FastLane Reviewer 1: D1 产品验收评审",
        description: "Report-only mode: review Worker reports, not integrated patches.",
        roleRequired: "worker"
      },
      taskEvents: [
        {
          eventType: "reviewer.worker_reports_evidence",
          payload: { workerReports: [] }
        }
      ]
    });

    expect(prompt).toContain("没有找到可审查的 Worker run log");
    expect(prompt).toContain("你必须判定为 BLOCKED");
    expect(prompt).toContain("不得自行重新探索后假装已经审查 Worker 产物");
  });

  it("warns admin-web workers not to mutate package manager state", () => {
    const prompt = buildRolePrompt({
      role: "worker",
      goal,
      workspacePath: "/tmp/dionysus-workspaces/Coupon-admin-web-task",
      task: {
        id: "admin-web-task",
        title: "FastLane Worker 2: 租户管理 Vue 只读首页",
        description: "允许修改路径: apps/admin-web/src/pages/identity/roles.vue。运行前端构建验证。",
        roleRequired: "worker"
      }
    });

    expect(prompt).toContain("## 前端依赖与构建门禁");
    expect(prompt).toContain("不得运行 npm install");
    expect(prompt).toContain("不得生成或修改 package-lock.json");
    expect(prompt).toContain("pnpm --filter @coupon/admin-web build");
  });
});
