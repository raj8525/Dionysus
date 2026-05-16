import type { GateCheckResult } from "./gatekeeper.js";
import type { Goal } from "./types.js";

export interface RemediationFileDraft {
  path: string;
  content: string;
}

export function buildPreflightRemediation(input: {
  goal: Pick<Goal, "title" | "description" | "targetRoot">;
  gates: GateCheckResult[];
}): RemediationFileDraft[] {
  const missing = new Set(input.gates.flatMap((gate) => gate.missing));
  const drafts: RemediationFileDraft[] = [];

  if (missing.has("docs/PLAN.md")) {
    drafts.push({
      path: "docs/PLAN.md",
      content: [
        `# ${input.goal.title}`,
        "",
        "## 目标",
        input.goal.description,
        "",
        "## 范围",
        "- 由 Master 根据当前目标拆解。",
        "- 实现前必须冻结 specs，并先写 features_test。",
        "",
        "## 非目标",
        "- 不绕过 SDD / TDD 门禁。",
        "- 不在未通过 preflight 时直接修改主工作区。",
        "",
        "## 验收门禁",
        "- docs/specs/ 已包含契约、权限、错误码、验收口径。",
        "- features_test/ 已包含至少一个红灯测试说明。",
        "- Git 工作区干净后才允许集成 patch。",
        "- Codex E2E 通过后才能通知里程碑完成。"
      ].join("\n")
    });
  }

  if (missing.has("docs/specs")) {
    drafts.push({
      path: "docs/specs/acceptance.md",
      content: [
        "# Acceptance Spec",
        "",
        "## 契约要求",
        "- API、页面、数据表、权限点和错误码必须在实现前明确。",
        "",
        "## 测试要求",
        "- TestWriter 必须先提供红灯测试。",
        "- Worker 不得在测试缺失时实现。",
        "",
        "## 集成要求",
        "- Worker 只产出 patch。",
        "- Integration Worker 在主工作区干净且验证命令通过后才应用 patch。"
      ].join("\n")
    });
  }

  if (missing.has("features_test")) {
    drafts.push({
      path: "features_test/preflight.feature.md",
      content: [
        "# Preflight Feature",
        "",
        "## 场景：SDD/TDD 门禁完整后才允许实现",
        "",
        "Given 目标项目存在 docs/PLAN.md",
        "And 目标项目存在 docs/specs/ 下的规格文件",
        "And 目标项目存在 features_test/ 下的测试说明或测试代码",
        "When Dionysus 执行 target preflight",
        "Then preflight 的 gate 部分必须通过",
        "And 如果 Git 工作区干净，目标可以进入实现阶段"
      ].join("\n")
    });
  }

  return drafts;
}
