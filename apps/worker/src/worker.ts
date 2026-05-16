import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { CliType } from "@dionysus/core";
import { createCliAdapter, MockAdapter } from "@dionysus/cli-adapters";
import { createPool, DionysusRepository, loadDatabaseConfig } from "@dionysus/db";
import { consumeJson, publishJson, type QueueMessage } from "@dionysus/mq";

const workerQueue = "dionysus.worker";
const integrationQueue = "dionysus.integration";
const workerCliType = parseWorkerCliType(process.env.DIONYSUS_WORKER_CLI_TYPE);
const workerCliModel = process.env.DIONYSUS_WORKER_CLI_MODEL || undefined;
const adapter = workerCliType === "mock"
  ? new MockAdapter()
  : createCliAdapter({ cliType: workerCliType, model: workerCliModel });
const dbConfig = loadDatabaseConfig();
const pool = createPool(dbConfig);
const repo = new DionysusRepository(pool, dbConfig.schema);

async function handleWorkerTask(message: QueueMessage): Promise<void> {
  if (!message.task_id) {
    throw new Error("worker task requires task_id");
  }

  const prompt = `Execute Dionysus task ${message.task_id}`;
  const runId = await repo.createTaskRun({
    taskId: message.task_id,
    cliType: workerCliType,
    cliModel: workerCliModel,
    command: `${workerCliType}.run`,
    prompt
  });

  const result = await adapter.run({
    taskId: message.task_id,
    prompt,
    cwd: process.env.TARGET_COUPON_ROOT ?? process.cwd()
  });

  if (result.stdout) {
    await repo.appendRunLog(runId, "stdout", result.stdout, 1);
  }
  if (result.stderr) {
    await repo.appendRunLog(runId, "stderr", result.stderr, 2);
  }
  await repo.completeTaskRun({ taskId: message.task_id, runId, exitCode: result.exitCode });

  await publishJson(integrationQueue, {
    message_id: randomUUID(),
    goal_id: message.goal_id,
    task_id: message.task_id,
    type: result.exitCode === 0 ? "worker_completed" : "worker_failed",
    attempt: message.attempt,
    idempotency_key: `${message.task_id}:integration:${message.attempt}`,
    created_at: new Date().toISOString()
  });
}

function parseWorkerCliType(value: string | undefined): CliType {
  if (value === "claude_code" || value === "gemini_cli" || value === "opencode" || value === "mock") {
    return value;
  }
  return "mock";
}

console.log(`Dionysus worker consuming ${workerQueue} with ${workerCliType}`);
await consumeJson(workerQueue, handleWorkerTask);
