import "dotenv/config";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { AgentRole, CliType, Goal, RolePromptTask, RolePromptTaskEvent } from "@dionysus/core";
import {
  applyPatchToTarget,
  buildAddFilesPatch,
  buildCodexOutboxDraft,
  buildPreflightRemediation,
  buildTargetPreflight,
  buildRolePrompt,
  buildMasterTaskTree,
  checkGitPreflight,
  checkSpecTestGate,
  createIsolatedWorkspace,
  createPatch as createWorkspacePatch,
  decidePostRunDispatch,
  decideMasterStep,
  evaluateWatchdogTask,
  mergeIntegrationVerificationCommands,
  parseCliUsageReceipt,
  resolveAgentRunConfig,
  evaluateReportOnlyReviewerOutputGate,
  shouldDispatchAfterIntegration,
  decideTargetMutationHandling,
  queueForRole,
  validateAgentRunIsolation
} from "@dionysus/core";
import { createCliAdapter, MockAdapter } from "@dionysus/cli-adapters";
import { createPool, DionysusRepository, loadDatabaseConfig } from "@dionysus/db";
import { consumeJson, publishJson, type QueueConsumer, type QueueMessage } from "@dionysus/mq";
import { parseAllowedFileScope } from "./allowed-scope.js";
import { targetRootForGoal } from "./target-root.js";

const workerQueue = "dionysus.worker";
const masterQueue = "dionysus.master";
const ruleWriterQueue = "dionysus.rule_writer";
const testWriterQueue = "dionysus.test_writer";
const integrationQueue = "dionysus.integration";
const watchdogQueue = "dionysus.watchdog";
const masterControlQueue = "dionysus.master_control";
const workerCliType = parseWorkerCliType(process.env.DIONYSUS_WORKER_CLI_TYPE);
const workerCliModel = process.env.DIONYSUS_WORKER_CLI_MODEL || undefined;
const agentRunTimeoutMs = parsePositiveInteger(process.env.DIONYSUS_AGENT_RUN_TIMEOUT_MS, 20 * 60 * 1000);
const targetRoot = process.env.TARGET_COUPON_ROOT ?? process.cwd();
const workspaceRoot = process.env.DIONYSUS_WORKSPACE_ROOT ?? resolve(process.cwd(), "../../.dionysus/workspaces");
const integrationVerificationCommands = readCommandList(process.env.DIONYSUS_INTEGRATION_VERIFY_COMMANDS);
const protectedFiles = readCommandList(process.env.DIONYSUS_PROTECTED_FILES);
const allowProtectedFiles = readCommandList(process.env.DIONYSUS_ALLOW_PROTECTED_FILES);
const watchdogIntervalSeconds = parsePositiveInteger(process.env.DIONYSUS_WATCHDOG_INTERVAL_SECONDS, 60);
const watchdogRunningTimeoutMinutes = parsePositiveInteger(process.env.DIONYSUS_WATCHDOG_RUNNING_TIMEOUT_MINUTES, 15);
const masterControlIntervalSeconds = parsePositiveInteger(process.env.DIONYSUS_MASTER_CONTROL_INTERVAL_SECONDS, 120);
const masterControlGoalLimit = parsePositiveInteger(process.env.DIONYSUS_MASTER_CONTROL_GOAL_LIMIT, 1);
const workerHeartbeatIntervalSeconds = parsePositiveInteger(process.env.DIONYSUS_WORKER_HEARTBEAT_INTERVAL_SECONDS, 30);
const dbConfig = loadDatabaseConfig();
const pool = createPool(dbConfig);
const repo = new DionysusRepository(pool, dbConfig.schema);
const execFileAsync = promisify(execFile);
const runtimeInstanceId = randomUUID();
const runtimeStartedAt = new Date().toISOString();
const codeCommitSha = await readDionysusCodeCommitSha();

async function handleWorkerTask(message: QueueMessage): Promise<void> {
  if (!message.task_id) {
    throw new Error("worker task requires task_id");
  }

  const taskContext = await loadTaskContext(message.task_id);
  const taskTargetRoot = targetRootForGoal(taskContext.goal, targetRoot);
  const roleConfig = await repo.getAgentCliConfig("worker");
  const runConfig = resolveAgentRunConfig({
    role: "worker",
    roleConfig,
    fallback: {
      cliType: workerCliType,
      cliModel: workerCliModel
    }
  });
  const roleAdapter = runConfig.cliType === "mock"
    ? new MockAdapter()
    : createCliAdapter({ cliType: runConfig.cliType, model: runConfig.cliModel, timeoutMs: agentRunTimeoutMs });
  let runId: string | null = null;

  try {
    const workspace = await createIsolatedWorkspace({
      targetRoot: taskTargetRoot,
      workspaceRoot,
      taskId: message.task_id
    });
    await repo.recordTaskEvent(message.task_id, "workspace.created", {
      workspacePath: workspace.workspacePath,
      source: "hidden",
      syncedTargetChanges: workspace.syncedTargetChanges
    });
    const prompt = buildRolePrompt({
      role: "worker",
      task: taskContext.task,
      goal: taskContext.goal,
      taskEvents: taskContext.taskEvents,
      workspacePath: workspace.workspacePath,
      workspaceSyncedTargetChanges: workspace.syncedTargetChanges
    });
    const isolationDecision = await validateWorkspaceAgentIsolation({
      taskId: message.task_id,
      role: "worker",
      cliType: runConfig.cliType,
      prompt,
      cwd: workspace.workspacePath,
      targetRoot: taskTargetRoot,
      workspacePath: workspace.workspacePath
    });
    if (!isolationDecision.allowed) {
      return;
    }
    runId = await repo.createTaskRun({
      taskId: message.task_id,
      cliType: runConfig.cliType,
      cliModel: runConfig.cliModel,
      command: `${runConfig.cliType}.run`,
      prompt
    });
    if (!runId) {
      await repo.recordTaskEvent(message.task_id, "task.run_skipped_already_active", {
        messageId: message.message_id,
        attempt: message.attempt
      });
      return;
    }
    const activeRunId = runId;
    const targetMutationBaselineAt = new Date();
    const targetStatusBefore = await readGitStatus(taskTargetRoot);

    let logSequence = 1;
    let streamedLogs = false;
    const pendingLogWrites: Array<Promise<void>> = [];
    const result = await roleAdapter.run({
      taskId: message.task_id,
      prompt,
      cwd: workspace.workspacePath,
      targetRoot: taskTargetRoot,
      workspacePath: workspace.workspacePath,
      onOutput: (stream, chunkText) => {
        streamedLogs = true;
        pendingLogWrites.push(repo.appendRunLog(activeRunId, stream, chunkText, logSequence++));
      }
    });
    await Promise.all(pendingLogWrites);

    if (!streamedLogs && result.stdout) {
      await repo.appendRunLog(runId, "stdout", result.stdout, 1);
    }
    if (!streamedLogs && result.stderr) {
      await repo.appendRunLog(runId, "stderr", result.stderr, 2);
    }
    const targetMutation = await detectTargetRootMutation(taskTargetRoot, targetStatusBefore);
    if (targetMutation.mutated) {
      const handling = await decideTargetMutationHandlingForGoal({
        goalId: message.goal_id,
        currentTaskId: message.task_id,
        runStartedAt: targetMutationBaselineAt
      });
      await repo.appendRunLog(
        runId,
        "stderr",
        `Target root changed during run (${handling.severity}): ${handling.reason}.\nBefore:\n${targetMutation.before || "(clean)"}\nAfter:\n${targetMutation.after || "(clean)"}`,
        98
      );
      await repo.recordTaskEvent(message.task_id, handling.eventType, {
        targetRoot: taskTargetRoot,
        before: targetMutation.before,
        after: targetMutation.after,
        goalId: message.goal_id,
        reason: handling.reason,
        severity: handling.severity
      });
      if (handling.action === "block") {
        const usageReceipt = parseCliUsageReceipt(`${result.stdout}\n${result.stderr}`);
        await repo.completeTaskRun({
          taskId: message.task_id,
          runId,
          exitCode: 1,
          modelCallCount: usageReceipt?.modelCalls,
          modelUsageJson: usageReceipt?.raw
        });
        await repo.markTaskBlocked({
          taskId: message.task_id,
          reason: handling.reason
        });
        return;
      }
    }

    let effectiveExitCode = result.exitCode;
    const reviewerOutputGate = evaluateReportOnlyReviewerOutputGate({
      taskTitle: taskContext.task.title,
      taskDescription: taskContext.task.description,
      output: `${result.stdout}\n${result.stderr}`
    });
    if (result.exitCode === 0 && !reviewerOutputGate.allowed) {
      effectiveExitCode = 1;
      await repo.appendRunLog(
        runId,
        "stderr",
        `Dionysus reviewer output gate failed: ${reviewerOutputGate.reason}`,
        97
      );
      await repo.recordTaskEvent(message.task_id, "reviewer.output_gate_failed", {
        reason: reviewerOutputGate.reason,
        missingFields: reviewerOutputGate.missingFields ?? [],
        requiredAction: "ReviewerCLI must return the required structured Verdict/Score/Evidence/Coverage/Required fixes/Codex handoff report before Dionysus can mark it reviewable."
      });
    }

    let queuedPatchId: string | null = null;
    if (effectiveExitCode === 0 && message.goal_id) {
      const patch = await createWorkspacePatch({ workspacePath: workspace.workspacePath });
      if (patch.patchText.trim().length > 0) {
        const allowedFiles = parseAllowedFileScope(taskContext.task.description);
        const queuedPatch = await repo.createPatch({
          goalId: message.goal_id,
          taskId: message.task_id,
          patchText: patch.patchText,
          changedFiles: patch.changedFiles,
          allowedFiles
        });
        queuedPatchId = queuedPatch.id;
        await repo.appendRunLog(
          runId,
          "stdout",
          `Dionysus patch queued: ${queuedPatch.id}\nchanged_files=${patch.changedFiles.join(",")}\nallowed_files=${allowedFiles.join(",")}`,
          3
        );
      } else {
        await repo.recordTaskEvent(message.task_id, "patch.skipped_empty", {
          workspacePath: workspace.workspacePath
        });
      }
    }

    const usageReceipt = parseCliUsageReceipt(`${result.stdout}\n${result.stderr}`);
    await repo.completeTaskRun({
      taskId: message.task_id,
      runId,
      exitCode: effectiveExitCode,
      modelCallCount: usageReceipt?.modelCalls,
      modelUsageJson: usageReceipt?.raw
    });
    const dispatchDecision = decidePostRunDispatch({ exitCode: effectiveExitCode, queuedPatchId });
    if (dispatchDecision.action === "dispatch_next") {
      await dispatchNextTask(message.task_id);
    } else if (dispatchDecision.action === "wait_for_integration") {
      await repo.recordTaskEvent(message.task_id, "dispatch.waiting_for_integration", {
        patchId: dispatchDecision.patchId,
        reason: dispatchDecision.reason
      });
    } else if (dispatchDecision.action === "wait_for_review") {
      await repo.recordTaskEvent(message.task_id, "dispatch.waiting_for_review", {
        reason: dispatchDecision.reason
      });
    }

    await publishJson(integrationQueue, {
      message_id: randomUUID(),
      goal_id: message.goal_id,
      task_id: message.task_id,
      type: effectiveExitCode === 0 ? "worker_completed" : "worker_failed",
      attempt: message.attempt,
      idempotency_key: `${message.task_id}:integration:${message.attempt}`,
      created_at: new Date().toISOString()
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.stack ?? error.message : String(error);
    if (runId) {
      await repo.appendRunLog(runId, "stderr", messageText, 99);
      await repo.completeTaskRun({ taskId: message.task_id, runId, exitCode: 1 });
    } else {
      await repo.recordTaskEvent(message.task_id, "worker.failed_before_run", {
        reason: messageText,
        targetRoot: taskTargetRoot
      });
    }
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

async function handleGovernanceTask(message: QueueMessage, roleName: string): Promise<void> {
  if (!message.task_id) {
    throw new Error(`${roleName} task requires task_id`);
  }
  const role = roleName as AgentRole;
  const taskContext = await loadTaskContext(message.task_id);
  const taskTargetRoot = targetRootForGoal(taskContext.goal, targetRoot);
  let cwd = taskTargetRoot;
  let workspacePath: string | undefined;
  let workspaceSyncedTargetChanges = false;
  if (role !== "master") {
    const workspace = await createIsolatedWorkspace({
      targetRoot: taskTargetRoot,
      workspaceRoot,
      taskId: message.task_id
    });
    cwd = workspace.workspacePath;
    workspacePath = workspace.workspacePath;
    workspaceSyncedTargetChanges = workspace.syncedTargetChanges;
    await repo.recordTaskEvent(message.task_id, "workspace.created", {
      workspacePath: workspace.workspacePath,
      source: "hidden",
      role,
      syncedTargetChanges: workspace.syncedTargetChanges
    });
  }
  const prompt = buildRolePrompt({
    role,
    task: taskContext.task,
    goal: taskContext.goal,
    taskEvents: taskContext.taskEvents,
    workspacePath,
    workspaceSyncedTargetChanges
  });
  const roleConfig = await repo.getAgentCliConfig(role);
  const runConfig = resolveAgentRunConfig({
    role,
    roleConfig,
    fallback: {
      cliType: workerCliType,
      cliModel: workerCliModel
    }
  });
  const isolationDecision = await validateWorkspaceAgentIsolation({
    taskId: message.task_id,
    role,
    cliType: runConfig.cliType,
    prompt,
    cwd,
    targetRoot: taskTargetRoot,
    workspacePath
  });
  if (!isolationDecision.allowed) {
    return;
  }
  const roleAdapter = runConfig.cliType === "mock"
    ? new MockAdapter()
    : createCliAdapter({ cliType: runConfig.cliType, model: runConfig.cliModel, timeoutMs: agentRunTimeoutMs });
  const runId = await repo.createTaskRun({
    taskId: message.task_id,
    cliType: runConfig.cliType,
    cliModel: runConfig.cliModel,
    command: `${roleName}.governance`,
    prompt
  });
  if (!runId) {
    await repo.recordTaskEvent(message.task_id, "task.run_skipped_already_active", {
      messageId: message.message_id,
      attempt: message.attempt,
      role
    });
    return;
  }
  const activeRunId = runId;
  const targetMutationBaselineAt = new Date();
  const targetStatusBefore = await readGitStatus(taskTargetRoot);
  let logSequence = 1;
  let streamedLogs = false;
  const pendingLogWrites: Array<Promise<void>> = [];
  const result = await roleAdapter.run({
    taskId: message.task_id,
    prompt,
    cwd,
    targetRoot: role === "master" ? undefined : taskTargetRoot,
    workspacePath,
    onOutput: (stream, chunkText) => {
      streamedLogs = true;
      pendingLogWrites.push(repo.appendRunLog(activeRunId, stream, chunkText, logSequence++));
    }
  });
  await Promise.all(pendingLogWrites);
  if (!streamedLogs && result.stdout) {
    await repo.appendRunLog(runId, "stdout", result.stdout, 1);
  }
  if (!streamedLogs && result.stderr) {
    await repo.appendRunLog(runId, "stderr", result.stderr, 2);
  }
  const targetMutation = await detectTargetRootMutation(taskTargetRoot, targetStatusBefore);
  if (targetMutation.mutated) {
    const handling = await decideTargetMutationHandlingForGoal({
      goalId: message.goal_id,
      currentTaskId: message.task_id,
      runStartedAt: targetMutationBaselineAt
    });
    await repo.appendRunLog(
      runId,
      "stderr",
      `Target root changed during run (${handling.severity}): ${handling.reason}.\nBefore:\n${targetMutation.before || "(clean)"}\nAfter:\n${targetMutation.after || "(clean)"}`,
      98
    );
    await repo.recordTaskEvent(message.task_id, handling.eventType, {
      targetRoot: taskTargetRoot,
      before: targetMutation.before,
      after: targetMutation.after,
      goalId: message.goal_id,
      role,
      reason: handling.reason,
      severity: handling.severity
    });
    if (handling.action === "block") {
      const usageReceipt = parseCliUsageReceipt(`${result.stdout}\n${result.stderr}`);
      await repo.completeTaskRun({
        taskId: message.task_id,
        runId,
        exitCode: 1,
        modelCallCount: usageReceipt?.modelCalls,
        modelUsageJson: usageReceipt?.raw
      });
      await repo.markTaskBlocked({
        taskId: message.task_id,
        reason: handling.reason
      });
      return;
    }
  }
  await repo.recordTaskEvent(message.task_id, result.exitCode === 0 ? `${roleName}.completed` : `${roleName}.failed`, {
    messageId: message.message_id,
    cliType: runConfig.cliType,
    cliModel: runConfig.cliModel,
    next: roleName === "master" ? "review task tree or dispatch next role" : "return to master"
  });
  let queuedPatchId: string | null = null;
  if (result.exitCode === 0 && role !== "master" && workspacePath && message.goal_id) {
    const patch = await createWorkspacePatch({ workspacePath });
    if (patch.patchText.trim().length > 0) {
      const allowedFiles = parseAllowedFileScope(taskContext.task.description);
      const queuedPatch = await repo.createPatch({
        goalId: message.goal_id,
        taskId: message.task_id,
        patchText: patch.patchText,
        changedFiles: patch.changedFiles,
        allowedFiles
      });
      queuedPatchId = queuedPatch.id;
      await repo.appendRunLog(
        runId,
        "stdout",
        `Dionysus governance patch queued: ${queuedPatch.id}\nchanged_files=${patch.changedFiles.join(",")}\nallowed_files=${allowedFiles.join(",")}`,
        3
      );
    } else {
      await repo.recordTaskEvent(message.task_id, "patch.skipped_empty", {
        workspacePath,
        role
      });
    }
  }
  const usageReceipt = parseCliUsageReceipt(`${result.stdout}\n${result.stderr}`);
  await repo.completeTaskRun({
    taskId: message.task_id,
    runId,
    exitCode: result.exitCode,
    modelCallCount: usageReceipt?.modelCalls,
    modelUsageJson: usageReceipt?.raw
  });
  const dispatchDecision = decidePostRunDispatch({ exitCode: result.exitCode, queuedPatchId });
  if (dispatchDecision.action === "dispatch_next") {
    await dispatchNextTask(message.task_id);
  } else if (dispatchDecision.action === "wait_for_integration") {
    await repo.recordTaskEvent(message.task_id, "dispatch.waiting_for_integration", {
      patchId: dispatchDecision.patchId,
      reason: dispatchDecision.reason
    });
  } else if (dispatchDecision.action === "wait_for_review") {
    await repo.recordTaskEvent(message.task_id, "dispatch.waiting_for_review", {
      reason: dispatchDecision.reason
    });
  }
}

async function validateWorkspaceAgentIsolation(input: {
  taskId: string;
  role: AgentRole;
  cliType: CliType;
  prompt: string;
  cwd: string;
  targetRoot: string;
  workspacePath?: string;
}): Promise<{ allowed: boolean; reasons: string[] }> {
  const workspaceMarker = input.workspacePath ? await readWorkspaceMarker(input.workspacePath) : undefined;
  const decision = validateAgentRunIsolation({
    role: input.role,
    cliType: input.cliType,
    prompt: input.prompt,
    cwd: input.cwd,
    targetRoot: input.targetRoot,
    workspacePath: input.workspacePath,
    workspaceMarker
  });
  if (decision.allowed) {
    return decision;
  }

  const reason = `Dionysus isolation blocked ${input.role} ${input.cliType} run: ${decision.reasons.join("; ")}`;
  await repo.recordTaskEvent(input.taskId, "agent_run_isolation_blocked", {
    role: input.role,
    cliType: input.cliType,
    reasons: decision.reasons
  });
  await repo.markTaskBlocked({ taskId: input.taskId, reason });
  return decision;
}

async function readWorkspaceMarker(workspacePath: string): Promise<string | undefined> {
  try {
    return await readFile(join(workspacePath, ".dionysus-workspace"), "utf8");
  } catch {
    return undefined;
  }
}

async function readGitStatus(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
    return normalizeGitStatus(stdout);
  } catch (error) {
    return `GIT_STATUS_FAILED: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function detectTargetRootMutation(
  targetRootPath: string,
  before: string
): Promise<{ mutated: boolean; before: string; after: string }> {
  const after = await readGitStatus(targetRootPath);
  return {
    mutated: before !== after,
    before,
    after
  };
}

async function decideTargetMutationHandlingForGoal(input: {
  goalId?: string;
  currentTaskId: string;
  runStartedAt: Date;
}) {
  if (!input.goalId) {
    return decideTargetMutationHandling({
      currentTaskId: input.currentTaskId,
      runStartedAt: input.runStartedAt,
      integrations: []
    });
  }
  const integrations = await repo.listIntegrations(input.goalId);
  return decideTargetMutationHandling({
    currentTaskId: input.currentTaskId,
    runStartedAt: input.runStartedAt,
    integrations: integrations.map((integration) => ({
      taskId: typeof integration.taskId === "string" ? integration.taskId : undefined,
      status: String(integration.status),
      updatedAt: String(integration.updatedAt)
    }))
  });
}

function normalizeGitStatus(status: string): string {
  return status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .sort()
    .join("\n");
}

async function handleIntegrationTask(message: QueueMessage): Promise<void> {
  if (!message.task_id) {
    throw new Error("integration task requires task_id");
  }
  const integration = await repo.getQueuedIntegrationForTask(message.task_id);
  if (!integration) {
    await repo.recordTaskEvent(message.task_id, "integration.skipped_missing_patch", {
      messageId: message.message_id
    });
    return;
  }

  await repo.markIntegrationRunning(integration.id);
  const goal = await repo.getGoal(integration.goalId);
  const verificationCommands = mergeIntegrationVerificationCommands({
    changedFiles: integration.changedFiles,
    configuredCommands: integrationVerificationCommands
  });
  const result = await applyPatchToTarget({
    targetRoot: targetRootForGoal(goal, targetRoot),
    patchText: integration.patchText,
    verificationCommands,
    requireVerification: true,
    allowedChangedFiles: integration.allowedFiles,
    protectedFiles,
    allowProtectedFiles
  });
  await repo.completeIntegration({
    integrationId: integration.id,
    patchId: integration.patchId,
    taskId: integration.taskId,
    status: result.status === "applied" ? "passed" : "failed",
    result: {
      applyStatus: result.status,
      changedFiles: result.changedFiles,
      allowedFiles: integration.allowedFiles,
      reason: result.reason,
      testStatus: result.status === "applied" ? (verificationCommands.length ? "passed" : "missing") : "blocked",
      verificationCommands
    }
  });
  if (shouldDispatchAfterIntegration({ applyStatus: result.status })) {
    await dispatchNextTask(integration.taskId);
  } else if (result.status === "applied") {
    await repo.recordTaskEvent(integration.taskId, "integration.awaiting_task_review", {
      integrationId: integration.id,
      patchId: integration.patchId,
      reason: "patch applied; task review must approve before dispatching next task"
    });
  } else {
    await repo.createCodexOutboxEvent(buildCodexOutboxDraft({
      goalId: integration.goalId,
      eventType: "blocker",
      reason: `integration failed for task ${integration.taskId}: ${result.reason ?? result.status}`,
      source: "integration.worker",
      payload: {
        taskId: integration.taskId,
        integrationId: integration.id,
        patchId: integration.patchId,
        applyStatus: result.status,
        reason: result.reason
      }
    }));
  }
}

async function handleWatchdogTask(message: QueueMessage): Promise<void> {
  const now = new Date();
  const runningTimeoutMs = watchdogRunningTimeoutMinutes * 60 * 1000;
  const runningUpdatedBefore = new Date(now.getTime() - runningTimeoutMs).toISOString();
  const candidates = await repo.listWatchdogCandidates({
    runningUpdatedBefore,
    limit: 100
  });
  let retried = 0;
  let blocked = 0;
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
      retried += 1;
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
      blocked += 1;
    }
  }
  await repo.recordSystemEvent("watchdog.run", {
    messageId: message.message_id,
    checked: candidates.length,
    retried,
    blocked
  });
}

async function handleMasterControlTask(message: QueueMessage): Promise<void> {
  const goals = message.goal_id
    ? [await repo.getGoal(message.goal_id)]
    : await repo.listActiveGoals(masterControlGoalLimit);
  let stepped = 0;
  for (const goal of goals) {
    if (!goal) continue;
    await runMasterStepForGoal(goal, message);
    stepped += 1;
  }
  await repo.recordSystemEvent("master_control.run", {
    messageId: message.message_id,
    goalId: message.goal_id,
    stepped
  });
}

async function runMasterStepForGoal(goal: Goal, message: QueueMessage): Promise<void> {
  const [git, gates, tasks, queuedIntegrations] = await Promise.all([
    checkGitPreflight(goal.targetRoot),
    checkSpecTestGate(goal.targetRoot),
    repo.listTasks(goal.id),
    repo.listQueuedIntegrations(goal.id)
  ]);
  await repo.saveGateChecks({ goalId: goal.id, checks: gates });
  const preflight = buildTargetPreflight({ git, gates });
  const decision = decideMasterStep({
    bootstrapTaskCount: countBootstrapTasks(tasks),
    queuedIntegrationCount: queuedIntegrations.length,
    preflight
  });

  if (decision.action === "bootstrap_tasks") {
    const drafts = buildMasterTaskTree({ goalTitle: goal.title, targetRoot: goal.targetRoot });
    const createdTasks = [];
    for (const draft of drafts) {
      createdTasks.push(
        await repo.createTask({
          goalId: goal.id,
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
        goal_id: goal.id,
        task_id: firstMaster.id,
        type: "master_task",
        attempt: 1,
        idempotency_key: `${firstMaster.id}:master-control:1`,
        created_at: new Date().toISOString()
      });
      firstMaster.status = "queued";
    }
    await repo.recordSystemEvent("master_control.step", {
      messageId: message.message_id,
      goalId: goal.id,
      decision,
      createdTasks
    });
    return;
  }

  if (decision.action === "queue_preflight_remediation") {
    const files = buildPreflightRemediation({ goal, gates });
    if (!files.length) {
      await repo.recordSystemEvent("master_control.step", {
        messageId: message.message_id,
        goalId: goal.id,
        decision: { action: "ready_for_implementation", reason: "no remediation files needed" }
      });
      return;
    }
    const task = await repo.createTask({
      goalId: goal.id,
      title: "[Master] Queue preflight remediation patch",
      description: "Dionysus generated missing PLAN/specs/features_test remediation files as a patch for integration.",
      roleRequired: "master",
      priority: 5
    });
    const patch = await repo.createPatch({
      goalId: goal.id,
      taskId: task.id,
      patchText: buildAddFilesPatch(files),
      changedFiles: files.map((file) => file.path),
      allowedFiles: files.map((file) => file.path)
    });
    const integrationPublished = git.clean;
    if (integrationPublished) {
      await publishJson(integrationQueue, {
        message_id: randomUUID(),
        goal_id: goal.id,
        task_id: task.id,
        type: "preflight_remediation_patch",
        attempt: 1,
        idempotency_key: `${task.id}:master-control-preflight-remediation:1`,
        created_at: new Date().toISOString()
      });
    }
    await repo.recordSystemEvent("master_control.step", {
      messageId: message.message_id,
      goalId: goal.id,
      decision,
      taskId: task.id,
      patchId: patch.id,
      integrationPublished,
      blockers: git.clean ? [] : [`git worktree dirty: ${git.changes.length} changes`]
    });
    return;
  }

  if (decision.action === "release_queued_integrations") {
    for (const integration of queuedIntegrations) {
      await publishJson(integrationQueue, {
        message_id: randomUUID(),
        goal_id: goal.id,
        task_id: integration.taskId,
        type: "master_control_release_integration",
        attempt: 1,
        idempotency_key: `${integration.taskId}:master-control-release:${integration.id}`,
        created_at: new Date().toISOString()
      });
    }
  }

  await repo.recordSystemEvent("master_control.step", {
    messageId: message.message_id,
    goalId: goal.id,
    decision,
    queuedIntegrationCount: queuedIntegrations.length,
    blockers: preflight.blockers
  });
}

async function dispatchNextTask(completedTaskId: string): Promise<void> {
  const completedTask = await repo.getTask(completedTaskId);
  if (!completedTask) return;
  const goalId = String(completedTask.goal_id);
  const priority = Number(completedTask.priority);
  const nextTask = await repo.findNextCreatedTask({ goalId, afterPriority: priority });
  if (!nextTask) {
    await repo.recordTaskEvent(completedTaskId, "dispatch.no_next_task", { goalId });
    return;
  }
  await repo.markTaskQueued(nextTask.id);
  await publishJson(queueForRole(nextTask.roleRequired), {
    message_id: randomUUID(),
    goal_id: goalId,
    task_id: nextTask.id,
    type: `${nextTask.roleRequired}_task`,
    attempt: 1,
    idempotency_key: `${nextTask.id}:${nextTask.roleRequired}:1`,
    created_at: new Date().toISOString()
  });
  await repo.recordTaskEvent(completedTaskId, "dispatch.next_task", {
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

async function loadTaskContext(taskId: string): Promise<{ task: RolePromptTask; goal: Goal | null; taskEvents: RolePromptTaskEvent[] }> {
  const row = await repo.getTask(taskId);
  if (!row) {
    throw new Error(`task not found: ${taskId}`);
  }
  const goalId = String(row.goal_id);
  return {
    task: {
      id: String(row.id),
      title: String(row.title),
      description: String(row.description),
      roleRequired: row.role_required as AgentRole
    },
    goal: await repo.getGoal(goalId),
    taskEvents: await repo.listRecentTaskEvents(taskId, 10)
  };
}

function parseWorkerCliType(value: string | undefined): CliType {
  if (value === "claude_code" || value === "gemini_cli" || value === "opencode" || value === "mock") {
    return value;
  }
  return "mock";
}

function readCommandList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/\r?\n|&&/)
    .map((command) => command.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function startWatchdogScheduler(): NodeJS.Timeout {
  return setInterval(() => {
    publishJson(watchdogQueue, {
      message_id: randomUUID(),
      type: "watchdog_tick",
      attempt: 1,
      idempotency_key: `watchdog:${Date.now()}`,
      created_at: new Date().toISOString()
    }).catch((error: unknown) => {
      console.error("failed to enqueue watchdog tick", error);
    });
  }, watchdogIntervalSeconds * 1000);
}

function startMasterControlScheduler(): NodeJS.Timeout {
  return setInterval(() => {
    publishJson(masterControlQueue, {
      message_id: randomUUID(),
      type: "master_control_tick",
      attempt: 1,
      idempotency_key: `master-control:${Date.now()}`,
      created_at: new Date().toISOString()
    }).catch((error: unknown) => {
      console.error("failed to enqueue master control tick", error);
    });
  }, masterControlIntervalSeconds * 1000);
}

function startWorkerHeartbeatScheduler(): NodeJS.Timeout {
  return setInterval(() => {
    repo.recordSystemEvent("worker.heartbeat", {
      pid: process.pid,
      runtimeInstanceId,
      runtimeStartedAt,
      codeCommitSha,
      workerCliType,
      workerCliModel,
      workspaceRoot,
      heartbeatIntervalSeconds: workerHeartbeatIntervalSeconds
    }).catch((error: unknown) => {
      console.error("failed to record worker heartbeat", error);
    });
  }, workerHeartbeatIntervalSeconds * 1000);
}

console.log(
  `Dionysus worker consuming role queues, ${integrationQueue}, ${watchdogQueue}, ${masterControlQueue} with ${workerCliType}; workspaceRoot=${workspaceRoot}; agentRunTimeoutMs=${agentRunTimeoutMs}; watchdog=${watchdogIntervalSeconds}s; masterControl=${masterControlIntervalSeconds}s; masterControlGoalLimit=${masterControlGoalLimit}; heartbeat=${workerHeartbeatIntervalSeconds}s`
);
await repo.recordSystemEvent("worker.started", {
  pid: process.pid,
  runtimeInstanceId,
  runtimeStartedAt,
  codeCommitSha,
  workerCliType,
  workerCliModel,
  workspaceRoot,
  protectedFiles,
  allowProtectedFiles,
  watchdogIntervalSeconds,
  masterControlIntervalSeconds,
  workerHeartbeatIntervalSeconds
});
process.on("SIGHUP", () => {
  repo.recordSystemEvent("worker.sighup_ignored", { pid: process.pid })
    .catch((error: unknown) => console.error("failed to record ignored SIGHUP", error));
});

async function readDionysusCodeCommitSha(): Promise<string | undefined> {
  const repoRoot = resolve(process.cwd(), "../..");
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, timeout: 10_000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}
const scheduledTimers = [
  startWorkerHeartbeatScheduler(),
  startWatchdogScheduler(),
  startMasterControlScheduler()
];
const consumers = await Promise.all([
  consumeJson(masterQueue, (message) => handleGovernanceTask(message, "master")),
  consumeJson(ruleWriterQueue, (message) => handleGovernanceTask(message, "rule_writer")),
  consumeJson(testWriterQueue, (message) => handleGovernanceTask(message, "test_writer")),
  consumeJson(workerQueue, handleWorkerTask),
  consumeJson(integrationQueue, handleIntegrationTask),
  consumeJson(watchdogQueue, handleWatchdogTask),
  consumeJson(masterControlQueue, handleMasterControlTask)
]);
await waitForShutdown(consumers);

async function waitForShutdown(consumers: QueueConsumer[]): Promise<void> {
  await new Promise<void>((resolve) => {
    const shutdown = (signal: NodeJS.Signals) => {
      repo.recordSystemEvent("worker.stopping", { pid: process.pid, signal })
        .catch((error: unknown) => console.error("failed to record worker stopping", error))
        .finally(resolve);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
  scheduledTimers.forEach((timer) => clearInterval(timer));
  await Promise.all(consumers.map((consumer) => consumer.close()));
  await repo.recordSystemEvent("worker.stopped", { pid: process.pid });
  await pool.end();
}
