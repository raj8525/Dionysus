import type { SystemEvent } from "./api.js";

export interface SeedEvidenceSummary {
  title: string;
  statusLabel: string;
  tone: "good" | "bad" | "neutral";
  detail: string;
  targetRoot: string;
}

export function buildSeedEvidenceSummary(event: SystemEvent): SeedEvidenceSummary {
  const migrationPath = stringValue(event.payload.migrationPath) ?? event.eventType;
  const status = stringValue(event.payload.status) ?? "unknown";
  const applyExitCode = event.payload.applyExitCode;
  const exitLabel = typeof applyExitCode === "number" ? `exit ${applyExitCode}` : "exit unknown";
  const verification = firstVerification(event.payload.verification);
  const detail = verification
    ? `${compactSqlCommand(verification.command)} => ${verification.stdout.trim() || `exit ${verification.exitCode}`}`
    : "无 verification 输出";
  return {
    title: migrationPath,
    statusLabel: `${status} / ${exitLabel}`,
    tone: event.eventType.includes("failed") || applyExitCode !== 0 ? "bad" : event.eventType.includes("dry_run") ? "neutral" : "good",
    detail,
    targetRoot: stringValue(event.payload.targetRoot) ?? "--"
  };
}

function firstVerification(value: unknown): {
  command: string;
  exitCode: number | null;
  stdout: string;
} | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0];
  if (!first || typeof first !== "object") return null;
  const record = first as Record<string, unknown>;
  return {
    command: stringValue(record.command) ?? "verification",
    exitCode: typeof record.exitCode === "number" ? record.exitCode : null,
    stdout: stringValue(record.stdout) ?? ""
  };
}

function compactSqlCommand(command: string): string {
  const match = command.match(/-tAc\s+"(.+)"$/);
  return match?.[1] ?? command;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
