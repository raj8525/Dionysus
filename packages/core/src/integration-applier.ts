import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PatchApplyResult {
  status: "applied" | "blocked" | "failed";
  changedFiles: string[];
  reason?: string;
}

export async function applyPatchToTarget(input: {
  targetRoot: string;
  patchText: string;
  verificationCommands?: string[];
  allowedChangedFiles?: string[];
  protectedFiles?: string[];
  allowProtectedFiles?: string[];
}): Promise<PatchApplyResult> {
  const patchChangedFiles = changedFilesFromPatch(input.patchText);
  const scopeViolation = findAllowedScopeViolation({
    changedFiles: patchChangedFiles,
    allowedChangedFiles: input.allowedChangedFiles ?? []
  });
  if (scopeViolation.length > 0) {
    return {
      status: "blocked",
      changedFiles: patchChangedFiles,
      reason: `patch touches files outside allowed file scope: ${scopeViolation.join(", ")}`
    };
  }

  const protectedViolation = findProtectedFileViolation({
    changedFiles: patchChangedFiles,
    protectedFiles: input.protectedFiles ?? [],
    allowProtectedFiles: input.allowProtectedFiles ?? []
  });
  if (protectedViolation.length > 0) {
    return {
      status: "blocked",
      changedFiles: patchChangedFiles,
      reason: `patch touches protected files without explicit allow: ${protectedViolation.join(", ")}`
    };
  }

  const patchFile = await writeTempPatch(input.patchText);
  try {
    const check = await runGit(input.targetRoot, ["apply", "--check", patchFile]);
    if (check.exitCode !== 0) {
      return { status: "failed", changedFiles: [], reason: check.stderr };
    }

    const apply = await runGit(input.targetRoot, ["apply", patchFile]);
    if (apply.exitCode !== 0) {
      return { status: "failed", changedFiles: [], reason: apply.stderr };
    }

    const verification = await runVerificationCommands(input.targetRoot, input.verificationCommands ?? []);
    if (verification) {
      await runGit(input.targetRoot, ["apply", "-R", patchFile]);
      return { status: "failed", changedFiles: [], reason: verification };
    }

    return {
      status: "applied",
      changedFiles: patchChangedFiles
    };
  } finally {
    await rm(join(patchFile, ".."), { recursive: true, force: true });
  }
}

function changedFilesFromPatch(patchText: string): string[] {
  const files = new Set<string>();
  for (const line of patchText.split(/\r?\n/)) {
    if (!line.startsWith("diff --git ")) continue;
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (match?.[2]) {
      files.add(match[2].replace(/^"|"$/g, ""));
    }
  }
  return Array.from(files).sort();
}

function findAllowedScopeViolation(input: {
  changedFiles: string[];
  allowedChangedFiles: string[];
}): string[] {
  const allowedRules = normalizeRules(input.allowedChangedFiles);
  if (allowedRules.length === 0) return [];

  return input.changedFiles
    .map(normalizePath)
    .filter((file) => !matchesAnyRule(file, allowedRules));
}

function findProtectedFileViolation(input: {
  changedFiles: string[];
  protectedFiles: string[];
  allowProtectedFiles: string[];
}): string[] {
  const protectedRules = normalizeRules(input.protectedFiles);
  const allowRules = normalizeRules(input.allowProtectedFiles);
  if (protectedRules.length === 0) return [];

  return input.changedFiles
    .map(normalizePath)
    .filter((file) => matchesAnyRule(file, protectedRules) && !matchesAnyRule(file, allowRules));
}

function normalizeRules(rules: string[]): string[] {
  return rules.map(normalizePath).filter(Boolean);
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function matchesAnyRule(file: string, rules: string[]): boolean {
  return rules.some((rule) => {
    if (rule.endsWith("/")) return file.startsWith(rule);
    return file === rule;
  });
}

async function runVerificationCommands(cwd: string, commands: string[]): Promise<string | null> {
  for (const command of commands) {
    const result = await runShell(cwd, command);
    if (result.exitCode !== 0) {
      return `verification command failed: ${command}\n${result.stderr || result.stdout}`;
    }
  }
  return null;
}

async function writeTempPatch(patchText: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dionysus-patch-"));
  const patchFile = join(dir, "change.patch");
  await writeFile(patchFile, patchText);
  return patchFile;
}

async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 20
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
      exitCode: typeof err.code === "number" ? err.code : 1
    };
  }
}

async function runShell(cwd: string, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync("sh", ["-lc", command], {
      cwd,
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 20
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
      exitCode: typeof err.code === "number" ? err.code : 1
    };
  }
}
