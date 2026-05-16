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
