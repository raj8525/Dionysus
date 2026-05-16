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

  it("waits for review even when a successful run has no patch", () => {
    expect(decidePostRunDispatch({ exitCode: 0 })).toEqual({
      action: "wait_for_review",
      reason: "successful run requires task review before dispatching next task"
    });
  });

  it("does not dispatch directly after integration because review is still required", () => {
    expect(shouldDispatchAfterIntegration({ applyStatus: "applied" })).toBe(false);
    expect(shouldDispatchAfterIntegration({ applyStatus: "blocked" })).toBe(false);
    expect(shouldDispatchAfterIntegration({ applyStatus: "failed" })).toBe(false);
  });
});
