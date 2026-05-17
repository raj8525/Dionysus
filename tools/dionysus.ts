import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { resolveApiCommand } from "./dionysus-command.js";
import { summarizeRunCycle } from "./dionysus-cycle.js";
import { compactDoctorResult } from "./dionysus-doctor.js";
import { buildAgentConfigSavePlan } from "./dionysus-agent-config.js";
import { buildFastLanePlan, parseFastLaneItem } from "./dionysus-fastlane.js";
import { buildReleaseRecordRequest } from "./dionysus-release-record.js";
import { buildRuntimeProcessSpecs, getRuntimeStatus, startRuntime, stopRuntime } from "./dionysus-runtime.js";
import { summarizeAgentControlStatus } from "./dionysus-agent-status.js";
import { buildSupervisionAgentStatus, buildSupervisionStepRecord, summarizeSupervisionStep } from "./dionysus-supervise.js";
import { formatCodexHeartbeat, formatCodexOutboxReconciliation } from "@dionysus/core";
import type { AgentRole, CliType, CodexOutboxEvent } from "@dionysus/core";

const apiBase = process.env.DIONYSUS_API_BASE ?? "http://localhost:23100";

interface E2ECampaignRecord {
  id: string;
  target_url?: string;
  status: string;
}

interface E2ECaseRecord {
  id: string;
  title: string;
  caseType: string;
  status: string;
}

async function main(): Promise<void> {
  const [domain, action, ...args] = process.argv.slice(2);

  if (domain === "goal" && action === "create") {
    return print(await request("/api/goals", "POST", {
      title: readFlag(args, "--title") ?? "Untitled goal",
      description: readFlag(args, "--description") ?? readFlag(args, "--title") ?? "Untitled goal",
      targetRoot: readFlag(args, "--target-root") ?? process.env.TARGET_COUPON_ROOT ?? process.cwd()
    }));
  }

  if (domain === "system" && action === "doctor") {
    const goalId = readFlag(args, "--goal-id");
    const health = await request("/health");
    const cliProbe = await request("/api/cli/probe", "POST") as Array<Record<string, unknown>>;
    const goalStatus = goalId
      ? await request(`/api/tasks?goalId=${goalId}`).then(async (tasks) => ({
        tasks,
        runs: await request(`/api/runs?goalId=${goalId}&limit=10`),
        integrations: await request(`/api/integrations?goalId=${goalId}`),
        milestones: await request(`/api/milestones?goalId=${goalId}`)
      }))
      : undefined;
    const result = {
      ok: true,
      apiBase,
      health,
      cliProbe,
      goalStatus
    };
    return print(hasFlag(args, "--brief") ? compactDoctorResult(result) : result);
  }

  if (domain === "system" && action === "worker" && args[0] === "start") {
    const logDir = readFlag(args, "--log-dir") ?? ".dionysus/logs";
    mkdirSync(logDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const logFile = join(logDir, `worker-${stamp}.log`);
    const logFd = openSync(logFile, "a");
    const child = spawn("pnpm", ["--filter", "@dionysus/worker", "exec", "tsx", "src/worker.ts"], {
      cwd: process.cwd(),
      detached: true,
      env: process.env,
      stdio: ["ignore", logFd, logFd]
    });
    child.unref();
    return print({
      status: "started",
      pid: child.pid,
      logFile,
      command: "pnpm --filter @dionysus/worker exec tsx src/worker.ts"
    });
  }

  if (domain === "system" && action === "runtime") {
    const runtimeAction = args[0];
    const specs = buildRuntimeProcessSpecs({
      repoRoot: process.cwd(),
      logDir: readFlag(args, "--log-dir") ?? ".dionysus/logs",
      pidDir: readFlag(args, "--pid-dir") ?? ".dionysus/pids"
    });
    if (runtimeAction === "start") {
      return print(await startRuntime(specs));
    }
    if (runtimeAction === "status") {
      return print(getRuntimeStatus(specs));
    }
    if (runtimeAction === "stop") {
      return print(stopRuntime(specs));
    }
  }

  if (domain === "agent" && action === "probe") {
    return print(await request("/api/cli/probe", "POST"));
  }

  if (domain === "agent" && action === "validate-model") {
    return print(await request("/api/cli/validate-model", "POST", {
      cliType: readCliTypeFlag(args, "--cli"),
      model: readFlag(args, "--model") ?? null
    }));
  }

  if (domain === "agent" && action === "config" && args[0] === "set") {
    const cliType = readCliTypeFlag(args, "--cli");
    const cliModel = readFlag(args, "--model");
    const validation = cliType === "mock"
      ? undefined
      : await request("/api/cli/validate-model", "POST", { cliType, model: cliModel ?? null }) as Parameters<typeof buildAgentConfigSavePlan>[0]["validation"];
    const config = buildAgentConfigSavePlan({
      role: readAgentRoleFlag(args, "--role"),
      cliType,
      cliModel,
      enabled: readBooleanFlag(args, "--enabled", true),
      validation
    });
    const saved = await request("/api/agent-cli-configs", "PUT", config);
    return print({ validation, saved });
  }

  if (domain === "agent" && action === "status") {
    const goalId = readFlag(args, "--goal-id");
    const [health, configs, agents, tasks, runs, usage] = await Promise.all([
      request("/health") as Promise<Record<string, unknown>>,
      request("/api/agent-cli-configs") as Promise<Array<Record<string, unknown>>>,
      request("/api/agents") as Promise<Array<Record<string, unknown>>>,
      goalId ? request(`/api/tasks?goalId=${goalId}`) as Promise<Array<Record<string, unknown>>> : Promise.resolve([]),
      goalId ? request(`/api/runs?goalId=${goalId}&limit=20`) as Promise<Array<Record<string, unknown>>> : Promise.resolve([]),
      request(`/api/usage/agent-cli${goalId ? `?goalId=${encodeURIComponent(goalId)}` : ""}`) as Promise<Record<string, unknown>>
    ]);
    return print({
      goalId,
      summary: summarizeAgentControlStatus({ health, configs, agents, tasks, runs }),
      health,
      configs,
      agents,
      tasks,
      runs,
      usage
    });
  }

  if (domain === "agent" && action === "usage") {
    const goalId = readFlag(args, "--goal-id");
    const targetRoot = readFlag(args, "--target-root");
    const params = new URLSearchParams();
    if (goalId) params.set("goalId", goalId);
    if (targetRoot) params.set("targetRoot", targetRoot);
    const query = params.toString() ? `?${params.toString()}` : "";
    return print(await request(`/api/usage/agent-cli${query}`));
  }

  if (domain === "agent" && action === "list") {
    const role = readFlag(args, "--role");
    const query = role ? `?role=${encodeURIComponent(role)}` : "";
    return print(await request(`/api/agents${query}`));
  }

  if (domain === "fastlane" && action === "plan") {
    return print(buildFastLanePlan({
      title: requiredFlag(args, "--title"),
      description: requiredFlag(args, "--description"),
      targetRoot: requiredFlag(args, "--target-root"),
      workers: readRepeatedFlag(args, "--worker").map(parseFastLaneItem),
      reviewers: readRepeatedFlag(args, "--reviewer").map(parseFastLaneItem),
      queueReviewers: hasFlag(args, "--queue-reviewers")
    }));
  }

  if (domain === "fastlane" && action === "start") {
    const plan = buildFastLanePlan({
      title: requiredFlag(args, "--title"),
      description: requiredFlag(args, "--description"),
      targetRoot: requiredFlag(args, "--target-root"),
      workers: readRepeatedFlag(args, "--worker").map(parseFastLaneItem),
      reviewers: readRepeatedFlag(args, "--reviewer").map(parseFastLaneItem),
      queueReviewers: hasFlag(args, "--queue-reviewers")
    });
    const createdGoal = await request("/api/goals", "POST", plan.goal) as { id: string };
    const goal = await request(`/api/goals/${createdGoal.id}/fast-lane`, "POST", {
      reason: "created by dionysus fastlane start"
    }) as { id: string };
    const tasks = [];
    for (const task of plan.tasks) {
      tasks.push(await request("/api/tasks", "POST", {
        goalId: goal.id,
        title: task.title,
        description: task.description,
        roleRequired: task.roleRequired,
        priority: task.priority,
        queue: task.queue
      }));
    }
    return print({
      goal,
      tasks,
      reviewerTasks: tasks.filter((task) => String((task as Record<string, unknown>).status) === "created"),
      nextCommands: plan.nextCommands.map((command) => command.replaceAll("<goal-id>", goal.id))
    });
  }

  if (domain === "release" && action === "record") {
    return print(await request("/api/releases", "POST", buildReleaseRecordRequest(args)));
  }

  if (domain === "goal" && action === "status") {
    const goalId = requiredFlag(args, "--goal-id");
    return print(await request(`/api/goals/${encodeURIComponent(goalId)}/status`));
  }

  if (domain === "goal" && action === "preflight") {
    return print(await request(`/api/goals/${requiredFlag(args, "--goal-id")}/preflight`, "POST"));
  }

  if (domain === "goal" && action === "master-step") {
    return print(await request(`/api/goals/${requiredFlag(args, "--goal-id")}/master-step`, "POST"));
  }

  if (domain === "goal" && action === "detect-milestones") {
    return print(await request(`/api/goals/${requiredFlag(args, "--goal-id")}/detect-milestones`, "POST"));
  }

  if (domain === "goal" && action === "run-cycle") {
    return print(await runGoalCycle({
      goalId: requiredFlag(args, "--goal-id"),
      targetUrl: readFlag(args, "--target-url"),
      runE2E: hasFlag(args, "--run-e2e"),
      e2eMode: (readFlag(args, "--mode") ?? "strict") as "strict" | "render-only",
      acceptance: readRepeatedFlag(args, "--acceptance"),
      screenshotDir: readFlag(args, "--screenshot-dir") ?? ".dionysus/e2e"
    }));
  }

  if (domain === "goal" && action === "supervise") {
    return print(await superviseGoal({
      goalId: requiredFlag(args, "--goal-id"),
      iterations: optionalNumberFlag(args, "--iterations") ?? 3,
      intervalSeconds: optionalNumberFlag(args, "--interval-seconds") ?? 30,
      targetUrl: readFlag(args, "--target-url"),
      runE2E: hasFlag(args, "--run-e2e"),
      e2eMode: (readFlag(args, "--mode") ?? "strict") as "strict" | "render-only",
      acceptance: readRepeatedFlag(args, "--acceptance"),
      screenshotDir: readFlag(args, "--screenshot-dir") ?? ".dionysus/e2e"
    }));
  }

  if (domain === "task" && action === "create") {
    return print(await request("/api/tasks", "POST", {
      goalId: requiredFlag(args, "--goal-id"),
      title: requiredFlag(args, "--title"),
      description: readFlag(args, "--description") ?? requiredFlag(args, "--title"),
      roleRequired: readFlag(args, "--role") ?? "worker",
      priority: optionalNumberFlag(args, "--priority"),
      queue: !hasFlag(args, "--no-queue")
    }));
  }

  if (domain === "task" && action === "cancel") {
    return print(await request(`/api/tasks/${requiredFlag(args, "--task-id")}/cancel`, "POST", {
      reason: readFlag(args, "--reason") ?? "cancelled by Codex"
    }));
  }

  if (domain === "task" && action === "review") {
    return print(await request(`/api/tasks/${requiredFlag(args, "--task-id")}/review`, "POST", {
      verdict: readFlag(args, "--verdict") ?? "approve",
      reason: readFlag(args, "--reason") ?? "reviewed by Codex"
    }));
  }

  if (domain === "milestone" && action === "request-e2e") {
    return print(await request(`/api/milestones/${requiredFlag(args, "--milestone-id")}/request-e2e`, "POST"));
  }

  if (domain === "milestone" && action === "create-campaign") {
    return print(await request(`/api/milestones/${requiredFlag(args, "--milestone-id")}/e2e-campaigns`, "POST", {
      targetUrl: requiredFlag(args, "--target-url"),
      acceptance: readRepeatedFlag(args, "--acceptance")
    }));
  }

  if (domain === "milestone" && action === "verdict") {
    return print(await request(`/api/milestones/${requiredFlag(args, "--milestone-id")}/codex-verdict`, "POST", {
      verdict: requiredFlag(args, "--verdict"),
      reason: requiredFlag(args, "--reason")
    }));
  }

  if (domain === "milestone" && action === "notify") {
    return print(await request(`/api/milestones/${requiredFlag(args, "--milestone-id")}/notifications`, "POST", {
      summary: requiredFlag(args, "--summary"),
      targetUrl: requiredFlag(args, "--target-url"),
      verificationCommands: readRepeatedFlag(args, "--verify"),
      residualRisks: readRepeatedFlag(args, "--risk")
    }));
  }

  if (domain === "e2e" && action === "cases") {
    return print(await request(`/api/e2e/campaigns/${requiredFlag(args, "--campaign-id")}/cases`));
  }

  if (domain === "e2e" && action === "case-result") {
    return print(await request(`/api/e2e/cases/${requiredFlag(args, "--case-id")}/result`, "POST", {
      status: requiredFlag(args, "--status"),
      failureReason: readFlag(args, "--failure-reason"),
      result: parseJsonFlag(args, "--result-json") ?? {}
    }));
  }

  if (domain === "e2e" && action === "run-campaign") {
    return print(await runE2ECampaign({
      campaignId: requiredFlag(args, "--campaign-id"),
      mode: (readFlag(args, "--mode") ?? "strict") as "strict" | "render-only",
      screenshotDir: readFlag(args, "--screenshot-dir") ?? ".dionysus/e2e"
    }));
  }

  if (domain === "notification" && action === "deliver") {
    return print(await request(`/api/notifications/${requiredFlag(args, "--notification-id")}/deliver`, "POST"));
  }

  if (domain === "integration" && action === "evidence") {
    return print(await request(`/api/integrations/${requiredFlag(args, "--integration-id")}/evidence`, "POST", {
      finalUserFeatureEvidence: readRepeatedFlag(args, "--final-user-evidence"),
      realDataPersistenceEvidence: readRepeatedFlag(args, "--persistence-evidence")
    }));
  }

  if (domain === "codex" && action === "outbox") {
    const status = readFlag(args, "--status") ?? "pending";
    const limit = optionalNumberFlag(args, "--limit") ?? 20;
    return print(await request(`/api/codex/outbox?status=${encodeURIComponent(status)}&limit=${limit}`));
  }

  if (domain === "codex" && action === "ack") {
    return print(await request(`/api/codex/outbox/${requiredFlag(args, "--event-id")}/ack`, "POST", {
      force: hasFlag(args, "--force")
    }));
  }

  if (domain === "codex" && action === "reconcile") {
    const reconciliation = await request("/api/codex/outbox/reconcile", "POST") as { acked: number; events: CodexOutboxEvent[] };
    return print({
      ...formatCodexOutboxReconciliation({
        acked: reconciliation.acked,
        eventIds: reconciliation.events.map((event) => event.id)
      }),
      ...reconciliation
    });
  }

  if (domain === "codex" && action === "heartbeat") {
    const limit = optionalNumberFlag(args, "--limit") ?? 5;
    const reconciliation = await request("/api/codex/outbox/reconcile", "POST") as { acked: number; events: CodexOutboxEvent[] };
    const events = await request(`/api/codex/outbox?status=pending&limit=${limit}`) as CodexOutboxEvent[];
    return print({
      ...formatCodexHeartbeat(events),
      reconciliation: formatCodexOutboxReconciliation({
        acked: reconciliation.acked,
        eventIds: reconciliation.events.map((event) => event.id)
      }),
      events
    });
  }

  if (domain === "goal" && action === "cancel") {
    return print(await request(`/api/goals/${requiredFlag(args, "--goal-id")}/cancel`, "POST", {
      reason: readFlag(args, "--reason") ?? "cancelled by Codex"
    }));
  }

  if (domain === "goal" && action === "fast-lane") {
    return print(await request(`/api/goals/${requiredFlag(args, "--goal-id")}/fast-lane`, "POST", {
      reason: readFlag(args, "--reason") ?? "marked as Codex fast lane"
    }));
  }

  const apiCommand = resolveApiCommand([domain, action, ...args].filter((value): value is string => Boolean(value)));
  if (apiCommand) {
    return print(await request(apiCommand.path, apiCommand.method));
  }

  usage();
  process.exitCode = 1;
}

async function runE2ECampaign(input: {
  campaignId: string;
  mode: "strict" | "render-only";
  screenshotDir: string;
}): Promise<Record<string, unknown>> {
  if (input.mode === "render-only") {
    throw new Error("render-only is not valid for milestone E2E campaigns; run strict final-user browser flows or record this as an engineering checkpoint.");
  }
  const campaigns = await request("/api/e2e/campaigns") as E2ECampaignRecord[];
  const campaign = campaigns.find((candidate) => candidate.id === input.campaignId);
  if (!campaign) {
    throw new Error(`campaign not found: ${input.campaignId}`);
  }
  if (!campaign.target_url) {
    throw new Error(`campaign has no target_url: ${input.campaignId}`);
  }

  const { chromium } = await import("playwright");
  const { mkdir } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  await mkdir(input.screenshotDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  const cases = await request(`/api/e2e/campaigns/${input.campaignId}/cases`) as E2ECaseRecord[];
  const results: Array<Record<string, unknown>> = [];
  try {
    for (const testCase of cases) {
      const result = await runE2ECase({
        page,
        targetUrl: campaign.target_url,
        testCase,
        mode: input.mode,
        screenshotDir: input.screenshotDir,
        consoleErrors
      });
      const recorded = await request(`/api/e2e/cases/${testCase.id}/result`, "POST", {
        status: result.status,
        failureReason: result.failureReason,
        result: result.evidence
      });
      results.push({ caseId: testCase.id, caseType: testCase.caseType, ...result, recorded });
    }
  } finally {
    await browser.close();
  }

  return {
    campaignId: input.campaignId,
    targetUrl: campaign.target_url,
    mode: input.mode,
    screenshotDir: resolve(input.screenshotDir),
    results
  };
}

async function runGoalCycle(input: {
  goalId: string;
  targetUrl?: string;
  runE2E: boolean;
  e2eMode: "strict" | "render-only";
  acceptance: string[];
  screenshotDir: string;
}): Promise<Record<string, unknown>> {
  const preflight = await request(`/api/goals/${input.goalId}/preflight`, "POST") as Record<string, unknown>;
  const masterStep = await request(`/api/goals/${input.goalId}/master-step`, "POST") as Record<string, unknown>;
  const milestoneDetection = await request(`/api/goals/${input.goalId}/detect-milestones`, "POST") as Record<string, unknown>;
  let milestones = await request(`/api/milestones?goalId=${input.goalId}`) as Array<Record<string, unknown>>;
  const campaigns: Array<Record<string, unknown>> = [];
  const e2eRuns: Array<Record<string, unknown>> = [];

  if (input.targetUrl) {
    for (const milestone of milestones) {
      const milestoneId = String(milestone.id);
      const status = String(milestone.status);
      if (status === "candidate") {
        await request(`/api/milestones/${milestoneId}/request-e2e`, "POST");
      }
      if (["candidate", "e2e_required", "e2e_running"].includes(status)) {
        const existing = await request(`/api/e2e/campaigns?milestoneId=${milestoneId}`) as Array<Record<string, unknown>>;
        const campaign = existing[0] ?? await request(`/api/milestones/${milestoneId}/e2e-campaigns`, "POST", {
          targetUrl: input.targetUrl,
          acceptance: input.acceptance.length ? input.acceptance : ["里程碑主路径通过"]
        }) as Record<string, unknown>;
        campaigns.push(campaign);
      }
    }
  }

  if (input.runE2E) {
    for (const campaign of campaigns) {
      e2eRuns.push(await runE2ECampaign({
        campaignId: String(campaign.id),
        mode: input.e2eMode,
        screenshotDir: input.screenshotDir
      }));
    }
  }

  milestones = await request(`/api/milestones?goalId=${input.goalId}`) as Array<Record<string, unknown>>;
  const updatedCampaigns = input.targetUrl
    ? await collectCampaignsForMilestones(milestones)
    : campaigns;
  return {
    goalId: input.goalId,
    preflight,
    masterStep,
    milestoneDetection,
    milestones,
    campaigns: updatedCampaigns,
    e2eRuns,
    summary: summarizeRunCycle({
      preflight,
      masterStep,
      milestoneDetection,
      milestones,
      campaigns: updatedCampaigns
    })
  };
}

async function collectCampaignsForMilestones(milestones: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const campaigns: Array<Record<string, unknown>> = [];
  for (const milestone of milestones) {
    campaigns.push(...await request(`/api/e2e/campaigns?milestoneId=${String(milestone.id)}`) as Array<Record<string, unknown>>);
  }
  return campaigns;
}

async function superviseGoal(input: {
  goalId: string;
  iterations: number;
  intervalSeconds: number;
  targetUrl?: string;
  runE2E: boolean;
  e2eMode: "strict" | "render-only";
  acceptance: string[];
  screenshotDir: string;
}): Promise<Record<string, unknown>> {
  const steps: Array<Record<string, unknown>> = [];
  const maxIterations = Math.max(1, Math.min(input.iterations, 50));
  for (let index = 0; index < maxIterations; index += 1) {
    const [health, configs, agents, tasks, runs, usage] = await Promise.all([
      request("/health") as Promise<Record<string, unknown>>,
      request("/api/agent-cli-configs") as Promise<Array<Record<string, unknown>>>,
      request("/api/agents") as Promise<Array<Record<string, unknown>>>,
      request(`/api/tasks?goalId=${input.goalId}`) as Promise<Array<Record<string, unknown>>>,
      request(`/api/runs?goalId=${input.goalId}&limit=20`) as Promise<Array<Record<string, unknown>>>,
      request(`/api/usage/agent-cli?goalId=${input.goalId}`) as Promise<Record<string, unknown>>
    ]);
    const agentStatus = buildSupervisionAgentStatus({ goalId: input.goalId, health, configs, agents, tasks, runs, usage });
    const runCycle = await runGoalCycle(input);
    const summary = summarizeSupervisionStep({ agentStatus, runCycle });
    steps.push(buildSupervisionStepRecord({ iteration: index + 1, summary, agentStatus, runCycle }));
    if (!summary.shouldContinue) {
      await request("/api/codex/outbox", "POST", {
        goalId: input.goalId,
        eventType: summary.status === "e2e_required" ? "e2e_required" : "blocker",
        reason: summary.reason,
        source: "goal.supervise",
        payload: {
          iteration: index + 1,
          agentSummary: agentStatus.summary,
          runCycleSummary: runCycle.summary
        }
      });
      return {
        goalId: input.goalId,
        status: summary.status,
        stoppedAtIteration: index + 1,
        steps
      };
    }
    if (index < maxIterations - 1 && input.intervalSeconds > 0) {
      await sleep(input.intervalSeconds * 1000);
    }
  }
  return {
    goalId: input.goalId,
    status: "working",
    stoppedAtIteration: maxIterations,
    steps
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runE2ECase(input: {
  page: import("playwright").Page;
  targetUrl: string;
  testCase: E2ECaseRecord;
  mode: "strict" | "render-only";
  screenshotDir: string;
  consoleErrors: string[];
}): Promise<{
  status: "passed" | "failed" | "blocked";
  failureReason?: string;
  evidence: Record<string, unknown>;
}> {
  const actionable = input.testCase.caseType === "smoke" || input.testCase.caseType === "persistence";
  if (!actionable && input.mode === "strict") {
    return {
      status: "blocked",
      failureReason: `caseType=${input.testCase.caseType} requires product-specific final-user browser actions; Codex must execute the workflow and record explicit case-result before milestone verdict.`,
      evidence: {
        mode: input.mode,
        caseType: input.testCase.caseType,
        targetUrl: input.targetUrl
      }
    };
  }

  const beforeErrorCount = input.consoleErrors.length;
  await input.page.goto(input.targetUrl, { waitUntil: "networkidle" });
  if (input.testCase.caseType === "persistence") {
    await input.page.reload({ waitUntil: "networkidle" });
  }
  const title = await input.page.title();
  const bodyTextLength = await input.page.locator("body").innerText().then((text) => text.trim().length);
  const screenshotPath = `${input.screenshotDir}/${input.testCase.id}-${input.testCase.caseType}.png`;
  await input.page.screenshot({ path: screenshotPath, fullPage: false });
  const newConsoleErrors = input.consoleErrors.slice(beforeErrorCount);
  const failed = bodyTextLength === 0 || newConsoleErrors.length > 0;
  return {
    status: failed ? "failed" : "passed",
    failureReason: failed ? `bodyTextLength=${bodyTextLength}; consoleErrors=${newConsoleErrors.length}` : undefined,
    evidence: {
      mode: input.mode,
      caveat: !actionable && input.mode === "render-only"
        ? "render-only mode checks rendering only; it does not prove the product workflow."
        : undefined,
      caseType: input.testCase.caseType,
      targetUrl: input.targetUrl,
      title,
      bodyTextLength,
      consoleErrors: newConsoleErrors,
      screenshotPath
    }
  };
}

async function request(path: string, method = "GET", body?: unknown): Promise<unknown> {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(stripUndefined(body))
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
  }
  return payload;
}

function stripUndefined(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
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

function readRepeatedFlag(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) {
      values.push(args[index + 1]);
    }
  }
  return values;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function optionalNumberFlag(args: string[], name: string): number | undefined {
  const value = readFlag(args, name);
  return value ? Number(value) : undefined;
}

function parseJsonFlag(args: string[], name: string): Record<string, unknown> | undefined {
  const value = readFlag(args, name);
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function readAgentRoleFlag(args: string[], name: string): AgentRole {
  const value = requiredFlag(args, name);
  if (value === "master" || value === "rule_writer" || value === "test_writer" || value === "worker") {
    return value;
  }
  throw new Error(`${name} must be one of master, rule_writer, test_writer, worker`);
}

function readCliTypeFlag(args: string[], name: string): CliType {
  const value = requiredFlag(args, name);
  if (value === "mock" || value === "claude_code" || value === "gemini_cli" || value === "opencode") {
    return value;
  }
  throw new Error(`${name} must be one of mock, claude_code, gemini_cli, opencode`);
}

function readBooleanFlag(args: string[], name: string, fallback: boolean): boolean {
  const value = readFlag(args, name);
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function usage(): void {
  console.log(`Usage:
  pnpm goal:create -- --title "..." --description "..." --target-root "/path/to/project"
  tsx tools/dionysus.ts system doctor
  tsx tools/dionysus.ts system doctor --brief
  tsx tools/dionysus.ts system worker start
  tsx tools/dionysus.ts agent probe
  tsx tools/dionysus.ts agent validate-model --cli opencode --model "minimax/MiniMax-M2.7"
  tsx tools/dionysus.ts agent config list
  tsx tools/dionysus.ts agent config set --role worker --cli opencode --model "minimax/MiniMax-M2.7" --enabled true
  tsx tools/dionysus.ts agent status --goal-id "..."
  tsx tools/dionysus.ts agent usage --goal-id "..."
  tsx tools/dionysus.ts fastlane plan --title "..." --description "..." --target-root "/path/to/project" --worker "后端::实现 API" --worker "前端::接入页面"
  tsx tools/dionysus.ts fastlane start --title "..." --description "..." --target-root "/path/to/project" --worker "后端::实现 API" --worker "前端::接入页面" [--reviewer "Reviewer::90分门禁"] [--queue-reviewers]
  tsx tools/dionysus.ts release record --goal-id "..." --target-root "/path/to/project" --branch main --commit-sha "..." --status passed --pushed true --changed-file "path" --verification-json '[{"command":"pnpm test","status":"passed"}]' --summary "..."
  tsx tools/dionysus.ts release list --goal-id "..."
  tsx tools/dionysus.ts run logs --run-id "..."
  tsx tools/dionysus.ts goal list --limit 10
  tsx tools/dionysus.ts goal status --goal-id "..."
  tsx tools/dionysus.ts goal cancel --goal-id "..." --reason "..."
  tsx tools/dionysus.ts goal fast-lane --goal-id "..." --reason "..."
  tsx tools/dionysus.ts goal intake --goal-id "..."
  tsx tools/dionysus.ts goal bootstrap --goal-id "..."
  tsx tools/dionysus.ts goal preflight --goal-id "..."
  tsx tools/dionysus.ts goal gate-check --goal-id "..."
  tsx tools/dionysus.ts goal remediation --goal-id "..."
  tsx tools/dionysus.ts goal remediation-patch --goal-id "..."
  tsx tools/dionysus.ts goal master-step --goal-id "..."
  tsx tools/dionysus.ts goal release-ready --goal-id "..."
  tsx tools/dionysus.ts goal detect-milestones --goal-id "..."
  tsx tools/dionysus.ts goal run-cycle --goal-id "..." --target-url "http://localhost:23101" --run-e2e --mode strict
  tsx tools/dionysus.ts goal supervise --goal-id "..." --iterations 5 --interval-seconds 30
  tsx tools/dionysus.ts integration list --goal-id "..."
  tsx tools/dionysus.ts integration evidence --integration-id "..." --final-user-evidence "admin 登录后完成新增租户" --persistence-evidence "刷新后租户仍从 PostgreSQL 返回"
  tsx tools/dionysus.ts integration retry --integration-id "..."
  tsx tools/dionysus.ts task create --goal-id "..." --title "..." --role worker [--no-queue]
  tsx tools/dionysus.ts task enqueue --task-id "..."
  tsx tools/dionysus.ts task cancel --task-id "..." --reason "..."
  tsx tools/dionysus.ts task review --task-id "..." --verdict approve --reason "reviewed by Codex"
  tsx tools/dionysus.ts milestone request-e2e --milestone-id "..."
  tsx tools/dionysus.ts milestone create-campaign --milestone-id "..." --target-url "..." --acceptance "..."
  tsx tools/dionysus.ts milestone verdict --milestone-id "..." --verdict passed --reason "..."
  tsx tools/dionysus.ts milestone notify --milestone-id "..." --summary "..." --target-url "..."
  tsx tools/dionysus.ts e2e cases --campaign-id "..."
  tsx tools/dionysus.ts e2e case-result --case-id "..." --status passed --result-json '{"note":"..."}'
  tsx tools/dionysus.ts e2e run-campaign --campaign-id "..." --mode strict
  tsx tools/dionysus.ts notification deliver --notification-id "..."
  tsx tools/dionysus.ts codex outbox --limit 5
  tsx tools/dionysus.ts codex heartbeat --limit 5
  tsx tools/dionysus.ts codex reconcile
  tsx tools/dionysus.ts codex ack --event-id "..." [--force]
`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
