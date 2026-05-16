import type { SystemHealth } from "./api.js";

export interface SystemHealthSummary {
  overall: "ready" | "degraded";
  database: "ready" | "blocked";
  rabbitmq: "ready" | "blocked";
  worker: "ready" | "blocked";
  workerLabel: string;
}

export function summarizeSystemHealth(health: SystemHealth | null): SystemHealthSummary {
  if (!health) {
    return {
      overall: "degraded",
      database: "blocked",
      rabbitmq: "blocked",
      worker: "blocked",
      workerLabel: "unknown"
    };
  }

  const workerStatus = String(health.worker.status);
  const ageSeconds = typeof health.worker.ageSeconds === "number" ? `${health.worker.ageSeconds}s` : "n/a";
  return {
    overall: health.ok ? "ready" : "degraded",
    database: health.database.ok ? "ready" : "blocked",
    rabbitmq: health.rabbitmq.ok ? "ready" : "blocked",
    worker: health.worker.ok ? "ready" : "blocked",
    workerLabel: `${workerStatus} / ${ageSeconds}`
  };
}
