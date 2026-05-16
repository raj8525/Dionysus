import "dotenv/config";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createPool, DionysusRepository, loadDatabaseConfig } from "@dionysus/db";
import { publishJson } from "@dionysus/mq";
import { buildMilestoneNotificationDraft, checkSpecTestGate, compileTargetProject } from "@dionysus/core";
import { probeAllClis } from "@dionysus/cli-adapters";

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
  priority: z.number().int().optional()
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

const createPatchSchema = z.object({
  goalId: z.string().uuid(),
  taskId: z.string().uuid(),
  patchText: z.string(),
  changedFiles: z.array(z.string())
});

export async function buildServer() {
  const dbConfig = loadDatabaseConfig();
  const pool = createPool(dbConfig);
  const repo = new DionysusRepository(pool, dbConfig.schema);
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  app.addHook("onClose", async () => {
    await pool.end();
  });

  app.get("/health", async () => ({
    ok: true,
    service: "dionysus-api"
  }));

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

  app.post("/api/tasks", async (request, reply) => {
    const parsed = createTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_TASK_INPUT", details: parsed.error.flatten() });
    }
    const task = await repo.createTask(parsed.data);
    await repo.markTaskQueued(task.id);
    await publishJson("dionysus.worker", {
      message_id: randomUUID(),
      goal_id: parsed.data.goalId,
      task_id: task.id,
      type: "worker_task",
      attempt: 1,
      idempotency_key: `${task.id}:worker:1`,
      created_at: new Date().toISOString()
    });
    return reply.code(201).send({ ...task, status: "queued" });
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

  app.post("/api/milestones/:id/codex-verdict", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = codexVerdictSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_CODEX_VERDICT", details: parsed.error.flatten() });
    }
    await repo.recordCodexVerdict({ milestoneId: id, ...parsed.data });
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
    const delivery = await repo.deliverNotification(id);
    return reply.code(202).send(delivery);
  });

  app.post("/api/cli/probe", async () => {
    const results = await probeAllClis();
    await repo.saveCliProbeResults(results);
    return results;
  });

  app.get("/api/cli/models", async () => repo.listCliModels());

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

if (import.meta.url === `file://${process.argv[1]}`) {
  const host = process.env.API_HOST ?? "0.0.0.0";
  const port = Number(process.env.API_PORT ?? "23100");
  const app = await buildServer();
  await app.listen({ host, port });
}
