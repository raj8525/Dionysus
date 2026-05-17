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

export interface WorkerEffectiveRunConfig {
  source: "role_config" | "runtime_fallback" | "unknown";
  cliType?: string;
  cliModel?: string;
  roleConfigEnabled?: boolean;
  runtimeCliType?: string;
  runtimeCliModel?: string;
}

export function deriveWorkerEffectiveRunConfig(input: {
  runtime?: WorkerRuntimeMetadata;
  roleConfig?: {
    cliType: string;
    cliModel?: string;
    enabled?: boolean;
  } | null;
}): WorkerEffectiveRunConfig {
  const runtimeCliType = input.runtime?.workerCliType;
  const runtimeCliModel = input.runtime?.workerCliModel;
  const roleConfigEnabled = input.roleConfig ? input.roleConfig.enabled !== false : undefined;

  if (input.roleConfig && roleConfigEnabled) {
    return {
      source: "role_config",
      cliType: input.roleConfig.cliType,
      cliModel: input.roleConfig.cliModel,
      roleConfigEnabled,
      runtimeCliType,
      runtimeCliModel
    };
  }

  if (runtimeCliType) {
    return {
      source: "runtime_fallback",
      cliType: runtimeCliType,
      cliModel: runtimeCliModel,
      roleConfigEnabled,
      runtimeCliType,
      runtimeCliModel
    };
  }

  return {
    source: "unknown",
    roleConfigEnabled,
    runtimeCliType,
    runtimeCliModel
  };
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
