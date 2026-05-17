import { describe, expect, it } from "vitest";
import { validateAgentRunIsolation } from "./agent-run-isolation.js";

describe("agent run isolation", () => {
  const targetRoot = "/Volumes/MacMiniSSD/code/Coupon";
  const workspacePath = "/Volumes/MacMiniSSD/code/Dionysus/.dionysus/workspaces/Coupon-task";

  it("allows non-master agents when prompt, cwd and marker stay inside workspace", () => {
    expect(validateAgentRunIsolation({
      role: "test_writer",
      cliType: "opencode",
      prompt: "只读取 Workspace Root 并编写 features_test。",
      cwd: workspacePath,
      targetRoot,
      workspacePath,
      workspaceMarker: "task_id=task-1\nsource=hidden\n"
    })).toEqual({ allowed: true, reasons: [] });
  });

  it("blocks non-master agents when the prompt leaks the target root", () => {
    const decision = validateAgentRunIsolation({
      role: "worker",
      cliType: "claude_code",
      prompt: `请修改 ${targetRoot}/apps/admin-web/src/pages/hotels.vue`,
      cwd: workspacePath,
      targetRoot,
      workspacePath,
      workspaceMarker: "task_id=task-1\nsource=hidden\n"
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("prompt leaks target root");
  });

  it("blocks non-master agents when cwd points at the target root", () => {
    const decision = validateAgentRunIsolation({
      role: "rule_writer",
      cliType: "gemini_cli",
      prompt: "编写规格。",
      cwd: `${targetRoot}/apps/admin-web`,
      targetRoot,
      workspaceMarker: "task_id=task-1\nsource=hidden\n"
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("cwd points inside target root");
  });

  it("allows Master because it is responsible for target-level orchestration", () => {
    expect(validateAgentRunIsolation({
      role: "master",
      cliType: "opencode",
      prompt: `检查 Target Root: ${targetRoot}`,
      cwd: targetRoot,
      targetRoot
    })).toEqual({ allowed: true, reasons: [] });
  });
});
