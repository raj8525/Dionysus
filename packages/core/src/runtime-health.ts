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
    runtime?: WorkerRuntimeMetadata;
  }
  | {
    ok: false;
    status: "stale";
    lastEventType: string;
    lastSeenAt: string;
    ageSeconds: number;
    maxAgeSeconds: number;
    runtime?: WorkerRuntimeMetadata;
  }
  | {
    ok: false;
    status: "missing";
    maxAgeSeconds: number;
  };

export interface WorkerRuntimeMetadata {
  pid?: number;
  runtimeInstanceId?: string;
  runtimeStartedAt?: string;
  codeCommitSha?: string;
  workerCliType?: string;
  workerCliModel?: string;
}

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
      maxAgeSeconds: input.maxAgeSeconds,
      runtime: normalizeWorkerRuntimeMetadata(latest.payload)
    };
  }

  return {
    ok: false,
    status: "stale",
    lastEventType: latest.eventType,
    lastSeenAt: latest.createdAt,
    ageSeconds,
    maxAgeSeconds: input.maxAgeSeconds,
    runtime: normalizeWorkerRuntimeMetadata(latest.payload)
  };
}

function normalizeWorkerRuntimeMetadata(payload: Record<string, unknown> | undefined): WorkerRuntimeMetadata | undefined {
  if (!payload) return undefined;
  const metadata: WorkerRuntimeMetadata = {};
  if (typeof payload.pid === "number") metadata.pid = payload.pid;
  if (typeof payload.runtimeInstanceId === "string") metadata.runtimeInstanceId = payload.runtimeInstanceId;
  if (typeof payload.runtimeStartedAt === "string") metadata.runtimeStartedAt = payload.runtimeStartedAt;
  if (typeof payload.codeCommitSha === "string") metadata.codeCommitSha = payload.codeCommitSha;
  if (typeof payload.workerCliType === "string") metadata.workerCliType = payload.workerCliType;
  if (typeof payload.workerCliModel === "string") metadata.workerCliModel = payload.workerCliModel;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}
