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
  if (domain === "goal" && action === "list") {
    const limit = readFlag(args, "--limit");
    return {
      path: `/api/goals${limit ? `?limit=${encodeURIComponent(limit)}` : ""}`,
      method: "GET"
    };
  }

  if (domain === "goal" && action === "status") {
    const goalId = requiredFlag(args, "--goal-id");
    return {
      path: `/api/goals/${encodeURIComponent(goalId)}/status`,
      method: "GET"
    };
  }

  if (domain === "goal" && action === "cancel") {
    const goalId = requiredFlag(args, "--goal-id");
    return {
      path: `/api/goals/${encodeURIComponent(goalId)}/cancel`,
      method: "POST"
    };
  }

  if (domain === "goal" && action === "fast-lane") {
    const goalId = requiredFlag(args, "--goal-id");
    return {
      path: `/api/goals/${encodeURIComponent(goalId)}/fast-lane`,
      method: "POST"
    };
  }

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

  if (domain === "integration" && action === "retry") {
    const integrationId = requiredFlag(args, "--integration-id");
    return {
      path: `/api/integrations/${encodeURIComponent(integrationId)}/retry`,
      method: "POST"
    };
  }

  if (domain === "release" && action === "list") {
    const goalId = readFlag(args, "--goal-id");
    return {
      path: `/api/releases${goalId ? `?goalId=${encodeURIComponent(goalId)}` : ""}`,
      method: "GET"
    };
  }

  if (domain === "agent" && action === "config" && args[2] === "list") {
    return {
      path: "/api/agent-cli-configs",
      method: "GET"
    };
  }

  if (domain === "run" && action === "logs") {
    const runId = requiredFlag(args, "--run-id");
    return {
      path: `/api/runs/${encodeURIComponent(runId)}/logs`,
      method: "GET"
    };
  }

  if (domain === "task" && action === "enqueue") {
    const taskId = requiredFlag(args, "--task-id");
    return {
      path: `/api/tasks/${encodeURIComponent(taskId)}/enqueue`,
      method: "POST"
    };
  }

  if (domain === "task" && action === "review") {
    const taskId = requiredFlag(args, "--task-id");
    return {
      path: `/api/tasks/${encodeURIComponent(taskId)}/review`,
      method: "POST"
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
