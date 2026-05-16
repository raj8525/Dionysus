import { describe, expect, it } from "vitest";

import { describeUsageScope, modelCallLabel } from "./agent-usage-display.js";

describe("agent usage display helpers", () => {
  it("describes usage scope with active goal and target project", () => {
    expect(describeUsageScope({
      goalId: "goal-123",
      goalTitle: "Coupon 管理后台",
      targetRoot: "/Volumes/MacMiniSSD/code/Coupon"
    })).toBe("当前项目 /Volumes/MacMiniSSD/code/Coupon · 目标 Coupon 管理后台 · goal-123");
  });

  it("falls back to all goals when no active goal is selected", () => {
    expect(describeUsageScope({})).toBe("当前没有选中目标，展示全部 Agent CLI 调用统计");
  });

  it("labels model calls as inferred when provider usage is unavailable", () => {
    expect(modelCallLabel()).toBe("Model Calls（估算）");
  });
});
