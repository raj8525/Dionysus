import type { CodexOutboxEvent } from "./api.js";

export interface CodexOutboxDisplaySummary {
  title: string;
  subtitle: string;
  tone: "bad" | "warning" | "neutral";
  command: string;
  ackBlocked: boolean;
  payloadLabel: string;
}

const titleByType: Record<CodexOutboxEvent["eventType"], string> = {
  blocker: "阻塞事项",
  e2e_required: "需要 E2E",
  release_ready: "准备发布",
  user_notify: "通知用户"
};

export function buildCodexOutboxDisplaySummary(event: CodexOutboxEvent): CodexOutboxDisplaySummary {
  const ackBlocked = event.eventType === "release_ready";
  return {
    title: titleByType[event.eventType] ?? event.title,
    subtitle: event.summary || event.title,
    tone: event.severity === "error" ? "bad" : event.severity === "warning" ? "warning" : "neutral",
    command: ackBlocked
      ? `pnpm dionysus release record --goal-id ${event.goalId ?? "<goal-id>"} --codex-outbox-event-id ${event.id} ... && pnpm dionysus codex ack --event-id ${event.id}`
      : `pnpm dionysus codex ack --event-id ${event.id}`,
    ackBlocked,
    payloadLabel: summarizePayload(event.payload)
  };
}

function summarizePayload(payload: Record<string, unknown>): string {
  if (typeof payload.targetRoot === "string" || typeof payload.branch === "string") {
    return ["targetRoot", "branch"]
      .map((key) => [key, payload[key]] as const)
      .filter(([, value]) => typeof value === "string" && value.length > 0)
      .map(([key, value]) => `${key}=${value as string}`)
      .join(", ");
  }
  if (typeof payload.blocker === "string" && payload.blocker.length > 0) {
    return `blocker=${payload.blocker}`;
  }
  const pairs = ["source", "reason"]
    .map((key) => [key, payload[key]] as const)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([key, value]) => `${key}=${value as string}`);
  if (pairs.length > 0) return pairs.slice(0, 3).join(", ");
  const keys = Object.keys(payload);
  return keys.length ? keys.slice(0, 3).join(", ") : "无 payload";
}
