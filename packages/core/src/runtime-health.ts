export interface RuntimeHealthEvent {
  eventType: string;
  createdAt: string;
  payload?: Record<string, unknown>;
}

export interface WorkerHealthInput {
  nowIso: string;
  maxAgeSeconds: number;
  events: RuntimeHealthEvent[];
}

export type WorkerHealth =
  | {
    ok: true;
    status: "ok";
    lastEventType: string;
    lastSeenAt: string;
    ageSeconds: number;
    maxAgeSeconds: number;
  }
  | {
    ok: false;
    status: "stale";
    lastEventType: string;
    lastSeenAt: string;
    ageSeconds: number;
    maxAgeSeconds: number;
  }
  | {
    ok: false;
    status: "missing";
    maxAgeSeconds: number;
  };

export function deriveWorkerHealth(input: WorkerHealthInput): WorkerHealth {
  const latest = input.events
    .filter((event) => event.eventType === "worker.heartbeat" || event.eventType === "worker.started")
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];

  if (!latest) {
    return {
      ok: false,
      status: "missing",
      maxAgeSeconds: input.maxAgeSeconds
    };
  }

  const ageSeconds = Math.max(0, Math.floor((Date.parse(input.nowIso) - Date.parse(latest.createdAt)) / 1000));
  if (ageSeconds <= input.maxAgeSeconds) {
    return {
      ok: true,
      status: "ok",
      lastEventType: latest.eventType,
      lastSeenAt: latest.createdAt,
      ageSeconds,
      maxAgeSeconds: input.maxAgeSeconds
    };
  }

  return {
    ok: false,
    status: "stale",
    lastEventType: latest.eventType,
    lastSeenAt: latest.createdAt,
    ageSeconds,
    maxAgeSeconds: input.maxAgeSeconds
  };
}
