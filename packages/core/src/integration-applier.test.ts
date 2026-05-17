import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { applyPatchToTarget } from "./integration-applier.js";

const execFileAsync = promisify(execFile);

async function initRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dionysus-integrate-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await writeFile(join(root, "README.md"), "before\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync(
    "git",
    ["-c", "user.email=dionysus@example.local", "-c", "user.name=Dionysus", "commit", "-m", "init"],
    { cwd: root }
  );
  return root;
}

describe("integration patch applier", () => {
  it("applies a valid patch to a clean git target", async () => {
    const root = await initRepo();
    try {
      const patch = [
        "diff --git a/README.md b/README.md",
        "index 5a60f7d..61e9f52 100644",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1 +1 @@",
        "-before",
        "+after",
        ""
      ].join("\n");

      const result = await applyPatchToTarget({ targetRoot: root, patchText: patch });

      expect(result.status).toBe("applied");
      expect(result.changedFiles).toEqual(["README.md"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports a newly added file as changed after applying a patch", async () => {
    const root = await initRepo();
    try {
      const patch = [
        "diff --git a/new-file.md b/new-file.md",
        "new file mode 100644",
        "index 0000000..3e5126c",
        "--- /dev/null",
        "+++ b/new-file.md",
        "@@ -0,0 +1 @@",
        "+created by worker",
        ""
      ].join("\n");

      const result = await applyPatchToTarget({ targetRoot: root, patchText: patch });

      expect(result.status).toBe("applied");
      expect(result.changedFiles).toEqual(["new-file.md"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("applies a patch when target has unrelated uncommitted changes and reports only patch files", async () => {
    const root = await initRepo();
    try {
      await writeFile(join(root, "local.txt"), "do not overwrite\n");
      const patch = [
        "diff --git a/README.md b/README.md",
        "index 5a60f7d..61e9f52 100644",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1 +1 @@",
        "-before",
        "+after",
        ""
      ].join("\n");

      const result = await applyPatchToTarget({
        targetRoot: root,
        patchText: patch
      });

      expect(result.status).toBe("applied");
      expect(result.changedFiles).toEqual(["README.md"]);
      const status = await execFileAsync("git", ["status", "--porcelain"], { cwd: root });
      expect(status.stdout).toContain("README.md");
      expect(status.stdout).toContain("local.txt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when patch overlaps with conflicting uncommitted changes", async () => {
    const root = await initRepo();
    try {
      await writeFile(join(root, "README.md"), "local edit\n");
      const patch = [
        "diff --git a/README.md b/README.md",
        "index 5a60f7d..61e9f52 100644",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1 +1 @@",
        "-before",
        "+after",
        ""
      ].join("\n");

      const result = await applyPatchToTarget({
        targetRoot: root,
        patchText: patch
      });

      expect(result.status).toBe("failed");
      expect(result.reason).toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rolls back the patch when verification command fails", async () => {
    const root = await initRepo();
    try {
      const patch = [
        "diff --git a/README.md b/README.md",
        "index 5a60f7d..61e9f52 100644",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1 +1 @@",
        "-before",
        "+after",
        ""
      ].join("\n");

      const result = await applyPatchToTarget({
        targetRoot: root,
        patchText: patch,
        verificationCommands: ["false"]
      });
      const status = await execFileAsync("git", ["status", "--porcelain"], { cwd: root });

      expect(result.status).toBe("failed");
      expect(result.reason).toContain("verification command failed");
      expect(status.stdout.trim()).toBe("");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks patches that touch protected files unless explicitly allowed", async () => {
    const root = await initRepo();
    try {
      const protectedFile = "apps/admin-web/src/pages/hotels.vue";
      await execFileAsync("mkdir", ["-p", "apps/admin-web/src/pages"], { cwd: root });
      await writeFile(join(root, protectedFile), "before\n");
      await execFileAsync("git", ["add", "."], { cwd: root });
      await execFileAsync(
        "git",
        ["-c", "user.email=dionysus@example.local", "-c", "user.name=Dionysus", "commit", "-m", "add protected page"],
        { cwd: root }
      );

      const patch = [
        "diff --git a/apps/admin-web/src/pages/hotels.vue b/apps/admin-web/src/pages/hotels.vue",
        "index 5a60f7d..61e9f52 100644",
        "--- a/apps/admin-web/src/pages/hotels.vue",
        "+++ b/apps/admin-web/src/pages/hotels.vue",
        "@@ -1 +1 @@",
        "-before",
        "+after",
        ""
      ].join("\n");

      const blocked = await applyPatchToTarget({
        targetRoot: root,
        patchText: patch,
        protectedFiles: [protectedFile]
      });
      const statusAfterBlocked = await execFileAsync("git", ["status", "--porcelain"], { cwd: root });

      expect(blocked.status).toBe("blocked");
      expect(blocked.changedFiles).toEqual([protectedFile]);
      expect(blocked.reason).toContain(protectedFile);
      expect(statusAfterBlocked.stdout.trim()).toBe("");

      const allowed = await applyPatchToTarget({
        targetRoot: root,
        patchText: patch,
        protectedFiles: [protectedFile],
        allowProtectedFiles: [protectedFile]
      });

      expect(allowed.status).toBe("applied");
      expect(allowed.changedFiles).toEqual([protectedFile]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks patches that touch files outside the task allowed file scope", async () => {
    const root = await initRepo();
    try {
      await execFileAsync("mkdir", ["-p", "apps/admin-web/src/pages"], { cwd: root });
      await writeFile(join(root, "apps/admin-web/src/pages/inventory.vue"), "inventory before\n");
      await execFileAsync("git", ["add", "."], { cwd: root });
      await execFileAsync(
        "git",
        ["-c", "user.email=dionysus@example.local", "-c", "user.name=Dionysus", "commit", "-m", "add pages"],
        { cwd: root }
      );

      const patch = [
        "diff --git a/apps/admin-web/src/pages/inventory.vue b/apps/admin-web/src/pages/inventory.vue",
        "index 6cfca50..bd943e3 100644",
        "--- a/apps/admin-web/src/pages/inventory.vue",
        "+++ b/apps/admin-web/src/pages/inventory.vue",
        "@@ -1 +1 @@",
        "-inventory before",
        "+inventory after",
        "diff --git a/README.md b/README.md",
        "index 5a60f7d..61e9f52 100644",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1 +1 @@",
        "-before",
        "+after",
        ""
      ].join("\n");

      const blocked = await applyPatchToTarget({
        targetRoot: root,
        patchText: patch,
        allowedChangedFiles: ["apps/admin-web/src/pages/inventory.vue"]
      });
      const statusAfterBlocked = await execFileAsync("git", ["status", "--porcelain"], { cwd: root });

      expect(blocked.status).toBe("blocked");
      expect(blocked.changedFiles).toEqual(["README.md", "apps/admin-web/src/pages/inventory.vue"]);
      expect(blocked.reason).toContain("outside allowed file scope");
      expect(blocked.reason).toContain("README.md");
      expect(statusAfterBlocked.stdout.trim()).toBe("");

      const allowed = await applyPatchToTarget({
        targetRoot: root,
        patchText: patch,
        allowedChangedFiles: ["README.md", "apps/admin-web/src/pages/"]
      });

      expect(allowed.status).toBe("applied");
      expect(allowed.changedFiles).toEqual(["README.md", "apps/admin-web/src/pages/inventory.vue"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
