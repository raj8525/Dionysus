import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { checkSpecTestGate } from "./gatekeeper.js";

describe("spec/test gatekeeper", () => {
  it("blocks implementation when PLAN, specs, or tests are missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "dionysus-gate-empty-"));
    try {
      const checks = await checkSpecTestGate(root);
      expect(checks.map((check) => check.status)).toEqual(["blocked", "blocked", "blocked"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes when PLAN, specs, and feature tests exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "dionysus-gate-ready-"));
    try {
      await mkdir(join(root, "docs/specs"), { recursive: true });
      await mkdir(join(root, "features_test"), { recursive: true });
      await writeFile(join(root, "docs/PLAN.md"), "# Plan\n");
      await writeFile(join(root, "docs/specs/api.md"), "# API\n");
      await writeFile(join(root, "features_test/smoke.feature.md"), "# Feature\n");

      const checks = await checkSpecTestGate(root);
      expect(checks.map((check) => check.status)).toEqual(["passed", "passed", "passed"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
