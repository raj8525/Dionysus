import type { GoalStatus } from "./types.js";

export type CodexOutboxEventType = "blocker" | "e2e_required" | "release_ready" | "user_notify";
export type CodexOutboxSeverity = "info" | "warning" | "error";
export type CodexOutboxStatus = "pending" | "acked" | "cancelled";

export interface CodexOutboxEvent {
  id: string;
  goalId?: string;
  eventType: CodexOutboxEventType;
  severity: CodexOutboxSeverity;
  status: CodexOutboxStatus;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  ackedAt?: string;
}

export interface CodexOutboxDraft {
  goalId?: string;
  eventType: CodexOutboxEventType;
  severity: CodexOutboxSeverity;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}

export interface CodexOutboxReconciliationSummary {
  acked: number;
  eventIds: string[];
}

export interface CodexOutboxAckGateDecision {
  allowed: boolean;
  reason?: string;
}

export function shouldReconcileCodexOutboxForGoalStatus(input: {
  eventType: CodexOutboxEventType;
  outboxStatus: CodexOutboxStatus;
  goalStatus?: GoalStatus | null;
}): boolean {
  return input.outboxStatus === "pending"
    && input.eventType === "blocker"
    && (input.goalStatus === "done" || input.goalStatus === "cancelled");
}

export function buildCodexOutboxDraft(input: {
  goalId?: string;
  eventType: CodexOutboxEventType;
  reason: string;
  source: string;
  payload?: Record<string, unknown>;
}): CodexOutboxDraft {
  const titleByType: Record<CodexOutboxEventType, string> = {
    blocker: "Codex 介入请求：目标被阻断",
    e2e_required: "Codex 介入请求：需要 E2E 验收",
    release_ready: "Codex 介入请求：准备发布",
    user_notify: "Codex 介入请求：需要通知用户"
  };
  const severityByType: Record<CodexOutboxEventType, CodexOutboxSeverity> = {
    blocker: "error",
    e2e_required: "warning",
    release_ready: "warning",
    user_notify: "info"
  };
  const normalizedReason = input.reason.trim();
  const goalPart = input.goalId ?? "system";
  return {
    goalId: input.goalId,
    eventType: input.eventType,
    severity: severityByType[input.eventType],
    title: titleByType[input.eventType],
    summary: normalizedReason,
    payload: {
      ...input.payload,
      reason: normalizedReason,
      source: input.source
    },
    dedupeKey: `${goalPart}:${input.eventType}:${normalizedReason}`
  };
}

export function formatCodexOutboxReconciliation(input: CodexOutboxReconciliationSummary): {
  changed: boolean;
  userMessage: string;
} {
  if (input.acked === 0) {
    return {
      changed: false,
      userMessage: "没有发现可自动关闭的 Codex Outbox 事件。"
    };
  }
  return {
    changed: true,
    userMessage: `已自动关闭 ${input.acked} 个根因已解决的 Codex Outbox 事件。`
  };
}

export function formatCodexHeartbeat(events: CodexOutboxEvent[]): {
  hasWork: boolean;
  userMessage: string;
  nextActions: string[];
} {
  if (events.length === 0) {
    return {
      hasWork: false,
      userMessage: "当前没有待 Codex 介入的 Dionysus 事件。",
      nextActions: []
    };
  }

  const first = events[0];
  return {
    hasWork: true,
    userMessage: `Dionysus 有 ${events.length} 个待 Codex 介入事件。最高优先级：${first.title}。`,
    nextActions: [
      `处理 ${first.id}：${first.summary}`,
      `完成处理后运行：pnpm dionysus codex ack --event-id ${first.id}`
    ]
  };
}

export function evaluateCodexOutboxAckGate(input: {
  eventType: CodexOutboxEventType;
  releaseRecordCount: number;
  force?: boolean;
}): CodexOutboxAckGateDecision {
  if (input.force) {
    return { allowed: true };
  }
  if (input.eventType !== "release_ready") {
    return { allowed: true };
  }
  if (input.releaseRecordCount > 0) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: "release_ready requires a matching release record before ack"
  };
}
