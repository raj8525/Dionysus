export interface RunCycleInput {
  preflight: Record<string, unknown>;
  masterStep: Record<string, unknown>;
  milestoneDetection: Record<string, unknown>;
  milestones: Array<Record<string, unknown>>;
  campaigns?: Array<Record<string, unknown>>;
}

export interface RunCycleSummary {
  status: "blocked" | "e2e_required" | "working";
  nextOwner: "Codex" | "Dionysus";
  nextActions: string[];
}

export function summarizeRunCycle(input: RunCycleInput): RunCycleSummary {
  const blockers = Array.isArray(input.preflight.blockers) ? input.preflight.blockers : [];
  const decision = input.masterStep.decision && typeof input.masterStep.decision === "object"
    ? input.masterStep.decision as Record<string, unknown>
    : {};

  if (String(input.preflight.status) === "blocked" || blockers.length > 0 || String(decision.action).startsWith("blocked")) {
    return {
      status: "blocked",
      nextOwner: "Codex",
      nextActions: ["清理目标项目 Git 工作区后重新运行 goal run-cycle"]
    };
  }

  const hasE2EWork = input.milestones.some((milestone) =>
    ["candidate", "e2e_required", "e2e_running", "e2e_blocked", "e2e_failed"].includes(String(milestone.status))
  ) || (input.campaigns ?? []).some((campaign) =>
    ["created", "running", "blocked", "failed"].includes(String(campaign.status))
  );

  if (hasE2EWork) {
    return {
      status: "e2e_required",
      nextOwner: "Codex",
      nextActions: ["执行浏览器级 E2E 后提交 case-result 和 milestone verdict"]
    };
  }

  return {
    status: "working",
    nextOwner: "Dionysus",
    nextActions: ["等待 Agent Runtime 或下一次 master-step 推进"]
  };
}
