import { describe, expect, it } from "vitest";

import { buildServer } from "./server.js";
import type { DionysusRepository } from "@dionysus/db";

function reviewableTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    goal_id: "11111111-1111-4111-8111-111111111111",
    title: "FastLane Worker 1: 默认任务",
    description: "test task",
    role_required: "worker",
    assigned_agent_id: null,
    status: "needs_review",
    priority: 20,
    blocked_reason: null,
    current_attempt: 1,
    max_attempts: 3,
    created_at: "2026-05-20T00:00:00.000Z",
    updated_at: "2026-05-20T00:00:00.000Z",
    ...overrides
  };
}

describe("POST /api/tasks/:id/review", () => {
  it("blocks rejected FastLane Reviewer tasks and does not requeue ReviewerCLI", async () => {
    const task = reviewableTask({
      id: "reviewer-task",
      title: "FastLane Reviewer 1: D1身份页产品质量门禁"
    });
    const publishedMessages: unknown[] = [];
    const events: Array<{ taskId: string; eventType: string; payload: unknown }> = [];
    const markedBlocked: Array<{ taskId: string; reason: string }> = [];
    const reviewCalls: unknown[] = [];

    const repo = {
      getTask: async () => task,
      reviewTask: async (input: { nextStatus: string; reason: string }) => {
        reviewCalls.push(input);
        return {
          ...task,
          status: input.nextStatus,
          blocked_reason: input.nextStatus === "blocked" ? input.reason : null
        };
      },
      markTaskBlocked: async (input: { taskId: string; reason: string }) => {
        markedBlocked.push(input);
      },
      recordTaskEvent: async (taskId: string, eventType: string, payload: unknown) => {
        events.push({ taskId, eventType, payload });
      },
      createCodexOutboxEvent: async (draft: Record<string, unknown>) => ({
        id: "outbox-1",
        status: "pending",
        ...draft
      })
    } as unknown as DionysusRepository;

    const app = await buildServer({
      repo,
      logger: false,
      publishJson: async (...args: unknown[]) => {
        publishedMessages.push(args);
      }
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/tasks/reviewer-task/review",
        payload: {
          verdict: "reject",
          score: 78,
          reason: "Score 78: 产品路径未闭环"
        }
      });

      expect(response.statusCode).toBe(202);
      const body = response.json();
      expect(body.status).toBe("blocked");
      expect(body.codexTakeoverRequired).toBe(true);
      expect(body.codexOutboxEvent.eventType).toBe("blocker");
      expect(reviewCalls).toHaveLength(1);
      expect(reviewCalls[0]).toMatchObject({ nextStatus: "blocked" });
      expect(markedBlocked).toHaveLength(1);
      expect(events.map((event) => event.eventType)).toContain("task.review_fastlane_reviewer_rejected");
      expect(publishedMessages).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("keeps ordinary rejected Worker tasks queued for another WorkerCLI attempt", async () => {
    const task = reviewableTask({
      id: "worker-task",
      title: "FastLane Worker 1: 身份页错误态闭环"
    });
    const publishedMessages: unknown[] = [];
    const reviewCalls: unknown[] = [];

    const repo = {
      getTask: async () => task,
      reviewTask: async (input: { nextStatus: string }) => {
        reviewCalls.push(input);
        return {
          ...task,
          status: input.nextStatus
        };
      },
      countTaskReviewRejections: async () => 1
    } as unknown as DionysusRepository;

    const app = await buildServer({
      repo,
      logger: false,
      publishJson: async (...args: unknown[]) => {
        publishedMessages.push(args);
      }
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/tasks/worker-task/review",
        payload: {
          verdict: "reject",
          reason: "继续修复"
        }
      });

      expect(response.statusCode).toBe(202);
      expect(response.json().status).toBe("queued");
      expect(reviewCalls).toHaveLength(1);
      expect(reviewCalls[0]).toMatchObject({ nextStatus: "queued" });
      expect(publishedMessages).toHaveLength(1);
      expect(publishedMessages[0]).toMatchObject([
        "dionysus.worker",
        expect.objectContaining({
          task_id: "worker-task",
          type: "worker_task_review_rejected"
        })
      ]);
    } finally {
      await app.close();
    }
  });
});
