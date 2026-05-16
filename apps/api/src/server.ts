import "dotenv/config";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
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
  evaluateWatchdogTask,
  findUnmanagedGitChanges,
  resolveNotificationChannels,
  queueForRole,
  deriveWorkerHealth
} from "@dionysus/core";
import type { NotificationChannelDraft, NotificationMessage } from "@dionysus/core";
import { probeAllClis, validateCliModel } from "@dionysus/cli-adapters";

const createGoalSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  targetRoot: z.string().min(1)
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

const createPatchSchema = z.object({
  goalId: z.string().uuid(),
  taskId: z.string().uuid(),
  patchText: z.string(),
  changedFiles: z.array(z.string())
});

const cancelTaskSchema = z.object({
  reason: z.string().min(1).default("cancelled by Codex")
});

const workerHealthMaxAgeSeconds = Number.parseInt(process.env.DIONYSUS_WORKER_HEALTH_MAX_AGE_SECONDS ?? "90", 10);

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

export async function buildServer() {
  const dbConfig = loadDatabaseConfig();
  const pool = createPool(dbConfig);
  const repo = new DionysusRepository(pool, dbConfig.schema);
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  });

  app.addHook("onClose", async () => {
    await pool.end();
  });

  app.get("/health", async () => {
    const [database, rabbitmq, workerEvents] = await Promise.all([
      repo.healthCheck(),
      checkRabbitMqHealth(),
      repo.listSystemEvents({ eventPrefix: "worker.", limit: 5 }) as Promise<Array<{
        eventType: string;
        createdAt: string;
        payload?: Record<string, unknown>;
      }>>
    ]);
    const worker = deriveWorkerHealth({
      nowIso: new Date().toISOString(),
      maxAgeSeconds: Number.isFinite(workerHealthMaxAgeSeconds) && workerHealthMaxAgeSeconds > 0
        ? workerHealthMaxAgeSeconds
        : 90,
      events: workerEvents
    });
    return {
      ok: database.ok && rabbitmq.ok && worker.ok,
      service: "dionysus-api",
      database,
      rabbitmq,
      worker
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
    const query = request.query as { goalId?: string };
    return repo.getAgentCliUsage({ goalId: query.goalId });
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
        await publishJson(queueForRole(task.roleRequired), {
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
      await repo.markTaskQueued(task.id);
      await publishJson(queueForRole(parsed.data.roleRequired), {
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
    await repo.markTaskQueued(id);
    await publishJson(queueForRole(roleRequired as "master" | "rule_writer" | "test_writer" | "worker"), {
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
      await publishJson(queueForRole("master"), {
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
    const goal = await repo.getGoal(id);
    if (!goal) {
      return reply.code(404).send({ error: "GOAL_NOT_FOUND" });
    }
    const [git, gates, tasks, queuedIntegrations] = await Promise.all([
      checkGitPreflight(goal.targetRoot),
      checkSpecTestGate(goal.targetRoot),
      repo.listTasks(id),
      repo.listQueuedIntegrations(id)
    ]);
    await repo.saveGateChecks({ goalId: id, checks: gates });
    const preflight = buildTargetPreflight({ git, gates });
    const bootstrapTaskCount = countBootstrapTasks(tasks);
    const decision = decideMasterStep({
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
        await publishJson(queueForRole("master"), {
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
        changedFiles: files.map((file) => file.path)
      });
      const integrationPublished = git.clean;
      if (integrationPublished) {
        await publishJson("dionysus.integration", {
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
        await publishJson("dionysus.integration", {
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
    const goal = await repo.getGoal(id);
    if (!goal) {
      return reply.code(404).send({ error: "GOAL_NOT_FOUND" });
    }
    const [git, gates] = await Promise.all([
      checkGitPreflight(goal.targetRoot),
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
      changedFiles: files.map((file) => file.path)
    });
    const integrationPublished = git.clean;
    if (integrationPublished) {
      await publishJson("dionysus.integration", {
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
    const git = await checkGitPreflight(goal.targetRoot);
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
      await publishJson("dionysus.integration", {
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
    await publishJson("dionysus.integration", {
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

function countBootstrapTasks(tasks: Array<Record<string, unknown>>): number {
  return tasks.filter((task) =>
    typeof task.title === "string" &&
    (task.title.startsWith("[Master]") ||
      task.title.startsWith("[RuleWriter]") ||
      task.title.startsWith("[TestWriter]") ||
      task.title.startsWith("[Worker]"))
  ).length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const host = process.env.API_HOST ?? "0.0.0.0";
  const port = Number(process.env.API_PORT ?? "23100");
  const app = await buildServer();
  await app.listen({ host, port });
}
