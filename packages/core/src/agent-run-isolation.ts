import type { AgentRole, CliType } from "./types.js";

export interface AgentRunIsolationInput {
  role: AgentRole;
  cliType: CliType;
  prompt: string;
  cwd: string;
  targetRoot: string;
  workspacePath?: string;
  workspaceMarker?: string;
}

export interface AgentRunIsolationDecision {
  allowed: boolean;
  reasons: string[];
}

export function validateAgentRunIsolation(input: AgentRunIsolationInput): AgentRunIsolationDecision {
  if (input.role === "master") {
    return { allowed: true, reasons: [] };
  }

  const reasons: string[] = [];
  if (containsTargetRoot(input.prompt, input.targetRoot)) {
    reasons.push("prompt leaks target root");
  }
  if (pathIsInside(input.cwd, input.targetRoot)) {
    reasons.push("cwd points inside target root");
  }
  if (input.workspacePath && pathIsInside(input.workspacePath, input.targetRoot)) {
    reasons.push("workspace path points inside target root");
  }
  if (input.workspaceMarker && containsTargetRoot(input.workspaceMarker, input.targetRoot)) {
    reasons.push("workspace marker leaks target root");
  }

  return {
    allowed: reasons.length === 0,
    reasons
  };
}

function containsTargetRoot(value: string, targetRoot: string): boolean {
  const normalizedTarget = normalizePath(targetRoot);
  const normalizedValue = normalizePath(value);
  const escapedTarget = normalizedTarget.replaceAll(" ", "\\ ");
  return normalizedValue.includes(normalizedTarget) || normalizedValue.includes(escapedTarget);
}

function pathIsInside(candidate: string, root: string): boolean {
  const normalizedCandidate = trimTrailingSlash(normalizePath(candidate));
  const normalizedRoot = trimTrailingSlash(normalizePath(root));
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
