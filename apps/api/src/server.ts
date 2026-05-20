import "dotenv/config";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { createPool, DionysusRepository, loadDatabaseConfig } from "@dionysus/db";
import { checkRabbitMqHealth, publishJson } from "@dionysus/mq";
import {
  buildMasterTaskTree,
  buildMilestoneNotificationDraft,
  buildNotificationPayload,
  buildCodexOutboxDraft,
  buildAddFilesPatch,
  buildTelegramRequest,
  buildTargetPreflight,
  buildPreflightRemediation,
  checkGitPreflight,
  checkSpecTestGate,
  compileTargetProject,
  decideMasterStep,
  evaluateCodexOutboxAckGate,
  evaluateMilestoneNotificationGate,
  evaluateWatchdogTask,
  findUnmanagedGitChanges,
  validateReleaseRecordEvidence,
  validateE2ECaseResultEvidence,
  resolveNotificationChannels,
  queueForRole,
  evaluateReviewerApprovalGate,
  evaluateTaskReviewRejectionPolicy,
  evaluateCouponDataFirstEnqueueGate,
  selectCouponDataFirstFollowupTasks,
  selectFastLaneReviewerFollowupTasks,
  shouldDispatchAfterTaskReview,
  shouldRequeueRejectedTask,
  deriveWorkerHealth,
  deriveWorkerEffectiveRunConfig,
  taskReviewStatusForContext,
  isFastLaneReviewerTaskTitle
} from "@dionysus/core";
import type { MilestoneStatus, NotificationChannelDraft, NotificationMessage } from "@dionysus/core";
import { probeAllClis, validateCliModel } from "@dionysus/cli-adapters";

const createGoalSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  targetRoot: z.string().min(1)
});

const cancelGoalSchema = z.object({
  reason: z.string().min(1).default("cancelled by Codex")
});

const fastLaneGoalSchema = z.object({
  reason: z.string().min(1).default("started by Codex fast lane")
});

const createTaskSchema = z.object({
  goalId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().min(1),
  roleRequired: z.enum(["master", "rule_writer", "test_writer", "worker"]),
  priority: z.number().int().optional(),
  queue: z.boolean().default(true)
});

const agentCliConfigSchema = z.object({
  role: z.enum(["master", "rule_writer", "test_writer", "worker"]),
  cliType: z.enum(["mock", "claude_code", "gemini_cli", "opencode"]),
  cliModel: z.string().optional(),
  enabled: z.boolean().optional()
});

const cliModelValidationSchema = z.object({
  cliType: z.enum(["mock", "claude_code", "gemini_cli", "opencode"]),
  model: z.string().optional().nullable()
});

const createMilestoneSchema = z.object({
  goalId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().min(1),
  mainCommitSha: z.string().optional(),
  candidateReason: z.string().min(1)
});

const codexVerdictSchema = z.object({
  verdict: z.enum(["passed", "failed", "blocked"]),
  reason: z.string().min(1)
});

const createNotificationSchema = z.object({
  milestoneId: z.string().uuid(),
  title: z.string().min(1),
  body: z.string().min(1)
});

const createMilestoneNotificationSchema = z.object({
  summary: z.string().min(1),
  targetUrl: z.string().min(1),
  verificationCommands: z.array(z.string()).default([]),
  residualRisks: z.array(z.string()).default([])
});

const createE2ECampaignSchema = z.object({
  targetUrl: z.string().min(1),
  acceptance: z.array(z.string()).default([])
});

const recordE2ECaseResultSchema = z.object({
  status: z.enum(["passed", "failed", "blocked", "skipped"]),
  failureReason: z.string().optional(),
  result: z.record(z.string(), z.unknown()).optional()
});

const recordIntegrationEvidenceSchema = z.object({
  finalUserFeatureEvidence: z.array(z.string().min(1)).min(1),
  realDataPersistenceEvidence: z.array(z.string().min(1)).min(1)
});

const createPatchSchema = z.object({
  goalId: z.string().uuid(),
  taskId: z.string().uuid(),
  patchText: z.string(),
  changedFiles: z.array(z.string()),
  allowedFiles: z.array(z.string()).default([])
});

const cancelTaskSchema = z.object({
  reason: z.string().min(1).default("cancelled by Codex")
});

const reviewTaskSchema = z.object({
  verdict: z.enum(["approve", "reject", "block"]),
  reason: z.string().min(1).default("reviewed by Codex"),
  score: z.number().int().min(0).max(100).optional()
});

const codexCompleteTaskSchema = z.object({
  reason: z.string().min(1),
  evidence: z.record(z.string(), z.unknown()).optional()
});

const workerHealthMaxAgeSeconds = Number.parseInt(process.env.DIONYSUS_WORKER_HEALTH_MAX_AGE_SECONDS ?? "90", 10);
const execFileAsync = promisify(execFile);
const apiRuntimeStartedAt = new Date().toISOString();
const apiRuntimeInstanceId = randomUUID();

const watchdogRunSchema = z.object({
  runningTimeoutMinutes: z.number().int().positive().max(24 * 60).default(15),
  limit: z.number().int().positive().max(200).default(50)
});

const codexOutboxCreateSchema = z.object({
  goalId: z.string().uuid().optional(),
  eventType: z.enum(["blocker", "e2e_required", "release_ready", "user_notify"]),
  reason: z.string().min(1),
  source: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional()
});

const codexOutboxAckSchema = z.object({
  force: z.boolean().default(false)
});

const releaseRecordSchema = z.object({
  goalId: z.string().uuid(),
  codexOutboxEventId: z.string().uuid().optional(),
  targetRoot: z.string().min(1),
  branch: z.string().min(1),
  commitSha: z.string().min(1),
  status: z.enum(["passed", "failed", "blocked"]),
  pushed: z.boolean().default(false),
  changedFiles: z.array(z.string()).default([]),
  verification: z.array(z.object({
    command: z.string().min(1),
    status: z.enum(["passed", "failed", "blocked"]),
    output: z.string().optional()
  })).default([]),
  summary: z.string().default("")
});

const systemEventCreateSchema = z.object({
  eventType: z.string().regex(/^[a-z][a-z0-9_.-]{2,80}$/),
  payload: z.record(z.string(), z.unknown()).default({})
});

export interface BuildServerOptions {
  repo?: DionysusRepository;
  publishJson?: typeof publishJson;
  checkRabbitMqHealth?: typeof checkRabbitMqHealth;
  apiCodeCommitSha?: string;
  logger?: boolean;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const dbConfig = options.repo ? null : loadDatabaseConfig();
  const pool: ReturnType<typeof createPool> | null = dbConfig ? createPool(dbConfig) : null;
  const repo = options.repo ?? new DionysusRepository(pool as ReturnType<typeof createPool>, dbConfig?.schema ?? "dionysus");
  const publish = options.publishJson ?? publishJson;
  const checkRabbit = options.checkRabbitMqHealth ?? checkRabbitMqHealth;
  const app = Fastify({ logger: options.logger ?? true });
  const apiCodeCommitSha = options.apiCodeCommitSha ?? await readDionysusCodeCommitSha();

  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  });

  app.addHook("onClose", async () => {
    await pool?.end();
  });

  app.get("/health", async () => {
    const [database, rabbitmq, workerEvents, workerRoleConfig] = await Promise.all([
      repo.healthCheck(),
      checkRabbit(),
      repo.listSystemEvents({ eventPrefix: "worker.", limit: 5 }) as Promise<Array<{
        eventType: string;
        createdAt: string;
        payload?: Record<string, unknown>;
      }>>,
      repo.getAgentCliConfig("worker").catch(() => null)
    ]);
    const worker = deriveWorkerHealth({
      nowIso: new Date().toISOString(),
      maxAgeSeconds: Number.isFinite(workerHealthMaxAgeSeconds) && workerHealthMaxAgeSeconds > 0
        ? workerHealthMaxAgeSeconds
        : 90,
      events: workerEvents
    });
    const workerWithEffectiveConfig = {
      ...worker,
      effectiveRunConfig: deriveWorkerEffectiveRunConfig({
        runtime: worker.status === "missing" ? undefined : worker.runtime,
        roleConfig: workerRoleConfig
      })
    };
    return {
      ok: database.ok && rabbitmq.ok && workerWithEffectiveConfig.ok,
      service: "dionysus-api",
      runtime: {
        pid: process.pid,
        runtimeInstanceId: apiRuntimeInstanceId,
        runtimeStartedAt: apiRuntimeStartedAt,
        codeCommitSha: apiCodeCommitSha
      },
      database,
      rabbitmq,
      worker: workerWithEffectiveConfig
    };
  });

  app.post("/api/goals", async (request, reply) => {
    const parsed = createGoalSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_GOAL_INPUT", details: parsed.error.flatten() });
    }
    const goal = await repo.createGoal(parsed.data);
    return reply.code(201).send(goal);
  });

  app.post("/api/goals/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = cancelGoalSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_GOAL_CANCEL_INPUT", details: parsed.error.flatten() });
    }
    const goal = await repo.cancelGoal({ goalId: id, reason: parsed.data.reason });
    if (!goal) {
      return reply.code(404).send({ error: "GOAL_NOT_FOUND_OR_ALREADY_CLOSED" });
    }
    return reply.code(202).send(goal);
  });

  app.post("/api/goals/:id/fast-lane", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = fastLaneGoalSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_GOAL_FAST_LANE_INPUT", details: parsed.error.flatten() });
    }
    const goal = await repo.markGoalFastLane({ goalId: id, reason: parsed.data.reason });
    if (!goal) {
      return reply.code(404).send({ error: "GOAL_NOT_FOUND_OR_ALREADY_CLOSED" });
    }
    return reply.code(202).send(goal);
  });

  app.get("/api/goals", async (request) => {
    const query = request.query as { limit?: string };
    const parsedLimit = query.limit ? Number(query.limit) : 20;
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(Math.floor(parsedLimit), 100)) : 20;
    return repo.listGoals(limit);
  });

  app.get("/api/goals/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const goal = await repo.getGoal(id);
    if (!goal) {
      return reply.code(404).send({ error: "GOAL_NOT_FOUND" });
    }
    return goal;
  });

  app.get("/api/goals/:id/graph", async (request, reply) => {
    const { id } = request.params as { id: string };
    const flow = await repo.buildFlow(id);
    if (!flow) {
      return reply.code(404).send({ error: "GOAL_NOT_FOUND" });
    }
    return flow;
  });

  app.get("/api/goals/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const goal = await repo.getGoal(id);
    if (!goal) {
      return reply.code(404).send({ error: "GOAL_NOT_FOUND" });
    }
    const [tasks, runs, integrations, milestones, releases, usage, pendingCodexOutbox] = await Promise.all([
      repo.listTasks(id),
      repo.listTaskRuns({ goalId: id, limit: 20 }),
      repo.listIntegrations(id),
      repo.listMilestones(id),
      repo.listReleaseRecords(id),
      repo.getAgentCliUsage({ goalId: id }),
      repo.listCodexOutboxEvents({ goalId: id, status: "pending", limit: 20 })
    ]);
    return {
      goal,
      summary: {
        tasks: summarizeStatuses(tasks),
        runs: summarizeStatuses(runs),
        integrations: summarizeStatuses(integrations),
        milestones: summarizeStatuses(milestones),
        releases: summarizeStatuses(releases),
        pendingCodexOutbox: pendingCodexOutbox.length,
        cliCalls: usage.totals.cliCalls,
        modelCalls: usage.totals.modelCalls,
        nextOwner: pendingCodexOutbox.length > 0 ? "Codex" : "Dionysus"
      },
      tasks,
      runs,
      integrations,
      milestones,
      releases,
      usage,
      pendingCodexOutbox
    };
  });

  app.get("/api/flow/current", async () => repo.buildFlow());

  app.get("/api/flow/goal/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const flow = await repo.buildFlow(id);
    if (!flow) {
      return reply.code(404).send({ error: "GOAL_NOT_FOUND" });
    }
    return flow;
  });

  app.get("/api/tasks", async (request) => {
    const query = request.query as { goalId?: string };
    return repo.listTasks(query.goalId);
  });

  app.get("/api/runs", async (request) => {
    const query = request.query as { goalId?: string; limit?: string };
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 100);
    return repo.listTaskRuns({ goalId: query.goalId, limit });
  });

  app.get("/api/runs/:id/logs", async (request) => {
    const { id } = request.params as { id: string };
    const logs = await repo.listTaskRunLogs(id);
    return { runId: id, logs };
  });

  app.get("/api/usage/agent-cli", async (request) => {
    const query = request.query as { goalId?: string; targetRoot?: string };
    return repo.getAgentCliUsage({ goalId: query.goalId, targetRoot: query.targetRoot });
  });

  app.get("/api/agents", async (request) => {
    const query = request.query as { role?: string };
    const role = query.role === "master" || query.role === "rule_writer" ||
      query.role === "test_writer" || query.role === "worker"
      ? query.role
      : undefined;
    return repo.listAgents(role);
  });

  app.get("/api/releases", async (request) => {
    const query = request.query as { goalId?: string };
    return repo.listReleaseRecords(query.goalId);
  });

  app.post("/api/releases", async (request, reply) => {
    const parsed = releaseRecordSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_RELEASE_RECORD", details: parsed.error.flatten() });
    }
    const goal = await repo.getGoal(parsed.data.goalId);
    if (!goal) {
      return reply.code(404).send({ error: "GOAL_NOT_FOUND" });
    }
    const evidenceGate = validateReleaseRecordEvidence(parsed.data);
    if (!evidenceGate.allowed) {
      return reply.code(409).send({
        error: "RELEASE_RECORD_EVIDENCE_REQUIRED",
        reason: evidenceGate.reason
      });
    }
    const record = await repo.createReleaseRecord(parsed.data);
    return reply.code(201).send(record);
  });

  app.get("/api/agent-cli-configs", async () => repo.listAgentCliConfigs());

  app.put("/api/agent-cli-configs", async (request, reply) => {
    const parsed = agentCliConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_AGENT_CLI_CONFIG", details: parsed.error.flatten() });
    }
    const config = await repo.upsertAgentCliConfig(parsed.data);
    return reply.code(200).send(config);
  });

  app.post("/api/watchdog/run", async (request, reply) => {
    const parsed = watchdogRunSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_WATCHDOG_INPUT", details: parsed.error.flatten() });
    }
    const now = new Date();
    const runningTimeoutMs = parsed.data.runningTimeoutMinutes * 60 * 1000;
    const runningUpdatedBefore = new Date(now.getTime() - runningTimeoutMs).toISOString();
    const candidates = await repo.listWatchdogCandidates({
      runningUpdatedBefore,
      limit: parsed.data.limit
    });
    const actions = [];
    for (const task of candidates) {
      const decision = evaluateWatchdogTask({
        task,
        now,
        runningTimeoutMs
      });
      if (decision.action === "retry") {
        await repo.markTaskRetryQueued({
          taskId: task.id,
          reason: decision.reason,
          nextAttempt: decision.nextAttempt
        });
        await publish(queueForRole(task.roleRequired), {
          message_id: randomUUID(),
          goal_id: task.goalId,
          task_id: task.id,
          type: `${task.roleRequired}_task`,
          attempt: decision.nextAttempt,
          idempotency_key: `${task.id}:${task.roleRequired}:${decision.nextAttempt}:watchdog`,
          created_at: now.toISOString()
        });
      }
      if (decision.action === "block") {
        await repo.markTaskBlocked({
          taskId: task.id,
          reason: decision.reason
        });
        await repo.createCodexOutboxEvent(buildCodexOutboxDraft({
          goalId: task.goalId,
          eventType: "blocker",
          reason: `watchdog blocked ${task.roleRequired} task ${task.id}: ${decision.reason}`,
          source: "watchdog.run",
          payload: {
            taskId: task.id,
            roleRequired: task.roleRequired,
            previousStatus: task.status
          }
        }));
      }
      actions.push({
        taskId: task.id,
        roleRequired: task.roleRequired,
        previousStatus: task.status,
        decision
      });
    }
    return {
      checked: candidates.length,
      actions
    };
  });

  app.get("/api/watchdog/events", async (request) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "30", 10) || 30, 1), 100);
    return repo.listWatchdogEvents(limit);
  });

  app.get("/api/system-events", async (request) => {
    const query = request.query as { prefix?: string; limit?: string };
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "30", 10) || 30, 1), 100);
    return repo.listSystemEvents({ eventPrefix: query.prefix, limit });
  });

  app.post("/api/system-events", async (request, reply) => {
    const parsed = systemEventCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_SYSTEM_EVENT", details: parsed.error.flatten() });
    }
    await repo.recordSystemEvent(parsed.data.eventType, parsed.data.payload);
    return reply.code(201).send(parsed.data);
  });

  app.get("/api/codex/outbox", async (request) => {
    const query = request.query as { status?: string; eventType?: string; limit?: string };
    const status = query.status === "pending" || query.status === "acked" || query.status === "cancelled"
      ? query.status
      : undefined;
    const eventType = query.eventType === "blocker" || query.eventType === "e2e_required" ||
      query.eventType === "release_ready" || query.eventType === "user_notify"
      ? query.eventType
      : undefined;
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "20", 10) || 20, 1), 100);
    return repo.listCodexOutboxEvents({ status, eventType, limit });
  });

  app.post("/api/codex/outbox", async (request, reply) => {
    const parsed = codexOutboxCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_CODEX_OUTBOX_INPUT", details: parsed.error.flatten() });
    }
    const event = await repo.createCodexOutboxEvent(buildCodexOutboxDraft(parsed.data));
    return reply.code(201).send(event);
  });

  app.post("/api/codex/outbox/:id/ack", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = codexOutboxAckSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_CODEX_OUTBOX_ACK", details: parsed.error.flatten() });
    }
    const existing = await repo.getCodexOutboxEvent(id);
    if (!existing) {
      return reply.code(404).send({ error: "CODEX_OUTBOX_EVENT_NOT_FOUND" });
    }
    const releaseRecordCount = existing.eventType === "release_ready"
      ? await repo.countReleaseRecordsForCodexOutboxEvent(id)
      : 0;
    const gate = evaluateCodexOutboxAckGate({
      eventType: existing.eventType,
      releaseRecordCount,
      force: parsed.data.force
    });
    if (!gate.allowed) {
      return reply.code(409).send({
        error: "CODEX_OUTBOX_ACK_BLOCKED",
        reason: gate.reason,
        event: existing,
        requiredAction: "run pnpm dionysus release record with --codex-outbox-event-id before ack"
      });
    }
    const event = await repo.ackCodexOutboxEvent(id);
    if (!event) {
      return reply.code(404).send({ error: "CODEX_OUTBOX_EVENT_NOT_FOUND" });
    }
    return reply.code(202).send(event);
  });

  app.post("/api/codex/outbox/reconcile", async () => repo.reconcileResolvedCodexOutboxEvents());

  app.post("/api/tasks", async (request, reply) => {
    const parsed = createTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_TASK_INPUT", details: parsed.error.flatten() });
    }
    const task = await repo.createTask(parsed.data);
    if (parsed.data.queue) {
      const goalTasks = await repo.listTasks(parsed.data.goalId);
      const gate = evaluateCouponDataFirstEnqueueGate({
        task: { ...parsed.data, id: task.id, status: task.status },
        goalTasks
      });
      if (!gate.allowed) {
        await repo.recordTaskEvent(task.id, "task.enqueue_blocked", { ...gate });
        return reply.code(201).send({ ...task, enqueueBlocked: gate });
      }
      await attachReportOnlyReviewerEvidenceIfNeeded(repo, { task, goalTasks });
      await repo.markTaskQueued(task.id);
      await publish(queueForRole(parsed.data.roleRequired), {
        message_id: randomUUID(),
        goal_id: parsed.data.goalId,
        task_id: task.id,
        type: `${parsed.data.roleRequired}_task`,
        attempt: 1,
        idempotency_key: `${task.id}:${parsed.data.roleRequired}:1`,
        created_at: new Date().toISOString()
      });
      return reply.code(201).send({ ...task, status: "queued" });
    }
    return reply.code(201).send(task);
  });

  app.post("/api/tasks/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = cancelTaskSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_TASK_CANCEL_INPUT", details: parsed.error.flatten() });
    }
    const task = await repo.cancelTask({ taskId: id, reason: parsed.data.reason });
    if (!task) {
      return reply.code(404).send({ error: "TASK_NOT_FOUND" });
    }
    return reply.code(202).send(task);
  });

  app.post("/api/tasks/:id/enqueue", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await repo.getTask(id);
    if (!task) {
      return reply.code(404).send({ error: "TASK_NOT_FOUND" });
    }
    const status = String(task.status);
    if (!["created", "queued"].includes(status)) {
      return reply.code(409).send({ error: "TASK_NOT_ENQUEUEABLE", status });
    }
    const roleRequired = String(task.role_required);
    if (!["master", "rule_writer", "test_writer", "worker"].includes(roleRequired)) {
      return reply.code(409).send({ error: "INVALID_TASK_ROLE", roleRequired });
    }
    const goalTasks = await repo.listTasks(String(task.goal_id));
    const gate = evaluateCouponDataFirstEnqueueGate({ task, goalTasks });
    if (!gate.allowed) {
      await repo.recordTaskEvent(id, "task.enqueue_blocked", { ...gate });
      return reply.code(409).send({
        error: gate.error,
        reason: gate.reason,
        id,
        status,
        roleRequired
      });
    }
    await attachReportOnlyReviewerEvidenceIfNeeded(repo, { task, goalTasks });
    await repo.markTaskQueued(id);
    await publish(queueForRole(roleRequired as "master" | "rule_writer" | "test_writer" | "worker"), {
      message_id: randomUUID(),
      goal_id: String(task.goal_id),
      task_id: id,
      type: `${roleRequired}_task`,
      attempt: Number(task.current_attempt ?? 0) + 1,
      idempotency_key: `${id}:${roleRequired}:manual-enqueue:${Date.now()}`,
      created_at: new Date().toISOString()
    });
    return reply.code(202).send({ id, status: "queued", roleRequired });
  });

  app.post("/api/tasks/:id/review", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = reviewTaskSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_TASK_REVIEW_INPUT", details: parsed.error.flatten() });
    }
    const reviewTarget = await repo.getTask(id);
    if (!reviewTarget || reviewTarget.status !== "needs_review") {
      return reply.code(409).send({ error: "TASK_NOT_REVIEWABLE", requiredStatus: "needs_review" });
    }
    const reviewerApprovalGate = evaluateReviewerApprovalGate({
      taskTitle: String(reviewTarget.title ?? ""),
      verdict: parsed.data.verdict,
      score: parsed.data.score
    });
    if (!reviewerApprovalGate.allowed) {
      return reply.code(409).send({
        error: "REVIEWER_SCORE_GATE_BLOCKED",
        requiredScore: reviewerApprovalGate.threshold,
        score: reviewerApprovalGate.score ?? null,
        reason: reviewerApprovalGate.reason,
        requiredAction: "Use --verdict reject below 90 and include concrete Worker fix instructions; only approve ReviewerCLI results with --score >= 90."
      });
    }
    const nextStatus = taskReviewStatusForContext({
      verdict: parsed.data.verdict,
      taskTitle: String(reviewTarget.title ?? "")
    });
    const task = await repo.reviewTask({
      taskId: id,
      verdict: parsed.data.verdict,
      nextStatus,
      reason: parsed.data.reason,
      reviewScore: parsed.data.score
    });
    if (!task) {
      return reply.code(409).send({ error: "TASK_NOT_REVIEWABLE", requiredStatus: "needs_review" });
    }
    if (parsed.data.verdict === "reject" && isFastLaneReviewerTaskTitle(String(task.title ?? ""))) {
      const reason = [
        "FastLane Reviewer gate was rejected by Codex and must not be requeued automatically.",
        `task_id=${id}`,
        `title=${String(task.title ?? "")}`,
        `last_reject_reason=${parsed.data.reason}`
      ].filter(Boolean).join("\n");
      await repo.markTaskBlocked({ taskId: id, reason });
      await repo.recordTaskEvent(id, "task.review_fastlane_reviewer_rejected", {
        reason,
        reviewScore: parsed.data.score ?? null,
        requiredAction: "Codex must inspect the reviewer report, decide whether Worker output needs another iteration or Codex takeover, then record release or create a new task."
      });
      const event = await repo.createCodexOutboxEvent(buildCodexOutboxDraft({
        goalId: String(task.goal_id),
        eventType: "blocker",
        reason,
        source: "task.review.fastlane_reviewer_reject",
        payload: {
          taskId: id,
          title: task.title,
          reviewScore: parsed.data.score ?? null,
          lastRejectReason: parsed.data.reason,
          requiredAction: "Do not rerun this ReviewerCLI automatically; Codex must take over the product-quality decision."
        }
      }));
      return reply.code(202).send({
        ...task,
        status: "blocked",
        blocked_reason: reason,
        codexTakeoverRequired: true,
        codexOutboxEvent: event
      });
    }
    if (shouldRequeueRejectedTask({
      verdict: parsed.data.verdict,
      taskTitle: String(task.title ?? "")
    })) {
      const rejectionCount = await repo.countTaskReviewRejections(id);
      const policy = evaluateTaskReviewRejectionPolicy({
        verdict: parsed.data.verdict,
        rejectionCount
      });
      if (policy.action === "codex_takeover") {
        const reason = [
          policy.reason,
          `task_id=${id}`,
          `title=${String(task.title ?? "")}`,
          `role=${String(task.role_required ?? "")}`,
          `last_reject_reason=${parsed.data.reason}`
        ].filter(Boolean).join("\n");
        await repo.markTaskBlocked({ taskId: id, reason });
        await repo.recordTaskEvent(id, "task.review_codex_takeover", {
          rejectionCount: policy.rejectionCount,
          threshold: policy.threshold,
          lastRejectReason: parsed.data.reason
        });
        const event = await repo.createCodexOutboxEvent(buildCodexOutboxDraft({
          goalId: String(task.goal_id),
          eventType: "blocker",
          reason,
          source: "task.review.rejection_policy",
          payload: {
            taskId: id,
            title: task.title,
            roleRequired: task.role_required,
            rejectionCount: policy.rejectionCount,
            threshold: policy.threshold,
            lastRejectReason: parsed.data.reason,
            requiredAction: "Codex must inspect the task, fix or rewrite the work directly, then review and release it."
          }
        }));
        return reply.code(202).send({
          ...task,
          status: "blocked",
          blocked_reason: reason,
          codexTakeoverRequired: true,
          rejectionPolicy: policy,
          codexOutboxEvent: event
        });
      }
      const roleRequired = String(task.role_required);
      await publish(queueForRole(roleRequired as "master" | "rule_writer" | "test_writer" | "worker"), {
        message_id: randomUUID(),
        goal_id: String(task.goal_id),
        task_id: id,
        type: `${roleRequired}_task_review_rejected`,
        attempt: Number(task.current_attempt ?? 0) + 1,
        idempotency_key: `${id}:${roleRequired}:review-reject:${Date.now()}`,
        created_at: new Date().toISOString()
      });
    }
    if (shouldDispatchAfterTaskReview(parsed.data.verdict)) {
      await dispatchNextTaskAfterReview(repo, task);
    }
    return reply.code(202).send(task);
  });

  app.post("/api/tasks/:id/codex-complete", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = codexCompleteTaskSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_CODEX_COMPLETE_INPUT", details: parsed.error.flatten() });
    }
    const task = await repo.completeTaskByCodex({
      taskId: id,
      reason: parsed.data.reason,
      evidence: parsed.data.evidence
    });
    if (!task) {
      return reply.code(409).send({ error: "TASK_NOT_CODEX_COMPLETABLE" });
    }
    await dispatchNextTaskAfterReview(repo, task);
    return reply.code(200).send(task);
  });

  app.post("/api/goals/:id/intake", async (request, reply) => {
    const { id } = request.params as { id: string };
    const goal = await repo.getGoal(id);
    if (!goal) {
      return reply.code(404).send({ error: "GOAL_NOT_FOUND" });
    }
    const result = await compileTargetProject(goal.targetRoot);
    const saved = await repo.saveIntakeResult({ goalId: id, ...result });
    return reply.code(201).send(saved);
  });

  app.post("/api/goals/:id/bootstrap", async (request, reply) => {
    const { id } = request.params as { id: string };
    const goal = await repo.getGoal(id);
    if (!goal) {
      return reply.code(404).send({ error: "GOAL_NOT_FOUND" });
    }
    const existingTasks = await repo.listTasks(id);
    const existingBootstrapTasks = existingTasks.filter((task) =>
      typeof task.title === "string" &&
      (task.title.startsWith("[Master]") ||
        task.title.startsWith("[RuleWriter]") ||
        task.title.startsWith("[TestWriter]") ||
        task.title.startsWith("[Worker]"))
    );
    if (existingBootstrapTasks.length >= 5) {
      return reply.code(200).send({ goalId: id, existing: true, tasks: existingBootstrapTasks });
    }

    const drafts = buildMasterTaskTree({ goalTitle: goal.title, targetRoot: goal.targetRoot });
    const tasks = [];
    for (const draft of drafts) {
      tasks.push(
        await repo.createTask({
          goalId: id,
          title: draft.title,
          description: draft.description,
          roleRequired: draft.roleRequired,
          priority: draft.priority
        })
      );
    }
    const firstMaster = tasks[0];
    if (firstMaster) {
      await repo.markTaskQueued(firstMaster.id);
      await publish(queueForRole("master"), {
        message_id: randomUUID(),
        goal_id: id,
        task_id: firstMaster.id,
        type: "master_task",
        attempt: 1,
        idempotency_key: `${firstMaster.id}:master:1`,
        created_at: new Date().toISOString()
      });
      firstMaster.status = "queued";
    }
    return reply.code(201).send({ goalId: id, tasks });
  });

  app.post("/api/goals/:id/master-step", async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowedDirtyPaths = readAllowedDirtyPaths(request.body);
    const goal = await repo.getGoal(id);
    if (!goal) {
      return reply.code(404).send({ error: "GOAL_NOT_FOUND" });
    }
    const [git, gates, tasks, queuedIntegrations] = await Promise.all([
      checkGitPreflight(goal.targetRoot, { allowedDirtyPaths }),
      checkSpecTestGate(goal.targetRoot),
      repo.listTasks(id),
      repo.listQueuedIntegrations(id)
    ]);
    await repo.saveGateChecks({ goalId: id, checks: gates });
    const preflight = buildTargetPreflight({ git, gates });
    const bootstrapTaskCount = countBootstrapTasks(tasks);
    const decision = decideMasterStep({
      goalStatus: goal.status,
      bootstrapTaskCount,
      queuedIntegrationCount: queuedIntegrations.length,
      preflight
    });

    if (decision.action === "bootstrap_tasks") {
      const drafts = buildMasterTaskTree({ goalTitle: goal.title, targetRoot: goal.targetRoot });
      const createdTasks = [];
      for (const draft of drafts) {
        createdTasks.push(
          await repo.createTask({
            goalId: id,
            title: draft.title,
            description: draft.description,
            roleRequired: draft.roleRequired,
            priority: draft.priority
          })
        );
      }
      const firstMaster = createdTasks[0];
      if (firstMaster) {
        await repo.markTaskQueued(firstMaster.id);
        await publish(queueForRole("master"), {
          message_id: randomUUID(),
          goal_id: id,
          task_id: firstMaster.id,
          type: "master_task",
          attempt: 1,
          idempotency_key: `${firstMaster.id}:master-step:1`,
          created_at: new Date().toISOString()
        });
        firstMaster.status = "queued";
      }
      return reply.code(201).send({ goalId: id, decision, tasks: createdTasks, preflight });
    }

    if (decision.action === "queue_preflight_remediation") {
      const files = buildPreflightRemediation({ goal, gates });
      if (!files.length) {
        return { goalId: id, decision: { action: "ready_for_implementation", reason: "no remediation files needed" }, preflight };
      }
      const task = await repo.createTask({
        goalId: id,
        title: "[Master] Queue preflight remediation patch",
        description: "Dionysus generated missing PLAN/specs/features_test remediation files as a patch for integration.",
        roleRequired: "master",
        priority: 5
      });
      const patch = await repo.createPatch({
        goalId: id,
        taskId: task.id,
        patchText: buildAddFilesPatch(files),
        changedFiles: files.map((file) => file.path),
        allowedFiles: files.map((file) => file.path)
      });
      const integrationPublished = git.clean;
      if (integrationPublished) {
        await publish("dionysus.integration", {
          message_id: randomUUID(),
          goal_id: id,
          task_id: task.id,
          type: "preflight_remediation_patch",
          attempt: 1,
          idempotency_key: `${task.id}:master-step-preflight-remediation:1`,
          created_at: new Date().toISOString()
        });
      }
      return reply.code(201).send({
        goalId: id,
        decision,
        taskId: task.id,
        patch,
        files,
        integrationPublished,
        blockers: git.clean ? [] : [`git worktree dirty: ${git.changes.length} changes`],
        preflight
      });
    }

    if (decision.action === "release_queued_integrations") {
      for (const integration of queuedIntegrations) {
        await publish("dionysus.integration", {
          message_id: randomUUID(),
          goal_id: id,
          task_id: integration.taskId,
          type: "master_step_release_integration",
          attempt: 1,
          idempotency_key: `${integration.taskId}:master-step-release:${integration.id}`,
          created_at: new Date().toISOString()
        });
      }
      return {
        goalId: id,
        decision,
        published: queuedIntegrations.length,
        integrations: queuedIntegrations,
        preflight
      };
    }

    return {
      goalId: id,
      decision,
      queuedIntegrations,
      preflight
    };
  });

  app.get("/api/goals/:id/findings", async (request, reply) => {
    const { id } = request.params as { id: string };
    const goal = await repo.getGoal(id);
    if (!goal) {
      return reply.code(404).send({ error: "GOAL_NOT_FOUND" });
    }
    return repo.listDocumentFindings(id);
  });

  app.post("/api/goals/:id/detect-milestones", async (request, reply) => {
    const { id } = request.params as { id: string };
    const goal = await repo.getGoal(id);
    if (!goal) {
      return reply.code(404).send({ error: "GOAL_NOT_FOUND" });
    }
    const milestones = await repo.detectMilestoneCandidates(id);
    return reply.code(201).send({ goalId: id, created: milestones });
  });

  app.get("/api/milestones", async (request) => {
    const query = request.query as { goalId?: string };
    return repo.listMilestones(query.goalId);
  });

  app.post("/api/milestones", async (request, reply) => {
    const parsed = createMilestoneSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_MILESTONE_INPUT", details: parsed.error.flatten() });
    }
    const milestone = await repo.createMilestoneCandidate(parsed.data);
    return reply.code(201).send(milestone);
  });

  app.post("/api/milestones/:id/request-e2e", async (request, reply) => {
    const { id } = request.params as { id: string };
    await repo.requestMilestoneE2E(id);
    const milestone = await repo.getMilestone(id);
    if (milestone) {
      await repo.createCodexOutboxEvent(buildCodexOutboxDraft({
        goalId: String(milestone.goal_id),
        eventType: "e2e_required",
        reason: `里程碑需要 Codex 浏览器级 E2E：${String(milestone.name)}`,
        source: "milestone.request-e2e",
        payload: { milestoneId: id }
      }));
    }
    return reply.code(202).send({ id, status: "e2e_required" });
  });

  app.post("/api/milestones/:id/e2e-campaigns", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = createE2ECampaignSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_E2E_CAMPAIGN_INPUT", details: parsed.error.flatten() });
    }
    const campaign = await repo.createE2ECampaign({ milestoneId: id, ...parsed.data });
    return reply.code(201).send(campaign);
  });

  app.get("/api/e2e/campaigns", async (request) => {
    const query = request.query as { milestoneId?: string };
    return repo.listE2ECampaigns(query.milestoneId);
  });

  app.get("/api/e2e/campaigns/:id/cases", async (request) => {
    const { id } = request.params as { id: string };
    return repo.listE2ECases(id);
  });

  app.post("/api/e2e/cases/:id/result", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = recordE2ECaseResultSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_E2E_CASE_RESULT", details: parsed.error.flatten() });
    }
    const evidenceGate = validateE2ECaseResultEvidence({
      status: parsed.data.status,
      result: parsed.data.result
    });
    if (!evidenceGate.allowed) {
      return reply.code(409).send({
        error: "E2E_CASE_EVIDENCE_REQUIRED",
        reason: evidenceGate.reason
      });
    }
    try {
      const result = await repo.recordE2ECaseResult({ caseId: id, ...parsed.data });
      return reply.code(202).send({ caseId: id, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("E2E case not found")) {
        return reply.code(404).send({ error: "E2E_CASE_NOT_FOUND", message });
      }
      throw error;
    }
  });

  app.post("/api/milestones/:id/codex-verdict", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = codexVerdictSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_CODEX_VERDICT", details: parsed.error.flatten() });
    }
    try {
      await repo.recordCodexVerdict({ milestoneId: id, ...parsed.data });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Invalid milestone transition")) {
        return reply.code(409).send({ error: "INVALID_MILESTONE_TRANSITION", message });
      }
      if (message.includes("Milestone passed verdict requires")) {
        return reply.code(409).send({ error: "MILESTONE_E2E_GATE_BLOCKED", message });
      }
      if (message.includes("Milestone not found")) {
        return reply.code(404).send({ error: "MILESTONE_NOT_FOUND", message });
      }
      throw error;
    }
    return reply.code(202).send({ id, verdict: parsed.data.verdict });
  });

  app.post("/api/notifications", async (request, reply) => {
    const parsed = createNotificationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_NOTIFICATION_INPUT", details: parsed.error.flatten() });
    }
    const notification = await repo.createNotification(parsed.data);
    return reply.code(201).send(notification);
  });

  app.post("/api/milestones/:id/notifications", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = createMilestoneNotificationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_MILESTONE_NOTIFICATION_INPUT", details: parsed.error.flatten() });
    }
    const milestone = await repo.getMilestone(id);
    if (!milestone) {
      return reply.code(404).send({ error: "MILESTONE_NOT_FOUND" });
    }
    const gate = evaluateMilestoneNotificationGate(String(milestone.status) as MilestoneStatus);
    if (!gate.allowed) {
      return reply.code(409).send({
        error: "MILESTONE_NOTIFICATION_GATE_BLOCKED",
        reason: gate.reason,
        requiredStatus: "passed",
        currentStatus: String(milestone.status)
      });
    }
    const draft = buildMilestoneNotificationDraft({
      milestoneName: String(milestone.name),
      ...parsed.data
    });
    const notification = await repo.createNotification({ milestoneId: id, ...draft });
    return reply.code(201).send(notification);
  });

  app.post("/api/notifications/:id/deliver", async (request, reply) => {
    const { id } = request.params as { id: string };
    const notification = await repo.getNotification(id);
    if (!notification) {
      return reply.code(404).send({ error: "NOTIFICATION_NOT_FOUND" });
    }
    const message: NotificationMessage = {
      id,
      milestoneId: String(notification.milestoneId),
      title: String(notification.title),
      body: String(notification.body)
    };
    const channels = resolveNotificationChannels(process.env);
    const deliveries = [];
    for (const channel of channels) {
      const channelId = await repo.ensureNotificationChannel({
        type: channel.type,
        name: channel.name,
        config: channel.config
      });
      const result = await deliverToChannel(channel, message);
      const deliveryId = await repo.recordNotificationDelivery({
        notificationId: id,
        milestoneId: message.milestoneId,
        channelId,
        status: result.ok ? "sent" : "failed",
        payload: {
          ...buildNotificationPayload(message),
          channelType: channel.type,
          channelName: channel.name
        },
        errorMessage: result.error
      });
      deliveries.push({
        id: deliveryId,
        channelType: channel.type,
        status: result.ok ? "sent" : "failed",
        error: result.error
      });
    }
    return reply.code(202).send({ notificationId: id, deliveries });
  });

  app.post("/api/cli/probe", async () => {
    const results = await probeAllClis();
    await repo.saveCliProbeResults(results);
    return results;
  });

  app.get("/api/cli/models", async () => repo.listCliModels());

  app.post("/api/cli/validate-model", async (request, reply) => {
    const parsed = cliModelValidationSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_CLI_MODEL_VALIDATION_INPUT", details: parsed.error.flatten() });
    }
    return validateCliModel(parsed.data);
  });

  app.post("/api/goals/:id/gate-check", async (request, reply) => {
    const { id } = request.params as { id: string };
    const goal = await repo.getGoal(id);
    if (!goal) {
      return reply.code(404).send({ error: "GOAL_NOT_FOUND" });
    }
    const checks = await checkSpecTestGate(goal.targetRoot);
    await repo.saveGateChecks({ goalId: id, checks });
    return { goalId: id, checks };
  });

  app.post("/api/goals/:id/preflight", async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowedDirtyPaths = readAllowedDirtyPaths(request.body);
    const goal = await repo.getGoal(id);
    if (!goal) {
      return reply.code(404).send({ error: "GOAL_NOT_FOUND" });
    }
    const [git, gates] = await Promise.all([
      checkGitPreflight(goal.targetRoot, { allowedDirtyPaths }),
      checkSpecTestGate(goal.targetRoot)
    ]);
    await repo.saveGateChecks({ goalId: id, checks: gates });
    return {
      goalId: id,
      ...buildTargetPreflight({ git, gates })
    };
  });

  app.post("/api/goals/:id/preflight-remediation", async (request, reply) => {
    const { id } = request.params as { id: string };
    const goal = await repo.getGoal(id);
    if (!goal) {
      return reply.code(404).send({ error: "GOAL_NOT_FOUND" });
    }
    const gates = await checkSpecTestGate(goal.targetRoot);
    await repo.saveGateChecks({ goalId: id, checks: gates });
    return {
      goalId: id,
      files: buildPreflightRemediation({ goal, gates })
    };
  });

  app.post("/api/goals/:id/preflight-remediation/patch", async (request, reply) => {
    const { id } = request.params as { id: string };
    const goal = await repo.getGoal(id);
    if (!goal) {
      return reply.code(404).send({ error: "GOAL_NOT_FOUND" });
    }
    const [git, gates] = await Promise.all([
      checkGitPreflight(goal.targetRoot),
      checkSpecTestGate(goal.targetRoot)
    ]);
    await repo.saveGateChecks({ goalId: id, checks: gates });
    const files = buildPreflightRemediation({ goal, gates });
    if (!files.length) {
      return reply.code(200).send({ goalId: id, status: "skipped", reason: "no remediation files needed" });
    }
    const task = await repo.createTask({
      goalId: id,
      title: "[Master] Queue preflight remediation patch",
      description: "Dionysus generated missing PLAN/specs/features_test remediation files as a patch for integration.",
      roleRequired: "master",
      priority: 5
    });
    const patch = await repo.createPatch({
      goalId: id,
      taskId: task.id,
      patchText: buildAddFilesPatch(files),
      changedFiles: files.map((file) => file.path),
      allowedFiles: files.map((file) => file.path)
    });
    const integrationPublished = git.clean;
    if (integrationPublished) {
      await publish("dionysus.integration", {
        message_id: randomUUID(),
        goal_id: id,
        task_id: task.id,
        type: "preflight_remediation_patch",
        attempt: 1,
        idempotency_key: `${task.id}:preflight-remediation:1`,
        created_at: new Date().toISOString()
      });
    }
    return reply.code(201).send({
      goalId: id,
      taskId: task.id,
      patch,
      files,
      integrationPublished,
      blockers: git.clean ? [] : [`git worktree dirty: ${git.changes.length} changes`]
    });
  });

  app.post("/api/goals/:id/integrations/release-ready", async (request, reply) => {
    const { id } = request.params as { id: string };
    const goal = await repo.getGoal(id);
    if (!goal) {
      return reply.code(404).send({ error: "GOAL_NOT_FOUND" });
    }
    const allowedDirtyPaths = readAllowedDirtyPaths(request.body);
    const git = await checkGitPreflight(goal.targetRoot, { allowedDirtyPaths });
    const queued = await repo.listQueuedIntegrations(id);
    const integrations = await repo.listIntegrations(id);
    const appliedIntegrations = integrations.filter((integration) =>
      integration.status === "passed" && integration.patchStatus === "applied"
    );
    const managedChangedFiles = Array.from(new Set(
      appliedIntegrations.flatMap((integration) =>
        Array.isArray(integration.changedFiles) ? integration.changedFiles.map(String) : []
      )
    ));
    const unmanagedChanges = findUnmanagedGitChanges({
      changes: git.changes,
      managedPaths: managedChangedFiles
    });
    if (!git.clean && queued.length === 0 && unmanagedChanges.length === 0) {
      const event = await repo.createCodexOutboxEvent(buildCodexOutboxDraft({
        goalId: id,
        eventType: "release_ready",
        reason: `managed target changes are ready for Codex commit: ${managedChangedFiles.length} files`,
        source: "release-ready",
        payload: {
          changedFiles: managedChangedFiles,
          integrationIds: appliedIntegrations.map((integration) => String(integration.id))
        }
      }));
      return {
        goalId: id,
        status: "ready_for_codex_commit",
        blockers: [],
        changedFiles: managedChangedFiles,
        integrations: appliedIntegrations,
        codexOutboxEvent: event
      };
    }
    if (!git.clean) {
      return {
        goalId: id,
        status: "blocked",
        blockers: unmanagedChanges.length
          ? [`unmanaged git changes: ${unmanagedChanges.join(", ")}`]
          : [`git worktree dirty: ${git.changes.length} changes`],
        queued
      };
    }
    for (const integration of queued) {
      await publish("dionysus.integration", {
        message_id: randomUUID(),
        goal_id: id,
        task_id: integration.taskId,
        type: "release_ready_integration",
        attempt: 1,
        idempotency_key: `${integration.taskId}:release-ready:${integration.id}`,
        created_at: new Date().toISOString()
      });
    }
    return {
      goalId: id,
      status: "published",
      published: queued.length,
      integrations: queued
    };
  });

  app.get("/api/integrations", async (request) => {
    const query = request.query as { goalId?: string };
    return repo.listIntegrations(query.goalId);
  });

  app.post("/api/integrations/:id/retry", async (request, reply) => {
    const { id } = request.params as { id: string };
    const integration = await repo.retryIntegration(id);
    if (!integration) {
      return reply.code(404).send({ error: "INTEGRATION_NOT_RETRYABLE" });
    }
    await publish("dionysus.integration", {
      message_id: randomUUID(),
      task_id: integration.taskId,
      goal_id: integration.goalId,
      type: "integration_retry",
      attempt: 1,
      idempotency_key: `${integration.taskId}:integration-retry:${integration.id}`,
      created_at: new Date().toISOString()
    });
    return reply.code(202).send({ status: "queued", integration });
  });

  app.post("/api/integrations/:id/evidence", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = recordIntegrationEvidenceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_INTEGRATION_EVIDENCE", details: parsed.error.flatten() });
    }
    const integration = await repo.recordIntegrationEvidence({ integrationId: id, ...parsed.data });
    if (!integration) {
      return reply.code(404).send({ error: "INTEGRATION_NOT_FOUND" });
    }
    return reply.code(200).send(integration);
  });

  app.post("/api/patches", async (request, reply) => {
    const parsed = createPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_PATCH_INPUT", details: parsed.error.flatten() });
    }
    const patch = await repo.createPatch(parsed.data);
    return reply.code(201).send(patch);
  });

  return app;
}

async function deliverToChannel(
  channel: NotificationChannelDraft,
  message: NotificationMessage
): Promise<{ ok: boolean; error?: string }> {
  if (channel.type === "console") {
    console.log(`[Dionysus Notification] ${message.title}\n${message.body}`);
    return { ok: true };
  }

  if (channel.type === "telegram") {
    const botToken = channel.config.botToken;
    const chatId = channel.config.chatId;
    if (!botToken || !chatId) {
      return { ok: false, error: "telegram channel missing botToken or chatId" };
    }
    const request = buildTelegramRequest({ botToken, chatId, message });
    return postJson(request.url, request.body);
  }

  if (channel.type === "email" || channel.type === "webhook") {
    const url = channel.config.url;
    if (!url) {
      return { ok: false, error: `${channel.type} channel missing url` };
    }
    return postJson(url, {
      ...buildNotificationPayload(message),
      to: channel.config.to ?? ""
    });
  }

  return { ok: false, error: `unsupported channel ${channel.type}` };
}

async function postJson(url: string, body: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function readAllowedDirtyPaths(body: unknown): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const value = (body as { allowedDirtyPaths?: unknown }).allowedDirtyPaths;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

async function attachReportOnlyReviewerEvidenceIfNeeded(
  repo: DionysusRepository,
  input: {
    task: Record<string, unknown>;
    goalTasks: Array<Record<string, unknown>>;
  }
): Promise<void> {
  if (!isReportOnlyReviewerTask(input.task)) {
    return;
  }
  const goalId = String(input.task.goal_id ?? input.task.goalId ?? "");
  const reviewerTaskId = String(input.task.id ?? "");
  if (!goalId || !reviewerTaskId) {
    return;
  }

  const workerTasks = input.goalTasks.filter(isReportOnlyReviewableWorkerTask);
  const runs = await repo.listTaskRuns({ goalId, limit: 200 });
  const workerReports = [];
  for (const workerTask of workerTasks) {
    const taskId = String(workerTask.id);
    const latestSucceededRun = runs.find((run) =>
      String(run.taskId) === taskId && String(run.status) === "succeeded"
    );
    const latestRun = latestSucceededRun ?? runs.find((run) => String(run.taskId) === taskId);
    const logs = latestRun ? await repo.listTaskRunLogs(String(latestRun.id)) : [];
    workerReports.push({
      taskId,
      taskTitle: String(workerTask.title ?? "unknown"),
      taskStatus: String(workerTask.status ?? "unknown"),
      runId: latestRun ? String(latestRun.id) : null,
      runStatus: latestRun ? String(latestRun.status) : "missing",
      finishedAt: latestRun?.finishedAt ?? null,
      logExcerpt: buildRunLogExcerpt(logs)
    });
  }

  await repo.recordTaskEvent(reviewerTaskId, "reviewer.worker_reports_evidence", {
    source: "task.enqueue",
    generatedAt: new Date().toISOString(),
    goalId,
    reviewerTaskId,
    workerReportCount: workerReports.length,
    workerReports
  });
}

function isReportOnlyReviewerTask(task: Record<string, unknown>): boolean {
  const title = String(task.title ?? "");
  const description = String(task.description ?? "");
  return title.startsWith("FastLane Reviewer") && description.includes("Report-only mode: review Worker reports");
}

function isReportOnlyReviewableWorkerTask(task: Record<string, unknown>): boolean {
  const title = String(task.title ?? "");
  const status = String(task.status ?? "");
  return title.startsWith("FastLane Worker") && ["needs_review", "done"].includes(status);
}

function buildRunLogExcerpt(logs: Array<Record<string, unknown>>, maxChars = 12_000): string {
  const text = logs
    .map((log) => `${String(log.stream ?? "log")}: ${String(log.chunkText ?? "")}`)
    .join("\n")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .split("\n")
    .filter((line) => !line.startsWith("DIONYSUS_DONE_JSON="))
    .join("\n")
    .trim();
  if (text.length <= maxChars) {
    return text;
  }
  const headChars = 2_000;
  const tailChars = maxChars - headChars - 80;
  return [
    text.slice(0, headChars),
    `\n... [truncated ${text.length - headChars - tailChars} chars; keeping head and final report tail] ...\n`,
    text.slice(-tailChars)
  ].join("");
}

async function dispatchNextTaskAfterReview(repo: DionysusRepository, reviewedTask: Record<string, unknown>): Promise<void> {
  const reviewedTaskId = String(reviewedTask.id);
  const goalId = String(reviewedTask.goal_id);
  const priority = Number(reviewedTask.priority ?? 0);
  const goalTasks = await repo.listTasks(goalId);
  const couponFollowups = selectCouponDataFirstFollowupTasks({ reviewedTask, goalTasks });
  if (couponFollowups.length > 0) {
    for (const nextTask of couponFollowups) {
      const roleRequired = String(nextTask.role_required);
      if (!["master", "rule_writer", "test_writer", "worker"].includes(roleRequired)) {
        await repo.recordTaskEvent(reviewedTaskId, "review.dispatch_next_task_skipped", {
          nextTaskId: String(nextTask.id),
          reason: "invalid role",
          roleRequired
        });
        continue;
      }
      await repo.markTaskQueued(String(nextTask.id));
      await publishJson(queueForRole(roleRequired as "master" | "rule_writer" | "test_writer" | "worker"), {
        message_id: randomUUID(),
        goal_id: goalId,
        task_id: String(nextTask.id),
        type: `${roleRequired}_task_review_approved_data_followup`,
        attempt: 1,
        idempotency_key: `${String(nextTask.id)}:${roleRequired}:data-followup:${Date.now()}`,
        created_at: new Date().toISOString()
      });
    }
    await repo.recordTaskEvent(reviewedTaskId, "review.dispatch_coupon_data_followups", {
      nextTaskIds: couponFollowups.map((task) => String(task.id))
    });
    return;
  }
  const reviewerFollowups = selectFastLaneReviewerFollowupTasks({ reviewedTask, goalTasks });
  if (reviewerFollowups.length > 0) {
    for (const nextTask of reviewerFollowups) {
      await attachReportOnlyReviewerEvidenceIfNeeded(repo, {
        task: nextTask as unknown as Record<string, unknown>,
        goalTasks
      });
      await repo.markTaskQueued(String(nextTask.id));
      await publishJson(queueForRole("worker"), {
        message_id: randomUUID(),
        goal_id: goalId,
        task_id: String(nextTask.id),
        type: "worker_task_review_approved_reviewer_followup",
        attempt: 1,
        idempotency_key: `${String(nextTask.id)}:worker:reviewer-followup:${Date.now()}`,
        created_at: new Date().toISOString()
      });
    }
    await repo.recordTaskEvent(reviewedTaskId, "review.dispatch_fastlane_reviewers", {
      nextTaskIds: reviewerFollowups.map((task) => String(task.id))
    });
    return;
  }
  const nextTask = await repo.findNextCreatedTask({ goalId, afterPriority: priority });
  const nextTaskTitle = nextTask
    ? String(goalTasks.find((task) => String(task.id) === nextTask.id)?.title ?? "")
    : "";
  if (nextTask && nextTaskTitle.startsWith("FastLane Reviewer")) {
    await repo.recordTaskEvent(reviewedTaskId, "review.fastlane_reviewer_held", {
      nextTaskId: nextTask.id,
      reason: "waiting for every FastLane Worker to reach done"
    });
    return;
  }
  if (!nextTask) {
    await repo.recordTaskEvent(reviewedTaskId, "review.no_next_task", { goalId });
    return;
  }
  await repo.markTaskQueued(nextTask.id);
  await publishJson(queueForRole(nextTask.roleRequired), {
    message_id: randomUUID(),
    goal_id: goalId,
    task_id: nextTask.id,
    type: `${nextTask.roleRequired}_task_review_approved_next`,
    attempt: 1,
    idempotency_key: `${nextTask.id}:${nextTask.roleRequired}:review-approved:${Date.now()}`,
    created_at: new Date().toISOString()
  });
  await repo.recordTaskEvent(reviewedTaskId, "review.dispatch_next_task", {
    nextTaskId: nextTask.id,
    nextRole: nextTask.roleRequired
  });
}

function countBootstrapTasks(tasks: Array<Record<string, unknown>>): number {
  return tasks.filter((task) =>
    typeof task.title === "string" &&
    (task.title.startsWith("[Master]") ||
      task.title.startsWith("[RuleWriter]") ||
      task.title.startsWith("[TestWriter]") ||
      task.title.startsWith("[Worker]"))
  ).length;
}

function summarizeStatuses(records: Array<{ status?: unknown }>): {
  total: number;
  byStatus: Record<string, number>;
} {
  const byStatus: Record<string, number> = {};
  for (const record of records) {
    const status = String(record.status ?? "unknown");
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }
  return {
    total: records.length,
    byStatus
  };
}

async function readDionysusCodeCommitSha(): Promise<string | undefined> {
  const repoRoot = resolve(process.cwd(), "../..");
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, timeout: 10_000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const host = process.env.API_HOST ?? "0.0.0.0";
  const port = Number(process.env.API_PORT ?? "23100");
  const app = await buildServer();
  await app.listen({ host, port });
}
