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
    expect(testPrompt).toContain("只能编写 features_test/");
    expect(testPrompt).toContain("先失败的红灯测试证据");
    expect(workerPrompt).toContain("gate-check 已通过");
    expect(workerPrompt).toContain("产出 patch");
  });
});
