import { describe, expect, it } from "vitest";
import { targetRootForGoal } from "./target-root.js";

describe("worker target root resolution", () => {
  it("uses the goal target root instead of the process fallback", () => {
    expect(
      targetRootForGoal(
        {
          id: "goal-1",
          title: "Sandbox",
          description: "Use sandbox",
          targetRoot: "/tmp/dionysus-sandbox",
          status: "created",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        "/Volumes/MacMiniSSD/code/Coupon"
      )
    ).toBe("/tmp/dionysus-sandbox");
  });

  it("falls back only when the task has no goal", () => {
    expect(targetRootForGoal(null, "/Volumes/MacMiniSSD/code/Coupon")).toBe("/Volumes/MacMiniSSD/code/Coupon");
  });
});
