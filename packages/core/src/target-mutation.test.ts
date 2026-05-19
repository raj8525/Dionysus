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

  it("blocks unexplained mutation because isolated workers must not edit the target root directly", () => {
    expect(decideTargetMutationHandling({
      currentTaskId: "task-b",
      runStartedAt: "2026-05-17T04:13:38.000Z",
      integrations: []
    })).toEqual({
      action: "block",
      eventType: "target_root_mutation_blocked",
      severity: "error",
      reason: "target changed during isolated agent run without a concurrent integration; block the task because workers must only modify isolated workspaces"
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
