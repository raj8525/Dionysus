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

  it("rejects patch application when target has uncommitted changes", async () => {
    const root = await initRepo();
    try {
      await writeFile(join(root, "local.txt"), "do not overwrite\n");

      const result = await applyPatchToTarget({
        targetRoot: root,
        patchText: "diff --git a/README.md b/README.md\n"
      });

      expect(result.status).toBe("blocked");
      expect(result.reason).toContain("dirty");
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
});
