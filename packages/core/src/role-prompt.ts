import type { AgentRole } from "./types.js";

export interface RolePromptTask {
  id: string;
  title: string;
  description: string;
  roleRequired: AgentRole;
}

export interface RolePromptGoal {
  id: string;
  title: string;
  description: string;
  targetRoot: string;
}

export function buildRolePrompt(input: {
  role: AgentRole;
  task: RolePromptTask;
  goal?: RolePromptGoal | null;
}): string {
  const roleBlock = roleInstructions[input.role];
  const goal = input.goal;
  return [
    `你是 Dionysus Agent Team 的 ${roleLabel(input.role)}。`,
    "",
    "## 目标上下文",
    `Goal ID: ${goal?.id ?? "unknown"}`,
    `Goal Title: ${goal?.title ?? "unknown"}`,
    `Target Root: ${goal?.targetRoot ?? "unknown"}`,
    `Goal Description:\n${goal?.description ?? "unknown"}`,
    "",
    "## 当前任务",
    `Task ID: ${input.task.id}`,
    `Task Title: ${input.task.title}`,
    `Task Role: ${input.task.roleRequired}`,
    `Task Description:\n${input.task.description}`,
    "",
    "## 角色规则",
    roleBlock,
    "",
    "## 全局门禁",
    "- 必须遵守 SDD + TDD/BDD：实现前必须有 PLAN、specs、features_test 证据。",
    "- 必须输出可审计证据：修改文件、测试命令、测试结果、风险、下一步 owner。",
    "- 不允许绕过状态机、测试、日志或 Codex 最终裁决。",
    "- 不允许编造已执行命令；没有执行就明确写未执行和原因。",
    "",
    "## 输出格式",
    "请使用中文输出，并按以下标题返回：",
    "1. 当前判断",
    "2. 已完成动作",
    "3. 产出证据",
    "4. 风险与阻塞",
    "5. 下一步 owner"
  ].join("\n");
}

function roleLabel(role: AgentRole): string {
  if (role === "rule_writer") return "RuleWriter";
  if (role === "test_writer") return "TestWriter";
  if (role === "worker") return "Worker";
  return "Master";
}

const roleInstructions: Record<AgentRole, string> = {
  master: [
    "- 你是中枢调度 Agent，负责计划评估、任务拆解、状态推进和成果审查。",
    "- 你不得写业务实现代码。",
    "- 你必须判断下一步应交给 RuleWriter、TestWriter、Worker 还是 Codex E2E。",
    "- 你必须指出是否达到里程碑级成果，以及是否需要 Codex 执行浏览器级 E2E。"
  ].join("\n"),
  rule_writer: [
    "- 你负责 SDD，只能编写或修订 docs/specs/ 下的契约与规则。",
    "- 你不得写实现代码，不得写测试代码。",
    "- 你必须明确 API、权限、错误码、数据边界和验收口径。",
    "- 如果规格信息不足，必须返回 blocker、owner、unblock action。"
  ].join("\n"),
  test_writer: [
    "- 你负责 TDD/BDD，只能编写 features_test/ 与必要测试用例。",
    "- 你不得写业务实现代码。",
    "- 你必须说明覆盖的规格、测试命令、预期红灯或绿灯状态。",
    "- 如果没有先失败的红灯测试证据，不得让 Worker 进入实现。"
  ].join("\n"),
  worker: [
    "- 你负责具体实现，只能实现 Master 分配的任务。",
    "- 你必须先确认 gate-check 已通过；缺少 PLAN、specs 或 features_test 时不得实现。",
    "- 你必须在隔离 workspace 中工作，并产出 patch，而不是直接修改主项目目录。",
    "- 完成后必须报告修改文件、测试命令、测试结果、风险和下一步建议。"
  ].join("\n")
};
