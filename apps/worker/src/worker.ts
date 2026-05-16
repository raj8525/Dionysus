import "dotenv/config";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { CliType } from "@dionysus/core";
import { createIsolatedWorkspace, createPatch as createWorkspacePatch } from "@dionysus/core";
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
const targetRoot = process.env.TARGET_COUPON_ROOT ?? process.cwd();
const workspaceRoot = process.env.DIONYSUS_WORKSPACE_ROOT ?? resolve(process.cwd(), "../../.dionysus/workspaces");
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

  try {
    const workspace = await createIsolatedWorkspace({
      targetRoot,
      workspaceRoot,
      taskId: message.task_id
    });
    await repo.recordTaskEvent(message.task_id, "workspace.created", {
      workspacePath: workspace.workspacePath,
      source: targetRoot
    });

    const result = await adapter.run({
      taskId: message.task_id,
      prompt,
      cwd: workspace.workspacePath
    });

    if (result.stdout) {
      await repo.appendRunLog(runId, "stdout", result.stdout, 1);
    }
    if (result.stderr) {
      await repo.appendRunLog(runId, "stderr", result.stderr, 2);
    }

    if (result.exitCode === 0 && message.goal_id) {
      const patch = await createWorkspacePatch({ workspacePath: workspace.workspacePath });
      if (patch.patchText.trim().length > 0) {
        const queuedPatch = await repo.createPatch({
          goalId: message.goal_id,
          taskId: message.task_id,
          patchText: patch.patchText,
          changedFiles: patch.changedFiles
        });
        await repo.appendRunLog(
          runId,
          "stdout",
          `Dionysus patch queued: ${queuedPatch.id}\nchanged_files=${patch.changedFiles.join(",")}`,
          3
        );
      } else {
        await repo.recordTaskEvent(message.task_id, "patch.skipped_empty", {
          workspacePath: workspace.workspacePath
        });
      }
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
  } catch (error) {
    const messageText = error instanceof Error ? error.stack ?? error.message : String(error);
    await repo.appendRunLog(runId, "stderr", messageText, 99);
    await repo.completeTaskRun({ taskId: message.task_id, runId, exitCode: 1 });
    await publishJson(integrationQueue, {
      message_id: randomUUID(),
      goal_id: message.goal_id,
      task_id: message.task_id,
      type: "worker_failed",
      attempt: message.attempt,
      idempotency_key: `${message.task_id}:integration:${message.attempt}:failed`,
      created_at: new Date().toISOString()
    });
  }
}

function parseWorkerCliType(value: string | undefined): CliType {
  if (value === "claude_code" || value === "gemini_cli" || value === "opencode" || value === "mock") {
    return value;
  }
  return "mock";
}

console.log(`Dionysus worker consuming ${workerQueue} with ${workerCliType}; workspaceRoot=${workspaceRoot}`);
await consumeJson(workerQueue, handleWorkerTask);
