import { execFile } from "node:child_process";
import { cp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface WorkspaceCreateResult {
  workspacePath: string;
  taskSlug: string;
  syncedTargetChanges: boolean;
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
  const removeRemote = await runCommand("git", ["remote", "remove", "origin"], workspacePath, 120_000);
  if (removeRemote.exitCode !== 0) {
    throw new Error(`Failed to scrub workspace git remote: ${removeRemote.stderr}`);
  }
  const syncedTargetChanges = await syncTargetWorktreeToWorkspace({
    targetRoot: input.targetRoot,
    workspacePath,
    taskSlug
  });
  await writeFile(
    join(workspacePath, ".dionysus-workspace"),
    `task_id=${input.taskId}\nsource=hidden\nsynced_target_changes=${syncedTargetChanges ? "true" : "false"}\n`
  );
  return { workspacePath, taskSlug, syncedTargetChanges };
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

async function syncTargetWorktreeToWorkspace(input: {
  targetRoot: string;
  workspacePath: string;
  taskSlug: string;
}): Promise<boolean> {
  const diff = await runCommand(
    "git",
    ["diff", "--binary", "HEAD", "--", ".", ":(exclude).dionysus-workspace"],
    input.targetRoot,
    120_000
  );
  if (diff.exitCode !== 0) {
    throw new Error(`Failed to read target worktree diff: ${diff.stderr}`);
  }

  if (diff.stdout.trim()) {
    const patchPath = join(input.workspacePath, `.dionysus-target-${input.taskSlug}.patch`);
    await writeFile(patchPath, diff.stdout);
    const apply = await runCommand("git", ["apply", "--binary", patchPath], input.workspacePath, 120_000);
    await unlink(patchPath).catch(() => undefined);
    if (apply.exitCode !== 0) {
      throw new Error(`Failed to apply target worktree diff to workspace: ${apply.stderr}`);
    }
  }

  const untracked = await runCommand(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    input.targetRoot,
    120_000
  );
  if (untracked.exitCode !== 0) {
    throw new Error(`Failed to list target untracked files: ${untracked.stderr}`);
  }
  const untrackedFiles = untracked.stdout
    .split("\0")
    .map((file) => file.trim())
    .filter((file) => file && file !== ".dionysus-workspace");

  for (const file of untrackedFiles) {
    const source = join(input.targetRoot, file);
    const destination = join(input.workspacePath, file);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true });
  }

  const status = await runCommand("git", ["status", "--porcelain"], input.workspacePath, 120_000);
  if (status.exitCode !== 0) {
    throw new Error(`Failed to inspect workspace baseline status: ${status.stderr}`);
  }
  if (!status.stdout.trim()) {
    return false;
  }

  const add = await runCommand("git", ["add", "-A", "."], input.workspacePath, 120_000);
  if (add.exitCode !== 0) {
    throw new Error(`Failed to stage workspace baseline: ${add.stderr}`);
  }
  const commit = await runCommand(
    "git",
    [
      "-c",
      "user.email=dionysus@example.local",
      "-c",
      "user.name=Dionysus",
      "commit",
      "-m",
      "dionysus workspace baseline"
    ],
    input.workspacePath,
    120_000
  );
  if (commit.exitCode !== 0) {
    throw new Error(`Failed to commit workspace baseline: ${commit.stderr}`);
  }
  return true;
}
