import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createIsolatedWorkspace, createPatch } from "./workspace.js";

const execFileAsync = promisify(execFile);

describe("workspace patch creation", () => {
  it("includes tracked edits and untracked files in the generated patch", async () => {
    const root = await mkdtemp(join(tmpdir(), "dionysus-workspace-"));
    try {
      await execFileAsync("git", ["init"], { cwd: root });
      await writeFile(join(root, "README.md"), "before\n");
      await execFileAsync("git", ["add", "."], { cwd: root });
      await execFileAsync(
        "git",
        ["-c", "user.email=dionysus@example.local", "-c", "user.name=Dionysus", "commit", "-m", "init"],
        { cwd: root }
      );

      await writeFile(join(root, "README.md"), "after\n");
      await writeFile(join(root, "new-file.md"), "new\n");
      await writeFile(join(root, ".dionysus-workspace"), "task_id=test\n");
      const patch = await createPatch({ workspacePath: root });

      expect(patch.changedFiles).toEqual(["README.md", "new-file.md"]);
      expect(patch.patchText).toContain("diff --git a/README.md b/README.md");
      expect(patch.patchText).toContain("diff --git a/new-file.md b/new-file.md");
      expect(patch.patchText).not.toContain(".dionysus-workspace");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates a git-backed isolated workspace with no business diff at baseline", async () => {
    const source = await mkdtemp(join(tmpdir(), "dionysus-source-"));
    const workspaces = await mkdtemp(join(tmpdir(), "dionysus-workspaces-"));
    try {
      await execFileAsync("git", ["init"], { cwd: source });
      await writeFile(join(source, "README.md"), "baseline\n");
      await execFileAsync("git", ["add", "."], { cwd: source });
      await execFileAsync(
        "git",
        ["-c", "user.email=dionysus@example.local", "-c", "user.name=Dionysus", "commit", "-m", "init"],
        { cwd: source }
      );

      const workspace = await createIsolatedWorkspace({
        targetRoot: source,
        workspaceRoot: workspaces,
        taskId: "task-123"
      });
      const patch = await createPatch({ workspacePath: workspace.workspacePath });
      const marker = await readFile(join(workspace.workspacePath, ".dionysus-workspace"), "utf8");
      const remote = await execFileAsync("git", ["remote", "-v"], { cwd: workspace.workspacePath });

      expect(patch.changedFiles).toEqual([]);
      expect(patch.patchText).toBe("");
      expect(marker).not.toContain(source);
      expect(marker).toContain("synced_target_changes=false");
      expect(remote.stdout).toBe("");
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(workspaces, { recursive: true, force: true });
    }
  });

  it("syncs target worktree changes into the isolated workspace baseline", async () => {
    const source = await mkdtemp(join(tmpdir(), "dionysus-source-"));
    const workspaces = await mkdtemp(join(tmpdir(), "dionysus-workspaces-"));
    try {
      await execFileAsync("git", ["init"], { cwd: source });
      await writeFile(join(source, "README.md"), "committed\n");
      await execFileAsync("git", ["add", "."], { cwd: source });
      await execFileAsync(
        "git",
        ["-c", "user.email=dionysus@example.local", "-c", "user.name=Dionysus", "commit", "-m", "init"],
        { cwd: source }
      );

      await writeFile(join(source, "README.md"), "target dirty edit\n");
      await writeFile(join(source, "new-from-target.md"), "target untracked\n");

      const workspace = await createIsolatedWorkspace({
        targetRoot: source,
        workspaceRoot: workspaces,
        taskId: "task-dirty-target"
      });
      const readme = await readFile(join(workspace.workspacePath, "README.md"), "utf8");
      const newFile = await readFile(join(workspace.workspacePath, "new-from-target.md"), "utf8");
      const marker = await readFile(join(workspace.workspacePath, ".dionysus-workspace"), "utf8");
      const patch = await createPatch({ workspacePath: workspace.workspacePath });

      expect(readme).toBe("target dirty edit\n");
      expect(newFile).toBe("target untracked\n");
      expect(workspace.syncedTargetChanges).toBe(true);
      expect(marker).toContain("synced_target_changes=true");
      expect(patch.changedFiles).toEqual([]);
      expect(patch.patchText).toBe("");
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(workspaces, { recursive: true, force: true });
    }
  });
});
