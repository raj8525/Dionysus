import type { AgentRole } from "./types.js";

export interface PlannedTaskDraft {
  title: string;
  description: string;
  roleRequired: AgentRole;
  priority: number;
}

export function buildMasterTaskTree(input: {
  goalTitle: string;
  targetRoot: string;
}): PlannedTaskDraft[] {
  return [
    {
      title: `[Master] 解析目标并冻结执行计划：${input.goalTitle}`,
      description: [
        `目标项目目录：${input.targetRoot}`,
        "读取 AGENTS.md、docs/PLAN.md、docs/specs/、features_test/。",
        "输出必须包含范围、非目标、阶段门禁、Worker 并发建议。"
      ].join("\n"),
      roleRequired: "master",
      priority: 10
    },
    {
      title: `[RuleWriter] 编写或补齐规格：${input.goalTitle}`,
      description: [
        "根据 PLAN.md 编写 docs/specs/ 下的契约、权限、错误码和验收口径。",
        "不得写实现代码，不得写测试代码。",
        "完成后必须说明覆盖的需求和剩余缺口。"
      ].join("\n"),
      roleRequired: "rule_writer",
      priority: 20
    },
    {
      title: `[TestWriter] 编写红灯测试：${input.goalTitle}`,
      description: [
        "根据 PLAN.md 和 docs/specs/ 编写 features_test/ 与必要自动化测试。",
        "测试必须先失败，并记录失败命令和失败原因。",
        "不得写业务实现代码。"
      ].join("\n"),
      roleRequired: "test_writer",
      priority: 30
    },
    {
      title: `[Worker] 最小实现：${input.goalTitle}`,
      description: [
        "只能在 Master 分配的范围内实现。",
        "不得在缺少 gate-check passed 时实现。",
        "必须在隔离 workspace 中工作，完成后提交 patch、修改文件、测试命令、风险和下一步。"
      ].join("\n"),
      roleRequired: "worker",
      priority: 40
    },
    {
      title: `[Master] Review、E2E 与通知：${input.goalTitle}`,
      description: [
        "检查 integration queue、review 结果、测试证据和 Codex E2E。",
        "通过后创建 milestone notification；失败则回到对应 owner。"
      ].join("\n"),
      roleRequired: "master",
      priority: 50
    }
  ];
}
