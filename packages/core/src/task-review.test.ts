import { describe, expect, it } from "vitest";

import { taskReviewStatusForVerdict } from "./task-review.js";

describe("taskReviewStatusForVerdict", () => {
  it("maps review verdicts to legal task statuses", () => {
    expect(taskReviewStatusForVerdict("approve")).toBe("done");
    expect(taskReviewStatusForVerdict("reject")).toBe("queued");
    expect(taskReviewStatusForVerdict("block")).toBe("blocked");
  });
});
