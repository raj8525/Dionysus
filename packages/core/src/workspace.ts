import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface WorkspaceCreateResult {
  workspacePath: string;
  taskSlug: string;
}

export async function createIsolatedWorkspace(input: {
  targetRoot: string;
  workspaceRoot: string;
  taskId: string;
}): Promise<WorkspaceCreateResult> {
  const taskSlug = input.taskId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
  const workspacePath = join(input.workspaceRoot, `${basename(input.targetRoot)}-${taskSlug}`);
  await rm(workspacePath, { recursive: true, force: true });
  await mkdir(input.workspaceRoot, { recursive: true });
  const result = await runCommand(
    "git",
    ["clone", "--local", "--no-hardlinks", input.targetRoot, workspacePath],
    input.workspaceRoot,
    120_000
  );
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create git workspace: ${result.stderr}`);
  }
  await writeFile(join(workspacePath, ".dionysus-workspace"), `task_id=${input.taskId}\nsource=${input.targetRoot}\n`);
  return { workspacePath, taskSlug };
}

export async function createPatch(input: {
  workspacePath: string;
}): Promise<{ patchText: string; changedFiles: string[] }> {
  const intentToAdd = await runCommand("git", ["add", "-N", "."], input.workspacePath, 120_000);
  if (intentToAdd.exitCode !== 0) {
    throw new Error(`Workspace is not diffable: ${intentToAdd.stderr}`);
  }
  const pathspec = [".", ":(exclude).dionysus-workspace"];
  const diff = await runCommand("git", ["diff", "--binary", "--", ...pathspec], input.workspacePath, 120_000);
  if (diff.exitCode !== 0) {
    throw new Error(`Failed to create patch: ${diff.stderr}`);
  }
  const names = await runCommand("git", ["diff", "--name-only", "--", ...pathspec], input.workspacePath, 120_000);
  if (names.exitCode !== 0) {
    throw new Error(`Failed to list changed files: ${names.stderr}`);
  }
  return {
    patchText: diff.stdout,
    changedFiles: names.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  };
}

async function runCommand(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  try {
    const result = await execFileAsync(command, args, { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 * 20 });
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
