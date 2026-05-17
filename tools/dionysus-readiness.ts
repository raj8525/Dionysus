import type { AgentRole, CliType } from "@dionysus/core";

export interface ReadinessHealthInput {
  ok?: boolean;
  database?: { ok?: boolean };
  rabbitmq?: { ok?: boolean };
  worker?: { ok?: boolean };
}

export interface ReadinessCliProbeInput {
  cliType?: string;
  available?: boolean;
}

export interface ReadinessAgentConfigInput {
  role?: string;
  cliType?: string;
  cliModel?: string;
  enabled?: boolean;
}

export interface ReadinessTargetInput {
  gitClean: boolean;
  changes: string[];
  hasAgentsMd: boolean;
  hasPlan: boolean;
  hasSpecs: boolean;
  hasFeaturesTest: boolean;
}

export interface CodexReadinessSummary {
  status: "ready" | "blocked";
  targetRoot: string;
  blockers: string[];
  runtime: {
    ok: boolean;
    database: boolean;
    rabbitmq: boolean;
    worker: boolean;
  };
  configuredRoles: Array<{
    role: string;
    cliType: string;
    cliModel?: string;
    enabled: boolean;
    cliAvailable: boolean;
  }>;
  target: ReadinessTargetInput;
  nextAction: string;
  nextCommands: string[];
}

const requiredRoles: AgentRole[] = ["master", "rule_writer", "test_writer", "worker"];

export function buildCodexReadinessSummary(input: {
  targetRoot: string;
  health: ReadinessHealthInput;
  cliProbe: ReadinessCliProbeInput[];
  configs: ReadinessAgentConfigInput[];
  target: ReadinessTargetInput;
}): CodexReadinessSummary {
  const availableCliTypes = new Set(
    input.cliProbe
      .filter((probe) => probe.available)
      .map((probe) => String(probe.cliType ?? ""))
      .filter(Boolean)
  );
  const configsByRole = new Map<string, ReadinessAgentConfigInput>();
  for (const config of input.configs) {
    if (config.role) {
      configsByRole.set(config.role, config);
    }
  }

  const runtime = {
    ok: Boolean(input.health.ok && input.health.database?.ok && input.health.rabbitmq?.ok && input.health.worker?.ok),
    database: Boolean(input.health.database?.ok),
    rabbitmq: Boolean(input.health.rabbitmq?.ok),
    worker: Boolean(input.health.worker?.ok)
  };

  const configuredRoles = requiredRoles.map((role) => {
    const config = configsByRole.get(role);
    const cliType = String(config?.cliType ?? "mock") as CliType;
    return {
      role,
      cliType,
      cliModel: config?.cliModel,
      enabled: config?.enabled !== false,
      cliAvailable: availableCliTypes.has(cliType)
    };
  });

  const blockers: string[] = [];
  if (!runtime.database) blockers.push("PostgreSQL 未就绪");
  if (!runtime.rabbitmq) blockers.push("RabbitMQ 未就绪");
  if (!runtime.worker) blockers.push("Worker Runtime 未就绪");

  for (const roleConfig of configuredRoles) {
    if (!roleConfig.enabled) {
      blockers.push(`${roleLabel(roleConfig.role)} 未启用`);
      continue;
    }
    if (!roleConfig.cliAvailable) {
      blockers.push(`${roleLabel(roleConfig.role)} 配置的 ${roleConfig.cliType} 不可用`);
    }
  }

  const workerConfig = configuredRoles.find((config) => config.role === "worker");
  if (workerConfig?.cliType === "mock") {
    blockers.push("Worker 仍配置为 mock，不能证明低成本真实 CLI 可用");
  }

  if (!input.target.gitClean) {
    blockers.push(`目标项目工作区不干净：${input.target.changes.length} 个改动`);
  }
  if (!input.target.hasAgentsMd) blockers.push("目标项目缺少 AGENTS.md");
  if (!input.target.hasPlan) blockers.push("目标项目缺少 docs/PLAN.md");
  if (!input.target.hasSpecs) blockers.push("目标项目缺少 docs/specs/");
  if (!input.target.hasFeaturesTest) blockers.push("目标项目缺少 features_test/");

  const status: CodexReadinessSummary["status"] = blockers.length ? "blocked" : "ready";
  return {
    status,
    targetRoot: input.targetRoot,
    blockers,
    runtime,
    configuredRoles,
    target: input.target,
    nextAction: status === "ready"
      ? "可以启动 fast lane：先选择一个完整模块读路径目标，再拆 1-4 个 WorkerCLI 任务。"
      : "先处理 blockers，再启动 fast lane。",
    nextCommands: status === "ready"
      ? [
        `cd ${input.targetRoot} && git status --short`,
        "cd /Volumes/MacMiniSSD/code/Dionysus && pnpm -s dionysus fastlane plan --title \"...\" --description \"...\" --target-root \"" + input.targetRoot + "\" --worker \"...::...\""
      ]
      : [
        `cd ${input.targetRoot} && git status --short`,
        "cd /Volumes/MacMiniSSD/code/Dionysus && pnpm -s dionysus system doctor --brief",
        "cd /Volumes/MacMiniSSD/code/Dionysus && pnpm -s dionysus agent config list"
      ]
  };
}

function roleLabel(role: string): string {
  return {
    master: "Master",
    rule_writer: "RuleWriter",
    test_writer: "TestWriter",
    worker: "Worker"
  }[role] ?? role;
}
