import { describe, expect, it } from "vitest";

import { shouldDispatchAfterTaskReview, taskReviewStatusForVerdict } from "./task-review.js";

describe("taskReviewStatusForVerdict", () => {
  it("maps review verdicts to legal task statuses", () => {
    expect(taskReviewStatusForVerdict("approve")).toBe("done");
    expect(taskReviewStatusForVerdict("reject")).toBe("queued");
    expect(taskReviewStatusForVerdict("block")).toBe("blocked");
  });

  it("dispatches the next task only after approve", () => {
    expect(shouldDispatchAfterTaskReview("approve")).toBe(true);
    expect(shouldDispatchAfterTaskReview("reject")).toBe(false);
    expect(shouldDispatchAfterTaskReview("block")).toBe(false);
  });
});
