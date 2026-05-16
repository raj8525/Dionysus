import { describe, expect, it } from "vitest";
import { decidePostRunDispatch, shouldDispatchAfterIntegration } from "./dispatch-policy.js";

describe("dispatch policy", () => {
  it("stops after failed runs", () => {
    expect(decidePostRunDispatch({ exitCode: 1 })).toEqual({
      action: "stop",
      reason: "run failed"
    });
  });

  it("waits for integration when a run produced a patch", () => {
    expect(decidePostRunDispatch({ exitCode: 0, queuedPatchId: "patch-1" })).toEqual({
      action: "wait_for_integration",
      reason: "patch must be applied before the next task can run",
      patchId: "patch-1"
    });
  });

  it("dispatches the next task only when no patch needs integration", () => {
    expect(decidePostRunDispatch({ exitCode: 0 })).toEqual({
      action: "dispatch_next",
      reason: "run succeeded without target patch"
    });
  });

  it("continues only after integration applied", () => {
    expect(shouldDispatchAfterIntegration({ applyStatus: "applied" })).toBe(true);
    expect(shouldDispatchAfterIntegration({ applyStatus: "blocked" })).toBe(false);
    expect(shouldDispatchAfterIntegration({ applyStatus: "failed" })).toBe(false);
  });
});
