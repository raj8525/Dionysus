import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GateCheckResult } from "./gatekeeper.js";

const execFileAsync = promisify(execFile);

export interface GitPreflightResult {
  status: "passed" | "blocked";
  clean: boolean;
  changes: string[];
}

export interface TargetPreflightResult {
  status: "passed" | "blocked";
  git: GitPreflightResult;
  gates: GateCheckResult[];
  blockers: string[];
}

export function parseGitStatusPorcelain(output: string): GitPreflightResult {
  const changes = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  return {
    status: changes.length === 0 ? "passed" : "blocked",
    clean: changes.length === 0,
    changes
  };
}

export function parseGitStatusPath(change: string): string {
  const path = change.length > 3 ? change.slice(3).trim() : change.trim();
  const renameTarget = path.split(" -> ").at(-1);
  return renameTarget?.trim() ?? path;
}

export function findUnmanagedGitChanges(input: {
  changes: string[];
  managedPaths: string[];
}): string[] {
  const managed = new Set(input.managedPaths);
  return input.changes.filter((change) => !managed.has(parseGitStatusPath(change)));
}

export function buildTargetPreflight(input: {
  git: GitPreflightResult;
  gates: GateCheckResult[];
}): TargetPreflightResult {
  const blockers = [
    ...(!input.git.clean ? [`git worktree dirty: ${input.git.changes.length} changes`] : []),
    ...input.gates
      .filter((gate) => gate.status !== "passed")
      .map((gate) => `${gate.gateType} gate blocked: missing ${gate.missing.join(", ")}`)
  ];
  return {
    status: blockers.length ? "blocked" : "passed",
    git: input.git,
    gates: input.gates,
    blockers
  };
}

export async function checkGitPreflight(targetRoot: string): Promise<GitPreflightResult> {
  const result = await execFileAsync("git", ["status", "--porcelain"], {
    cwd: targetRoot,
    maxBuffer: 1024 * 1024
  });
  return parseGitStatusPorcelain(result.stdout);
}
