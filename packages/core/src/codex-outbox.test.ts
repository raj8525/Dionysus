import { describe, expect, it } from "vitest";

import {
  buildCodexOutboxDraft,
  evaluateCodexOutboxAckGate,
  formatCodexHeartbeat,
  formatCodexOutboxReconciliation
} from "./codex-outbox.js";

describe("codex outbox", () => {
  it("builds a blocker intervention event from a supervision stop", () => {
    expect(buildCodexOutboxDraft({
      goalId: "goal-1",
      eventType: "blocker",
      reason: "run-cycle blocked: clean git worktree",
      source: "goal.supervise"
    })).toMatchObject({
      goalId: "goal-1",
      eventType: "blocker",
      severity: "error",
      title: "Codex 介入请求：目标被阻断",
      summary: "run-cycle blocked: clean git worktree",
      dedupeKey: "goal-1:blocker:run-cycle blocked: clean git worktree",
      payload: {
        reason: "run-cycle blocked: clean git worktree",
        source: "goal.supervise"
      }
    });
  });

  it("formats empty heartbeat as no work", () => {
    expect(formatCodexHeartbeat([])).toEqual({
      hasWork: false,
      userMessage: "当前没有待 Codex 介入的 Dionysus 事件。",
      nextActions: []
    });
  });

  it("formats pending events into a concise intervention summary", () => {
    expect(formatCodexHeartbeat([
      {
        id: "event-1",
        goalId: "goal-1",
        eventType: "e2e_required",
        severity: "warning",
        status: "pending",
        title: "Codex 介入请求：需要 E2E 验收",
        summary: "库存流水查询闭环已达到里程碑",
        payload: { targetUrl: "http://localhost:5173" },
        createdAt: "2026-05-16T00:00:00.000Z",
        updatedAt: "2026-05-16T00:00:00.000Z"
      }
    ])).toEqual({
      hasWork: true,
      userMessage: "Dionysus 有 1 个待 Codex 介入事件。最高优先级：Codex 介入请求：需要 E2E 验收。",
      nextActions: [
        "处理 event-1：库存流水查询闭环已达到里程碑",
        "完成处理后运行：pnpm dionysus codex ack --event-id event-1"
      ]
    });
  });

  it("summarizes automatic reconciliation of stale outbox blockers", () => {
    expect(formatCodexOutboxReconciliation({ acked: 2, eventIds: ["event-1", "event-2"] })).toEqual({
      changed: true,
      userMessage: "已自动关闭 2 个根因已解决的 Codex Outbox 事件。"
    });
    expect(formatCodexOutboxReconciliation({ acked: 0, eventIds: [] })).toEqual({
      changed: false,
      userMessage: "没有发现可自动关闭的 Codex Outbox 事件。"
    });
  });

  it("requires a release record before acking release_ready", () => {
    expect(evaluateCodexOutboxAckGate({
      eventType: "release_ready",
      releaseRecordCount: 0
    })).toEqual({
      allowed: false,
      reason: "release_ready requires a matching release record before ack"
    });

    expect(evaluateCodexOutboxAckGate({
      eventType: "release_ready",
      releaseRecordCount: 1
    })).toEqual({ allowed: true });
  });

  it("allows non-release outbox ack without release records", () => {
    expect(evaluateCodexOutboxAckGate({
      eventType: "blocker",
      releaseRecordCount: 0
    })).toEqual({ allowed: true });
  });
});
