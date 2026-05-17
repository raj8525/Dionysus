import { describe, expect, it } from "vitest";

import {
  decideTargetMutationHandling,
  targetMutationExplainedByConcurrentIntegration
} from "./target-mutation.js";

describe("target mutation attribution", () => {
  it("treats target dirtiness as explained when another task integration passed after run start", () => {
    expect(targetMutationExplainedByConcurrentIntegration({
      currentTaskId: "task-b",
      runStartedAt: "2026-05-17T04:13:38.000Z",
      integrations: [
        {
          taskId: "task-a",
          status: "passed",
          updatedAt: "2026-05-17T04:16:49.000Z"
        }
      ]
    })).toBe(true);
  });

  it("does not explain mutation from the same task or stale integrations", () => {
    expect(targetMutationExplainedByConcurrentIntegration({
      currentTaskId: "task-a",
      runStartedAt: "2026-05-17T04:13:38.000Z",
      integrations: [
        {
          taskId: "task-a",
          status: "passed",
          updatedAt: "2026-05-17T04:16:49.000Z"
        }
      ]
    })).toBe(false);

    expect(targetMutationExplainedByConcurrentIntegration({
      currentTaskId: "task-b",
      runStartedAt: "2026-05-17T04:13:38.000Z",
      integrations: [
        {
          taskId: "task-a",
          status: "passed",
          updatedAt: "2026-05-17T04:12:00.000Z"
        }
      ]
    })).toBe(false);
  });

  it("does not explain failed integrations or invalid timestamps", () => {
    expect(targetMutationExplainedByConcurrentIntegration({
      currentTaskId: "task-b",
      runStartedAt: "2026-05-17T04:13:38.000Z",
      integrations: [
        {
          taskId: "task-a",
          status: "failed",
          updatedAt: "2026-05-17T04:16:49.000Z"
        }
      ]
    })).toBe(false);

    expect(targetMutationExplainedByConcurrentIntegration({
      currentTaskId: "task-b",
      runStartedAt: "not-a-date",
      integrations: [
        {
          taskId: "task-a",
          status: "passed",
          updatedAt: "2026-05-17T04:16:49.000Z"
        }
      ]
    })).toBe(false);
  });

  it("continues with a warning when mutation is unexplained because release gates own final file attribution", () => {
    expect(decideTargetMutationHandling({
      currentTaskId: "task-b",
      runStartedAt: "2026-05-17T04:13:38.000Z",
      integrations: []
    })).toEqual({
      action: "continue",
      eventType: "target_root_mutation_observed",
      severity: "warning",
      reason: "target changed during isolated agent run; continue and leave ownership checks to integration and release gates"
    });
  });

  it("continues with an info event when mutation is explained by concurrent integration", () => {
    expect(decideTargetMutationHandling({
      currentTaskId: "task-b",
      runStartedAt: "2026-05-17T04:13:38.000Z",
      integrations: [
        {
          taskId: "task-a",
          status: "passed",
          updatedAt: "2026-05-17T04:16:49.000Z"
        }
      ]
    })).toEqual({
      action: "continue",
      eventType: "target_root_mutation_explained_by_integration",
      severity: "info",
      reason: "target changed while another task integration passed after this run started"
    });
  });
});
