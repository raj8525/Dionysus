import type { CodexReadinessSummary } from "./dionysus-readiness.js";

export interface SystemAuditUsageBucket {
  role?: string;
  cliType?: string;
  cliCalls?: number;
  modelCalls?: number;
  runningCalls?: number;
  succeededCalls?: number;
  failedCalls?: number;
  lastRunAt?: string;
  lastSucceededAt?: string;
  lastFailedAt?: string;
  latestActiveRunAt?: string;
  latestActiveSucceededAt?: string;
  latestActiveFailedAt?: string;
}

export interface SystemAuditUsage {
  activeGoalRunTracking?: boolean;
  totals?: SystemAuditUsageBucket;
  byAgent?: SystemAuditUsageBucket[];
  byCli?: SystemAuditUsageBucket[];
}

export interface SystemAuditSummary {
  status: "ready" | "needs_attention" | "blocked";
  targetRoot: string;
  blockers: string[];
  warnings: string[];
  notes: string[];
  nextAction: string;
  nextCommands: string[];
  evidence: {
    readiness: CodexReadinessSummary;
    usage?: SystemAuditUsage;
    pendingCodexOutboxCount: number;
    pendingCodexOutbox: Array<Record<string, unknown>>;
    goalStatus?: Record<string, unknown>;
  };
}

export function buildSystemAuditSummary(input: {
  targetRoot: string;
  readiness: CodexReadinessSummary;
  usage?: SystemAuditUsage;
  pendingCodexOutbox?: Array<Record<string, unknown>>;
  goalStatus?: Record<string, unknown>;
}): SystemAuditSummary {
  const pendingCodexOutbox = input.pendingCodexOutbox ?? [];
  const blockers = [...input.readiness.blockers];
  const warnings: string[] = [];
  const notes: string[] = [];
  const nextCommands = new Set<string>();

  if (input.readiness.status === "blocked") {
    for (const command of input.readiness.nextCommands) {
      nextCommands.add(command);
    }
    return {
      status: "blocked",
      targetRoot: input.targetRoot,
      blockers,
      warnings,
      notes,
      nextAction: "先处理 readiness blockers；未就绪前不要派发新的 WorkerCLI 任务。",
      nextCommands: [...nextCommands],
      evidence: {
        readiness: input.readiness,
        usage: input.usage,
        pendingCodexOutboxCount: pendingCodexOutbox.length,
        pendingCodexOutbox,
        goalStatus: input.goalStatus
      }
    };
  }

  const totals = input.usage?.totals;
  const cliCalls = numberOrZero(totals?.cliCalls);
  const modelCalls = numberOrZero(totals?.modelCalls);
  const runningCalls = numberOrZero(totals?.runningCalls);
  const failedCalls = numberOrZero(totals?.failedCalls);

  if (pendingCodexOutbox.length > 0) {
    warnings.push(`存在 ${pendingCodexOutbox.length} 个 pending Codex Outbox 事件，需要 Codex 处理或 ack`);
    nextCommands.add("cd /Volumes/MacMiniSSD/code/Dionysus && pnpm -s dionysus codex heartbeat --limit 5");
  }

  if (!input.usage || cliCalls === 0) {
    warnings.push("尚无 CLI 调用证据，不能证明 Dionysus 已经真正调度 Agent 产出");
  }
  if (input.usage && modelCalls === 0) {
    warnings.push("尚无模型调用证据，当前产出可能只来自 mock 或本地流程");
  }
  if (runningCalls > 0) {
    warnings.push(`仍有 ${runningCalls} 次 CLI 调用处于运行中，先确认是否卡住或等待结果`);
  }
  if (hasUnrecoveredLatestFailure(totals, input.usage?.activeGoalRunTracking === true)) {
    warnings.push("整体最近一次 CLI 运行失败，尚无后续成功恢复证据");
    nextCommands.add(buildUsageCommand(input.targetRoot));
  }
  if (cliCalls >= 10 && failedCalls / cliCalls >= 0.3) {
    if (isRecoveredBucket(totals)) {
      notes.push(`整体曾有较高历史失败率：${failedCalls}/${cliCalls}，但最近一次运行已成功`);
    } else {
      warnings.push(`整体 CLI 失败率偏高：${failedCalls}/${cliCalls}`);
      nextCommands.add(buildUsageCommand(input.targetRoot));
    }
  }

  for (const bucket of input.usage?.byAgent ?? []) {
    const bucketCalls = numberOrZero(bucket.cliCalls);
    const bucketFailures = numberOrZero(bucket.failedCalls);
    if (hasUnrecoveredLatestFailure(bucket, input.usage?.activeGoalRunTracking === true)) {
      warnings.push(`${bucket.role ?? "unknown-agent"} 最近一次 CLI 运行失败，尚无后续成功恢复证据`);
      nextCommands.add(buildUsageCommand(input.targetRoot));
    }
    if (bucketCalls >= 5 && bucketFailures / bucketCalls >= 0.3) {
      if (isRecoveredBucket(bucket)) {
        notes.push(`${bucket.role ?? "unknown-agent"} 曾有较高历史失败率：${bucketFailures}/${bucketCalls}，但最近一次运行已成功`);
      } else {
        warnings.push(`${bucket.role ?? "unknown-agent"} CLI 失败率偏高：${bucketFailures}/${bucketCalls}`);
        nextCommands.add(buildUsageCommand(input.targetRoot));
      }
    }
  }

  const hasRealCliUsage = (input.usage?.byCli ?? []).some((bucket) => {
    return bucket.cliType && bucket.cliType !== "mock" && numberOrZero(bucket.modelCalls) > 0;
  });
  if (input.usage && cliCalls > 0 && !hasRealCliUsage) {
    warnings.push("CLI 记录中没有真实模型调用，不能证明低成本 Agent lane 可用");
  }

  if (warnings.length === 0) {
    nextCommands.add(
      `cd /Volumes/MacMiniSSD/code/Dionysus && pnpm -s dionysus fastlane coupon-module-plan --module "..." --title "..." --description "..." --target-root "${input.targetRoot}" --page "apps/admin-web/src/pages/<module>/<page>.vue" --api "/api/admin/<module>" --html-template "apps/admin-web/html/<module>.html"`
    );
  } else if (!nextCommands.size) {
    nextCommands.add(buildUsageCommand(input.targetRoot));
  }

  return {
    status: warnings.length > 0 ? "needs_attention" : "ready",
    targetRoot: input.targetRoot,
    blockers,
    warnings,
    notes,
    nextAction: warnings.length > 0
      ? buildAttentionAction(warnings)
      : "可以启动或继续一个完整模块：先做数据与只读链路，再做写路径，最后由 Codex 执行浏览器级 E2E。",
    nextCommands: [...nextCommands],
    evidence: {
      readiness: input.readiness,
      usage: input.usage,
      pendingCodexOutboxCount: pendingCodexOutbox.length,
      pendingCodexOutbox,
      goalStatus: input.goalStatus
    }
  };
}

function buildAttentionAction(warnings: string[]): string {
  if (warnings.some((warning) => warning.includes("Codex Outbox"))) {
    return "先处理 Codex Outbox 中等待人类级裁决的事项，再继续派发或验收任务。";
  }
  if (warnings.some((warning) => warning.includes("失败率偏高"))) {
    return "先查看高失败角色最近运行日志，必要时调整 prompt、CLI 模型或由 Codex 接手该任务。";
  }
  if (warnings.some((warning) => warning.includes("最近一次 CLI 运行失败"))) {
    return "先查看最近失败的 Agent 运行日志，确认是可忽略的历史失败、任务已被 Codex 接手，还是需要调整 prompt、CLI 模型或停止继续派工。";
  }
  return "先补齐审计证据，确认真实 CLI、模型调用和运行结果后再扩大并发。";
}

function buildUsageCommand(targetRoot: string): string {
  return `cd /Volumes/MacMiniSSD/code/Dionysus && pnpm -s dionysus agent usage --target-root ${JSON.stringify(targetRoot)}`;
}

function isRecoveredBucket(bucket?: SystemAuditUsageBucket): boolean {
  const lastFailedAt = parseTimestamp(bucket?.lastFailedAt);
  const lastSucceededAt = parseTimestamp(bucket?.lastSucceededAt);
  const lastRunAt = parseTimestamp(bucket?.lastRunAt);
  return Boolean(
    lastFailedAt !== undefined &&
    lastSucceededAt !== undefined &&
    lastSucceededAt > lastFailedAt &&
    (lastRunAt === undefined || lastRunAt <= lastSucceededAt)
  );
}

function hasUnrecoveredLatestFailure(bucket?: SystemAuditUsageBucket, useActiveGoalTimestamps = false): boolean {
  const lastFailedAt = parseTimestamp(useActiveGoalTimestamps ? bucket?.latestActiveFailedAt : bucket?.lastFailedAt);
  const lastSucceededAt = parseTimestamp(useActiveGoalTimestamps ? bucket?.latestActiveSucceededAt : bucket?.lastSucceededAt);
  const lastRunAt = parseTimestamp(useActiveGoalTimestamps ? bucket?.latestActiveRunAt : bucket?.lastRunAt);
  return Boolean(
    lastFailedAt !== undefined &&
    lastRunAt !== undefined &&
    lastRunAt <= lastFailedAt &&
    (lastSucceededAt === undefined || lastSucceededAt < lastFailedAt)
  );
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
