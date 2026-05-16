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
}): Promise<PatchApplyResult> {
  const dirty = await runGit(input.targetRoot, ["status", "--porcelain"]);
  if (dirty.exitCode !== 0) {
    return { status: "failed", changedFiles: [], reason: dirty.stderr };
  }
  if (dirty.stdout.trim().length > 0) {
    return { status: "blocked", changedFiles: [], reason: "target git worktree is dirty" };
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

    const names = await runGit(input.targetRoot, ["status", "--porcelain"]);
    return {
      status: "applied",
      changedFiles: changedFilesFromPorcelain(names.stdout)
    };
  } finally {
    await rm(join(patchFile, ".."), { recursive: true, force: true });
  }
}

function changedFilesFromPorcelain(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((path) => path.replace(/^"|"$/g, ""));
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
