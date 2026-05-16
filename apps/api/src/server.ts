import "dotenv/config";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createPool, DionysusRepository, loadDatabaseConfig } from "@dionysus/db";
import { publishJson } from "@dionysus/mq";
import { compileTargetProject } from "@dionysus/core";

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

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const host = process.env.API_HOST ?? "0.0.0.0";
  const port = Number(process.env.API_PORT ?? "23100");
  const app = await buildServer();
  await app.listen({ host, port });
}
