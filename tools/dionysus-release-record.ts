import { validateReleaseRecordEvidence } from "../packages/core/src/release-record.js";

export type ReleaseRecordStatus = "passed" | "failed" | "blocked";

export interface ReleaseVerificationInput {
  command: string;
  status: ReleaseRecordStatus;
  output?: string;
}

export interface ReleaseRecordRequest {
  goalId: string;
  codexOutboxEventId?: string;
  targetRoot: string;
  branch: string;
  commitSha: string;
  status: ReleaseRecordStatus;
  pushed: boolean;
  changedFiles: string[];
  verification: ReleaseVerificationInput[];
  summary: string;
}

export function buildReleaseRecordRequest(args: string[]): ReleaseRecordRequest {
  const request = {
    goalId: requiredFlag(args, "--goal-id"),
    codexOutboxEventId: readFlag(args, "--codex-outbox-event-id"),
    targetRoot: requiredFlag(args, "--target-root"),
    branch: requiredFlag(args, "--branch"),
    commitSha: requiredFlag(args, "--commit-sha"),
    status: readReleaseStatus(args, "--status"),
    pushed: readBooleanFlag(args, "--pushed", false),
    changedFiles: readChangedFiles(args),
    verification: readVerification(args),
    summary: readFlag(args, "--summary") ?? ""
  };
  const evidenceGate = validateReleaseRecordEvidence(request);
  if (!evidenceGate.allowed) {
    throw new Error(evidenceGate.reason);
  }
  return request;
}

function readChangedFiles(args: string[]): string[] {
  const repeated = readRepeatedFlag(args, "--changed-file");
  const json = readFlag(args, "--changed-files-json");
  if (!json) return repeated;
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("--changed-files-json must be a JSON string array");
  }
  return [...repeated, ...parsed];
}

function readVerification(args: string[]): ReleaseVerificationInput[] {
  const json = readFlag(args, "--verification-json");
  if (!json) return [];
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("--verification-json must be a JSON array");
  }
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`--verification-json[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    if (typeof record.command !== "string" || !record.command.trim()) {
      throw new Error(`--verification-json[${index}].command is required`);
    }
    if (record.status !== "passed" && record.status !== "failed" && record.status !== "blocked") {
      throw new Error(`--verification-json[${index}].status must be one of passed, failed, blocked`);
    }
    return {
      command: record.command,
      status: record.status,
      output: typeof record.output === "string" ? record.output : undefined
    };
  });
}

function readReleaseStatus(args: string[], name: string): ReleaseRecordStatus {
  const value = readFlag(args, name) ?? "passed";
  if (value === "passed" || value === "failed" || value === "blocked") {
    return value;
  }
  throw new Error(`${name} must be one of passed, failed, blocked`);
}

function readBooleanFlag(args: string[], name: string, fallback: boolean): boolean {
  const value = readFlag(args, name);
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function readRepeatedFlag(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) {
      values.push(args[index + 1]);
    }
  }
  return values;
}

function requiredFlag(args: string[], name: string): string {
  const value = readFlag(args, name);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}
