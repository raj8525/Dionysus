import { describe, expect, it } from "vitest";
import { buildMasterTaskTree } from "./master-planner.js";

describe("master planner", () => {
  it("creates the required SDD/TDD implementation task tree for a goal", () => {
    const tasks = buildMasterTaskTree({
      goalTitle: "实现 Coupon 租户新增闭环",
      targetRoot: "/Volumes/MacMiniSSD/code/Coupon"
    });

    expect(tasks.map((task) => task.roleRequired)).toEqual([
      "master",
      "rule_writer",
      "test_writer",
      "worker",
      "master"
    ]);
    expect(tasks[1].title).toContain("规格");
    expect(tasks[2].title).toContain("测试");
    expect(tasks[3].description).toContain("不得在缺少 gate-check passed 时实现");
    expect(tasks[3].description).toContain("一个最小可验证目标");
    expect(tasks[4].title).toContain("E2E");
  });
});
