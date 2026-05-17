import { describe, expect, it } from "vitest";

import { buildCodexOutboxDisplaySummary } from "./codex-outbox-display.js";

describe("codex outbox display", () => {
  it("shows release_ready as blocked until Codex records a release", () => {
    const summary = buildCodexOutboxDisplaySummary({
      id: "outbox-release-1",
      goalId: "goal-1",
      eventType: "release_ready",
      title: "Codex 介入请求：准备发布",
      summary: "Integration gates passed",
      status: "pending",
      severity: "warning",
      payload: {
        goalId: "goal-1",
        source: "integration.release-ready",
        targetRoot: "/Volumes/MacMiniSSD/code/Coupon",
        branch: "main"
      },
      createdAt: "2026-05-17T10:00:00.000Z",
      updatedAt: "2026-05-17T10:00:00.000Z"
    });

    expect(summary).toEqual({
      title: "准备发布",
      subtitle: "Integration gates passed",
      tone: "warning",
      command: "pnpm dionysus release record --goal-id goal-1 --codex-outbox-event-id outbox-release-1 ... && pnpm dionysus codex ack --event-id outbox-release-1",
      ackBlocked: true,
      payloadLabel: "targetRoot=/Volumes/MacMiniSSD/code/Coupon, branch=main"
    });
  });

  it("allows normal blocker events to be acked directly after Codex resolves them", () => {
    const summary = buildCodexOutboxDisplaySummary({
      id: "outbox-blocker-1",
      goalId: "goal-1",
      eventType: "blocker",
      title: "Codex 介入请求：目标被阻断",
      summary: "目标项目工作区不干净",
      status: "pending",
      severity: "error",
      payload: {
        source: "readiness",
        blocker: "dirty worktree"
      },
      createdAt: "2026-05-17T10:00:00.000Z",
      updatedAt: "2026-05-17T10:00:00.000Z"
    });

    expect(summary.title).toBe("阻塞事项");
    expect(summary.tone).toBe("bad");
    expect(summary.ackBlocked).toBe(false);
    expect(summary.command).toBe("pnpm dionysus codex ack --event-id outbox-blocker-1");
    expect(summary.payloadLabel).toBe("blocker=dirty worktree");
  });
});
