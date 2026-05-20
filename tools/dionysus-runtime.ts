import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

export interface RuntimeProcessSpec {
  name: "api" | "worker";
  cwd: string;
  command: string;
  args: string[];
  logFile: string;
  pidFile: string;
}

export interface RuntimeProcessStatus {
  name: RuntimeProcessSpec["name"];
  pid?: number;
  running: boolean;
  pidFile: string;
  logFile: string;
}

export interface RuntimeStatusSummary {
  ok: boolean;
  ready?: boolean;
  readiness?: {
    attempts: number;
    healthUrl?: string;
    timeoutMs: number;
  };
  processes: RuntimeProcessStatus[];
  nextAction: string;
}

export interface RuntimeHealPlan {
  action: "none" | "start" | "restart";
  reason: string;
  nextAction: string;
}

export function buildRuntimeProcessSpecs(input: {
  repoRoot: string;
  logDir?: string;
  pidDir?: string;
}): RuntimeProcessSpec[] {
  const repoRoot = resolve(input.repoRoot);
  const logDir = resolve(repoRoot, input.logDir ?? ".dionysus/logs");
  const pidDir = resolve(repoRoot, input.pidDir ?? ".dionysus/pids");
  const tsxBin = join(repoRoot, "node_modules/.bin/tsx");
  return [
    {
      name: "api",
      cwd: join(repoRoot, "apps/api"),
      command: tsxBin,
      args: ["src/server.ts"],
      logFile: join(logDir, "api.log"),
      pidFile: join(pidDir, "api.pid")
    },
    {
      name: "worker",
      cwd: join(repoRoot, "apps/worker"),
      command: tsxBin,
      args: ["src/worker.ts"],
      logFile: join(logDir, "worker.log"),
      pidFile: join(pidDir, "worker.pid")
    }
  ];
}

export function summarizeRuntimeStatus(processes: RuntimeProcessStatus[]): {
  ok: boolean;
  processes: RuntimeProcessStatus[];
  nextAction: string;
} {
  const ok = processes.every((process) => process.running);
  return {
    ok,
    processes,
    nextAction: ok ? "运行 pnpm dionysus system doctor --brief 验证依赖" : "运行 pnpm dionysus system runtime start"
  };
}

export function getRuntimeStatus(specs: RuntimeProcessSpec[]): ReturnType<typeof summarizeRuntimeStatus> {
  return summarizeRuntimeStatus(specs.map((spec) => {
    const pid = readPid(spec.pidFile);
    return {
      name: spec.name,
      pid,
      running: pid ? isPidRunning(pid) : false,
      pidFile: spec.pidFile,
      logFile: spec.logFile
    };
  }));
}

export function buildRuntimeHealPlan(input: {
  processStatus: Pick<RuntimeStatusSummary, "ok" | "processes">;
  health?: unknown;
  currentCodeCommitSha?: string;
}): RuntimeHealPlan {
  if (!input.processStatus.ok) {
    const stopped = input.processStatus.processes
      .filter((process) => !process.running)
      .map((process) => process.name)
      .join(", ");
    return {
      action: "start",
      reason: stopped ? `process not running: ${stopped}` : "runtime process missing",
      nextAction: "运行 pnpm dionysus system runtime start"
    };
  }

  const health = record(input.health);
  const apiCodeCommitSha = readApiCodeCommitSha(health);
  if (
    input.currentCodeCommitSha
    && apiCodeCommitSha
    && apiCodeCommitSha !== input.currentCodeCommitSha
  ) {
    return {
      action: "restart",
      reason: `api runtime commit stale: ${apiCodeCommitSha} != ${input.currentCodeCommitSha}`,
      nextAction: "重启 Dionysus runtime 并重新检查 doctor/readiness"
    };
  }

  const worker = record(health.worker);
  if (worker.ok === false) {
    return {
      action: "restart",
      reason: `worker health ${String(worker.status ?? "not ok")}`,
      nextAction: "重启 Dionysus runtime 并重新检查 doctor/readiness"
    };
  }

  const workerCodeCommitSha = readWorkerCodeCommitSha(worker);
  if (
    input.currentCodeCommitSha
    && workerCodeCommitSha
    && workerCodeCommitSha !== input.currentCodeCommitSha
  ) {
    return {
      action: "restart",
      reason: `worker runtime commit stale: ${workerCodeCommitSha} != ${input.currentCodeCommitSha}`,
      nextAction: "重启 Dionysus runtime 并重新检查 doctor/readiness"
    };
  }

  if (health.ok === false) {
    return {
      action: "none",
      reason: "runtime processes are running, but health is blocked by a non-worker dependency",
      nextAction: "运行 pnpm dionysus system doctor --brief 查看 database/rabbitmq/API blocker"
    };
  }

  return {
    action: "none",
    reason: "runtime healthy",
    nextAction: "继续执行 Dionysus goal/readiness/fastlane"
  };
}

export async function startRuntime(
  specs: RuntimeProcessSpec[],
  options: {
    healthUrl?: string;
    readinessTimeoutMs?: number;
    readinessIntervalMs?: number;
  } = {}
): Promise<RuntimeStatusSummary> {
  mkdirSync(resolve(specs[0]?.logFile ?? ".dionysus/logs", ".."), { recursive: true });
  mkdirSync(resolve(specs[0]?.pidFile ?? ".dionysus/pids", ".."), { recursive: true });

  for (const spec of specs) {
    const existingPid = readPid(spec.pidFile);
    if (existingPid && isPidRunning(existingPid)) {
      continue;
    }
    const logFd = openSync(spec.logFile, "a");
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      detached: true,
      env: process.env,
      stdio: ["ignore", logFd, logFd]
    });
    child.unref();
    writeFileSync(spec.pidFile, `${child.pid ?? ""}\n`, "utf8");
  }

  return waitForRuntimeReady({
    timeoutMs: options.readinessTimeoutMs ?? 10_000,
    intervalMs: options.readinessIntervalMs ?? 200,
    healthUrl: options.healthUrl ?? defaultRuntimeHealthUrl(),
    status: () => getRuntimeStatus(specs),
    ready: () => checkRuntimeHealthReady(options.healthUrl ?? defaultRuntimeHealthUrl())
  });
}

export function stopRuntime(specs: RuntimeProcessSpec[]): ReturnType<typeof summarizeRuntimeStatus> {
  for (const spec of specs) {
    const pid = readPid(spec.pidFile);
    if (!pid || !isPidRunning(pid)) continue;
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // If the process exits between status and kill, status will reflect that below.
      }
    }
  }
  waitForStopped(specs, 3000);
  return getRuntimeStatus(specs);
}

function readPid(pidFile: string): number | undefined {
  if (!existsSync(pidFile)) return undefined;
  const raw = readFileSync(pidFile, "utf8").trim();
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForStopped(specs: RuntimeProcessSpec[], timeoutMs: number): void {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const stillRunning = specs.some((spec) => {
      const pid = readPid(spec.pidFile);
      return pid ? isPidRunning(pid) : false;
    });
    if (!stillRunning) return;
    sleepSync(100);
  }
}

export async function waitForRuntimeReady(input: {
  timeoutMs: number;
  intervalMs: number;
  healthUrl?: string;
  status: () => RuntimeStatusSummary;
  ready: () => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<RuntimeStatusSummary> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? sleepAsync;
  const startedAt = now();
  let attempts = 0;

  while (now() - startedAt <= input.timeoutMs) {
    const status = input.status();
    if (!status.ok) {
      return {
        ...status,
        ready: false,
        readiness: {
          attempts,
          healthUrl: input.healthUrl,
          timeoutMs: input.timeoutMs
        }
      };
    }
    attempts += 1;
    if (await input.ready()) {
      return {
        ...status,
        ok: true,
        ready: true,
        readiness: {
          attempts,
          healthUrl: input.healthUrl,
          timeoutMs: input.timeoutMs
        },
        nextAction: "运行 pnpm dionysus system doctor --brief 验证依赖"
      };
    }
    await sleep(input.intervalMs);
  }

  const status = input.status();
  return {
    ...status,
    ok: false,
    ready: false,
    readiness: {
      attempts,
      healthUrl: input.healthUrl,
      timeoutMs: input.timeoutMs
    },
    nextAction: "API health 未就绪，查看 .dionysus/logs/api.log"
  };
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

async function sleepAsync(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkRuntimeHealthReady(healthUrl: string): Promise<boolean> {
  try {
    const response = await fetch(healthUrl);
    if (!response.ok) return false;
    const payload = await response.json() as unknown;
    return record(payload).ok === true;
  } catch {
    return false;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readWorkerCodeCommitSha(worker: Record<string, unknown>): string | undefined {
  const runtime = record(worker.runtime);
  const metadata = record(worker.metadata);
  const value = runtime.codeCommitSha ?? metadata.codeCommitSha ?? worker.codeCommitSha;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readApiCodeCommitSha(health: Record<string, unknown>): string | undefined {
  const runtime = record(health.runtime);
  const metadata = record(health.metadata);
  const api = record(health.api);
  const apiRuntime = record(api.runtime);
  const value = runtime.codeCommitSha ?? metadata.codeCommitSha ?? apiRuntime.codeCommitSha ?? api.codeCommitSha;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function defaultRuntimeHealthUrl(): string {
  const configuredHost = process.env.API_HOST ?? "127.0.0.1";
  const host = configuredHost === "0.0.0.0" ? "127.0.0.1" : configuredHost;
  const port = process.env.API_PORT ?? "23100";
  return `http://${host}:${port}/health`;
}
