export interface ApiCommand {
  path: string;
  method: "GET" | "POST";
}

const goalPostActions: Record<string, string> = {
  intake: "intake",
  bootstrap: "bootstrap",
  "gate-check": "gate-check",
  remediation: "preflight-remediation",
  "remediation-patch": "preflight-remediation/patch",
  "release-ready": "integrations/release-ready"
};

export function resolveApiCommand(args: string[]): ApiCommand | undefined {
  const [domain, action] = args;
  if (domain === "goal" && action && goalPostActions[action]) {
    const goalId = requiredFlag(args, "--goal-id");
    return {
      path: `/api/goals/${goalId}/${goalPostActions[action]}`,
      method: "POST"
    };
  }

  if (domain === "integration" && action === "list") {
    const goalId = readFlag(args, "--goal-id");
    return {
      path: `/api/integrations${goalId ? `?goalId=${encodeURIComponent(goalId)}` : ""}`,
      method: "GET"
    };
  }

  if (domain === "agent" && action === "config" && args[2] === "list") {
    return {
      path: "/api/agent-cli-configs",
      method: "GET"
    };
  }

  return undefined;
}

function requiredFlag(args: string[], name: string): string {
  const value = readFlag(args, name);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}
