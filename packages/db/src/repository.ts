import { randomUUID } from "node:crypto";
import {
  buildAgentCliUsageSummary,
  codexCompletableTaskStatuses,
  deriveGoalStatusAfterRelease,
  deriveTaskStatusAfterRunCompletion,
  normalizeAgentCliConfig,
  selectAgentForRun,
  shouldCloseOutstandingWorkAfterRelease,
  shouldReconcileCodexOutboxForGoalStatus,
  shouldReconcileCodexOutboxForTaskStatus,
  taskRunStatusForCodexCompletion
} from "@dionysus/core";
import type {
  AgentCliConfig,
  AgentCliUsageSummary,
  AgentRecord,
  AgentRole,
  CodexOutboxDraft,
  CodexOutboxEvent,
  CodexOutboxEventType,
  CodexOutboxStatus,
  CliType,
  E2ECampaignStatus,
  E2ECaseStatus,
  FlowEdge,
  FlowNode,
  Goal,
  MilestoneStatus,
  NotificationChannelType,
  ReleaseRecord,
  ReleaseRecordStatus,
  ReleaseVerificationRecord,
  TaskStatus
} from "@dionysus/core";
import type pg from "pg";
import { quoteIdent } from "./connection.js";
import type {
  BuildGraphEdgeDraft,
  BuildGraphNodeDraft,
  CompiledDocument,
  DocumentFinding,
  GateCheckResult
} from "@dionysus/core";
import {
  buildE2ECampaignDraft,
  deriveE2ECampaignStatus,
  detectMilestoneCandidate,
  evaluateMilestoneVerdictGate,
  milestoneStatusForCodexVerdict
} from "@dionysus/core";
import type { CliProbeResult } from "@dionysus/cli-adapters";

export class DionysusRepository {
  constructor(
    private readonly pool: pg.Pool,
    private readonly schema = process.env.DATABASE_SCHEMA ?? "dionysus"
  ) {}

  async createGoal(input: { title: string; description: string; targetRoot: string }): Promise<Goal> {
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `insert into ${this.table("goals")}
          (id, title, description, target_root, status)
         values ($1, $2, $3, $4, 'created')
         returning id, title, description, target_root, status, created_at, updated_at`,
        [id, input.title, input.description, input.targetRoot]
      );
      await client.query(
        `insert into ${this.table("system_events")} (id, event_type, payload_json)
         values ($1, $2, $3)`,
        [randomUUID(), "goal.created", JSON.stringify({ goalId: id, title: input.title })]
      );
      await client.query("commit");
      return mapGoal(result.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getGoal(id: string): Promise<Goal | null> {
    const result = await this.pool.query(
      `select id, title, description, target_root, status, created_at, updated_at
       from ${this.table("goals")}
       where id = $1`,
      [id]
    );
    return result.rowCount ? mapGoal(result.rows[0]) : null;
  }

  async listGoals(limit = 20): Promise<Goal[]> {
    const result = await this.pool.query(
      `select id, title, description, target_root, status, created_at, updated_at
       from ${this.table("goals")}
       order by created_at desc
       limit $1`,
      [limit]
    );
    return result.rows.map(mapGoal);
  }

  async listActiveGoals(limit = 20): Promise<Goal[]> {
    const result = await this.pool.query(
      `select id, title, description, target_root, status, created_at, updated_at
       from ${this.table("goals")}
       where status not in ('done', 'failed', 'cancelled', 'fast_lane')
       order by updated_at desc, created_at desc
       limit $1`,
      [limit]
    );
    return result.rows.map(mapGoal);
  }

  async markGoalFastLane(input: { goalId: string; reason?: string }): Promise<Goal | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `update ${this.table("goals")}
         set status = 'fast_lane', updated_at = now()
         where id = $1 and status not in ('done', 'failed', 'cancelled')
         returning id, title, description, target_root, status, created_at, updated_at`,
        [input.goalId]
      );
      if (!result.rowCount) {
        await client.query("rollback");
        return null;
      }
      await client.query(
        `insert into ${this.table("system_events")} (id, event_type, payload_json)
         values ($1, $2, $3)`,
        [randomUUID(), "goal.fast_lane_started", JSON.stringify({
          goalId: input.goalId,
          reason: input.reason ?? "started by Codex fast lane"
        })]
      );
      await client.query("commit");
      return mapGoal(result.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelGoal(input: { goalId: string; reason: string }): Promise<Goal | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `update ${this.table("goals")}
         set status = 'cancelled', updated_at = now()
         where id = $1 and status not in ('done', 'failed', 'cancelled')
         returning id, title, description, target_root, status, created_at, updated_at`,
        [input.goalId]
      );
      if (!result.rowCount) {
        await client.query("rollback");
        return null;
      }
      await client.query(
        `update ${this.table("tasks")}
         set status = 'cancelled',
             blocked_reason = $2,
             updated_at = now()
         where goal_id = $1 and status in ('created', 'queued', 'running', 'failed', 'blocked', 'needs_review')`,
        [input.goalId, input.reason]
      );
      await client.query(
        `insert into ${this.table("system_events")} (id, event_type, payload_json)
         values ($1, $2, $3)`,
        [randomUUID(), "goal.cancelled", JSON.stringify({ goalId: input.goalId, reason: input.reason })]
      );
      await client.query("commit");
      return mapGoal(result.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<{ ok: boolean; schema: string; databaseTime: string }> {
    const result = await this.pool.query("select now() as database_time");
    return {
      ok: true,
      schema: this.schema,
      databaseTime: new Date(result.rows[0].database_time).toISOString()
    };
  }

  async createTask(input: {
    goalId: string;
    title: string;
    description: string;
    roleRequired: AgentRole;
    priority?: number;
  }): Promise<{ id: string; status: string }> {
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `insert into ${this.table("tasks")}
          (id, goal_id, title, description, role_required, priority, status)
         values ($1, $2, $3, $4, $5, $6, 'created')
         returning id, status`,
        [id, input.goalId, input.title, input.description, input.roleRequired, input.priority ?? 100]
      );
      await client.query(
        `insert into ${this.table("task_events")} (id, task_id, event_type, payload_json)
         values ($1, $2, $3, $4)`,
        [randomUUID(), id, "task.created", JSON.stringify({ goalId: input.goalId, title: input.title })]
      );
      await client.query("commit");
      return { id: String(result.rows[0].id), status: String(result.rows[0].status) };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertAgentCliConfig(input: {
    role: AgentRole;
    cliType: CliType;
    cliModel?: string;
    enabled?: boolean;
  }): Promise<AgentCliConfig & { enabled: boolean }> {
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `insert into ${this.table("agent_cli_configs")}
          (id, agent_role, cli_type, cli_model, enabled)
         values ($1, $2, $3, $4, $5)
         on conflict (agent_role)
         do update set cli_type = excluded.cli_type,
                       cli_model = excluded.cli_model,
                       enabled = excluded.enabled,
                       updated_at = now()
         returning agent_role, cli_type, cli_model, enabled`,
        [id, input.role, input.cliType, input.cliModel ?? null, input.enabled ?? true]
      );
      await client.query(
        `update ${this.table("agents")}
         set cli_type = $2,
             cli_model = $3,
             updated_at = now()
         where role = $1 and status <> 'disabled'`,
        [input.role, input.cliType, input.cliModel ?? null]
      );
      await client.query("commit");
      const row = result.rows[0];
      return {
        ...normalizeAgentCliConfig({
          role: row.agent_role,
          cliType: row.cli_type,
          cliModel: row.cli_model
        }),
        enabled: Boolean(row.enabled)
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getAgentCliConfig(role: AgentRole): Promise<(AgentCliConfig & { enabled: boolean })> {
    const result = await this.pool.query(
      `select agent_role, cli_type, cli_model, enabled
       from ${this.table("agent_cli_configs")}
       where agent_role = $1 and enabled = true
       order by updated_at desc
       limit 1`,
      [role]
    );
    if (!result.rowCount) {
      return { role, cliType: "mock", cliModel: undefined, enabled: true };
    }
    const row = result.rows[0];
    return {
      ...normalizeAgentCliConfig({
        role: row.agent_role,
        cliType: row.cli_type,
        cliModel: row.cli_model
      }),
      enabled: Boolean(row.enabled)
    };
  }

  async listAgentCliConfigs(): Promise<Array<AgentCliConfig & { enabled: boolean }>> {
    const result = await this.pool.query(
      `select agent_role, cli_type, cli_model, enabled
       from ${this.table("agent_cli_configs")}
       order by agent_role asc`
    );
    return result.rows.map((row) => ({
      ...normalizeAgentCliConfig({
        role: row.agent_role,
        cliType: row.cli_type,
        cliModel: row.cli_model
      }),
      enabled: Boolean(row.enabled)
    }));
  }

  async listAgents(role?: AgentRole): Promise<AgentRecord[]> {
    const params: string[] = [];
    const where = role ? "where role = $1" : "";
    if (role) params.push(role);
    const result = await this.pool.query(
      `select id, name, role, status, cli_type, cli_model, created_at, updated_at
       from ${this.table("agents")}
       ${where}
       order by role asc, name asc`,
      params
    );
    return result.rows.map(mapAgent);
  }

  async listTasks(goalId?: string): Promise<Array<Record<string, unknown>>> {
    const params: string[] = [];
    const where = goalId ? "where goal_id = $1" : "";
    if (goalId) params.push(goalId);
    const result = await this.pool.query(
      `select id, goal_id, title, description, role_required, assigned_agent_id, status, priority,
              blocked_reason, current_attempt, max_attempts, created_at, updated_at
       from ${this.table("tasks")}
       ${where}
       order by priority asc, created_at asc`,
      params
    );
    return result.rows;
  }

  async listTaskRuns(input: {
    goalId?: string;
    limit?: number;
  } = {}): Promise<Array<Record<string, unknown>>> {
    const params: Array<string | number> = [input.limit ?? 50];
    const where = input.goalId ? "where t.goal_id = $2" : "";
    if (input.goalId) params.push(input.goalId);
    const result = await this.pool.query(
      `select tr.id,
              tr.task_id,
              t.goal_id,
              t.title as task_title,
              t.role_required,
              tr.agent_id,
              a.name as agent_name,
              tr.cli_type,
              tr.cli_model,
              tr.command,
              tr.exit_code,
              tr.status,
              tr.started_at,
              tr.finished_at,
              tr.created_at,
              coalesce(logs.preview, '') as log_preview
       from ${this.table("task_runs")} tr
       join ${this.table("tasks")} t on t.id = tr.task_id
       left join ${this.table("agents")} a on a.id = tr.agent_id
       left join lateral (
         select string_agg(l.stream || ': ' || left(l.chunk_text, 240), E'\n' order by l.sequence asc) as preview
         from ${this.table("task_run_logs")} l
         where l.run_id = tr.id
       ) logs on true
       ${where}
       order by tr.created_at desc
       limit $1`,
      params
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      taskId: String(row.task_id),
      goalId: String(row.goal_id),
      taskTitle: String(row.task_title),
      roleRequired: row.role_required as AgentRole,
      agentId: row.agent_id ? String(row.agent_id) : undefined,
      agentName: row.agent_name ? String(row.agent_name) : undefined,
      cliType: String(row.cli_type),
      cliModel: row.cli_model ? String(row.cli_model) : undefined,
      command: String(row.command),
      exitCode: row.exit_code === null ? undefined : Number(row.exit_code),
      status: String(row.status),
      startedAt: row.started_at ? new Date(row.started_at).toISOString() : undefined,
      finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : undefined,
      createdAt: new Date(row.created_at).toISOString(),
      logPreview: String(row.log_preview)
    }));
  }

  async listTaskRunLogs(runId: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.pool.query(
      `select id, run_id, stream, chunk_text, sequence, created_at
       from ${this.table("task_run_logs")}
       where run_id = $1
       order by sequence asc, created_at asc`,
      [runId]
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      runId: String(row.run_id),
      stream: String(row.stream),
      chunkText: String(row.chunk_text),
      sequence: Number(row.sequence),
      createdAt: new Date(row.created_at).toISOString()
    }));
  }

  async getAgentCliUsage(input: {
    goalId?: string;
    targetRoot?: string;
  } = {}): Promise<AgentCliUsageSummary> {
    const params: string[] = [];
    let where = "";
    if (input.goalId) {
      params.push(input.goalId);
      where = "where t.goal_id = $1";
    } else if (input.targetRoot) {
      params.push(input.targetRoot);
      where = "where g.target_root = $1";
    }
    const result = await this.pool.query(
      `select t.role_required,
              tr.agent_id,
              a.name as agent_name,
              tr.cli_type,
              coalesce(nullif(tr.cli_model, ''), 'default/unknown') as cli_model,
              g.status as goal_status,
              tr.status,
              count(*)::int as cli_calls,
              sum(coalesce(tr.model_call_count, case when tr.cli_type = 'mock' then 0 else 1 end))::int as model_calls,
              max(coalesce(tr.finished_at, tr.started_at, tr.created_at)) as run_at
       from ${this.table("task_runs")} tr
       join ${this.table("tasks")} t on t.id = tr.task_id
       join ${this.table("goals")} g on g.id = t.goal_id
       left join ${this.table("agents")} a on a.id = tr.agent_id
       ${where}
       group by t.role_required,
                tr.agent_id,
                a.name,
                tr.cli_type,
                coalesce(nullif(tr.cli_model, ''), 'default/unknown'),
                g.status,
                tr.status
       order by run_at asc`,
      params
    );
    const agents = await this.listAgents();
    return buildAgentCliUsageSummary({
      goalId: input.goalId,
      targetRoot: input.targetRoot,
      agentBaselines: agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        status: agent.status
      })),
      rows: result.rows.map((row) => ({
        role: row.role_required as AgentRole,
        agentId: row.agent_id ? String(row.agent_id) : null,
        agentName: row.agent_name ? String(row.agent_name) : null,
        cliType: row.cli_type as CliType,
        cliModel: row.cli_model ? String(row.cli_model) : null,
        status: String(row.status),
        cliCalls: Number(row.cli_calls),
        modelCalls: Number(row.model_calls),
        runAt: row.run_at ? new Date(row.run_at).toISOString() : null,
        goalStatus: row.goal_status ? String(row.goal_status) : null
      }))
    });
  }

  async createReleaseRecord(input: {
    goalId: string;
    codexOutboxEventId?: string;
    targetRoot: string;
    branch: string;
    commitSha: string;
    status: ReleaseRecordStatus;
    pushed: boolean;
    changedFiles: string[];
    verification: ReleaseVerificationRecord[];
    summary: string;
  }): Promise<ReleaseRecord> {
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `insert into ${this.table("release_records")}
          (id, goal_id, codex_outbox_event_id, target_root, branch, commit_sha, status, pushed,
           changed_files_json, verification_json, summary)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (goal_id, commit_sha)
         do update set codex_outbox_event_id = excluded.codex_outbox_event_id,
                       target_root = excluded.target_root,
                       branch = excluded.branch,
                       status = excluded.status,
                       pushed = excluded.pushed,
                       changed_files_json = excluded.changed_files_json,
                       verification_json = excluded.verification_json,
                       summary = excluded.summary,
                       updated_at = now()
         returning id, goal_id, codex_outbox_event_id, target_root, branch, commit_sha, status, pushed,
                   changed_files_json, verification_json, summary, created_at, updated_at`,
        [
          id,
          input.goalId,
          input.codexOutboxEventId ?? null,
          input.targetRoot,
          input.branch,
          input.commitSha,
          input.status,
          input.pushed,
          JSON.stringify(input.changedFiles),
          JSON.stringify(input.verification),
          input.summary
        ]
      );
      await client.query(
        `insert into ${this.table("system_events")} (id, event_type, payload_json)
         values ($1, $2, $3)`,
        [randomUUID(), "release.recorded", JSON.stringify({
          goalId: input.goalId,
          commitSha: input.commitSha,
          status: input.status,
          pushed: input.pushed
        })]
      );
      const goalResult = await client.query(
        `select status
         from ${this.table("goals")}
         where id = $1
         for update`,
        [input.goalId]
      );
      const currentGoalStatus = goalResult.rowCount ? goalResult.rows[0].status as Goal["status"] : null;
      const nextGoalStatus = currentGoalStatus
        ? deriveGoalStatusAfterRelease({
          currentStatus: currentGoalStatus,
          releaseStatus: input.status,
          pushed: input.pushed
        })
        : null;
      if (nextGoalStatus) {
        await client.query(
          `update ${this.table("goals")}
           set status = $2, updated_at = now()
           where id = $1 and status not in ('done', 'failed', 'cancelled')`,
          [input.goalId, nextGoalStatus]
        );
        await client.query(
          `insert into ${this.table("system_events")} (id, event_type, payload_json)
           values ($1, $2, $3)`,
          [randomUUID(), "goal.release_status_applied", JSON.stringify({
            goalId: input.goalId,
            releaseRecordId: result.rows[0].id,
            releaseStatus: input.status,
            pushed: input.pushed,
            goalStatus: nextGoalStatus
          })]
        );
      }
      if (currentGoalStatus && shouldCloseOutstandingWorkAfterRelease({
        currentStatus: currentGoalStatus,
        nextStatus: nextGoalStatus,
        releaseStatus: input.status,
        pushed: input.pushed
      })) {
        await this.closeOutstandingGoalWorkAfterRelease(client, {
          goalId: input.goalId,
          releaseRecordId: String(result.rows[0].id),
          commitSha: input.commitSha
        });
      }
      await client.query("commit");
      return mapReleaseRecord(result.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listReleaseRecords(goalId?: string): Promise<ReleaseRecord[]> {
    const params: string[] = [];
    const where = goalId ? "where goal_id = $1" : "";
    if (goalId) params.push(goalId);
    const result = await this.pool.query(
      `select id, goal_id, codex_outbox_event_id, target_root, branch, commit_sha, status, pushed,
              changed_files_json, verification_json, summary, created_at, updated_at
       from ${this.table("release_records")}
       ${where}
       order by created_at desc`,
      params
    );
    return result.rows.map(mapReleaseRecord);
  }

  async findNextCreatedTask(input: {
    goalId: string;
    afterPriority: number;
  }): Promise<{ id: string; roleRequired: AgentRole; priority: number } | null> {
    const result = await this.pool.query(
      `select id, role_required, priority
       from ${this.table("tasks")}
       where goal_id = $1
         and status = 'created'
         and priority > $2
       order by priority asc, created_at asc
       limit 1`,
      [input.goalId, input.afterPriority]
    );
    if (!result.rowCount) return null;
    return {
      id: String(result.rows[0].id),
      roleRequired: result.rows[0].role_required as AgentRole,
      priority: Number(result.rows[0].priority)
    };
  }

  async getTask(taskId: string): Promise<Record<string, unknown> | null> {
    const result = await this.pool.query(
      `select id, goal_id, title, description, role_required, assigned_agent_id, status, priority,
              blocked_reason, current_attempt, max_attempts, created_at, updated_at
       from ${this.table("tasks")}
       where id = $1`,
      [taskId]
    );
    return result.rowCount ? result.rows[0] : null;
  }

  async markTaskQueued(taskId: string): Promise<void> {
    await this.pool.query(
      `update ${this.table("tasks")}
       set status = 'queued', updated_at = now()
       where id = $1 and status = 'created'`,
      [taskId]
    );
    await this.recordTaskEvent(taskId, "task.queued", {});
  }

  async listWatchdogCandidates(input: {
    runningUpdatedBefore: string;
    limit?: number;
  }): Promise<Array<{
    id: string;
    goalId: string;
    roleRequired: AgentRole;
    status: TaskStatus;
    currentAttempt: number;
    maxAttempts: number;
    updatedAt: string;
  }>> {
    const result = await this.pool.query(
      `select id, goal_id, role_required, status, current_attempt, max_attempts, updated_at
       from ${this.table("tasks")}
       where status = 'failed'
          or (status = 'running' and updated_at <= $1)
       order by updated_at asc
       limit $2`,
      [input.runningUpdatedBefore, input.limit ?? 50]
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      goalId: String(row.goal_id),
      roleRequired: row.role_required as AgentRole,
      status: row.status as TaskStatus,
      currentAttempt: Number(row.current_attempt),
      maxAttempts: Number(row.max_attempts),
      updatedAt: new Date(row.updated_at).toISOString()
    }));
  }

  async markTaskRetryQueued(input: {
    taskId: string;
    reason: string;
    nextAttempt: number;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `update ${this.table("tasks")}
         set status = 'queued', blocked_reason = null, updated_at = now()
         where id = $1 and status in ('running', 'failed')`,
        [input.taskId]
      );
      await client.query(
        `update ${this.table("task_runs")}
         set status = 'failed',
             exit_code = coalesce(exit_code, 124),
             finished_at = coalesce(finished_at, now())
         where task_id = $1 and status = 'running'
         returning agent_id`,
        [input.taskId]
      ).then((result) => this.releaseAgentsIfIdle(client, collectAgentIds(result.rows)));
      await client.query(
        `insert into ${this.table("task_events")} (id, task_id, event_type, payload_json)
         values ($1, $2, $3, $4)`,
        [
          randomUUID(),
          input.taskId,
          "watchdog.retry_queued",
          JSON.stringify({ reason: input.reason, nextAttempt: input.nextAttempt })
        ]
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async markTaskBlocked(input: {
    taskId: string;
    reason: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `update ${this.table("tasks")}
         set status = 'blocked', blocked_reason = $2, updated_at = now()
         where id = $1`,
        [input.taskId, input.reason]
      );
      await client.query(
        `update ${this.table("task_runs")}
         set status = 'failed',
             exit_code = coalesce(exit_code, 124),
             finished_at = coalesce(finished_at, now())
         where task_id = $1 and status = 'running'
         returning agent_id`,
        [input.taskId]
      ).then((result) => this.releaseAgentsIfIdle(client, collectAgentIds(result.rows)));
      await client.query(
        `insert into ${this.table("task_events")} (id, task_id, event_type, payload_json)
         values ($1, $2, $3, $4)`,
        [randomUUID(), input.taskId, "watchdog.blocked", JSON.stringify({ reason: input.reason })]
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelTask(input: {
    taskId: string;
    reason: string;
  }): Promise<Record<string, unknown> | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `update ${this.table("tasks")}
         set status = 'cancelled', blocked_reason = $2, updated_at = now()
         where id = $1
         returning id, goal_id, title, description, role_required, assigned_agent_id, status, priority,
                   blocked_reason, current_attempt, max_attempts, created_at, updated_at`,
        [input.taskId, input.reason]
      );
      if (!result.rowCount) {
        await client.query("rollback");
        return null;
      }
      await client.query(
        `update ${this.table("task_runs")}
         set status = 'failed',
             exit_code = coalesce(exit_code, 130),
             finished_at = coalesce(finished_at, now())
         where task_id = $1 and status = 'running'
         returning agent_id`,
        [input.taskId]
      ).then((runUpdate) => this.releaseAgentsIfIdle(client, collectAgentIds(runUpdate.rows)));
      await client.query(
        `insert into ${this.table("task_events")} (id, task_id, event_type, payload_json)
         values ($1, $2, $3, $4)`,
        [randomUUID(), input.taskId, "task.cancelled", JSON.stringify({ reason: input.reason })]
      );
      await client.query("commit");
      return result.rows[0];
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeTaskByCodex(input: {
    taskId: string;
    reason: string;
    evidence?: Record<string, unknown>;
  }): Promise<Record<string, unknown> | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `update ${this.table("tasks")}
         set status = 'done',
             blocked_reason = null,
             updated_at = now()
         where id = $1 and status = any($2::text[])
         returning id, goal_id, title, description, role_required, assigned_agent_id, status, priority,
                   blocked_reason, current_attempt, max_attempts, created_at, updated_at`,
        [input.taskId, [...codexCompletableTaskStatuses]]
      );
      if (!result.rowCount) {
        await client.query("rollback");
        return null;
      }
      await client.query(
        `update ${this.table("task_runs")}
         set status = $2,
             exit_code = coalesce(exit_code, 0),
             finished_at = coalesce(finished_at, now())
         where task_id = $1 and status = 'running'
         returning agent_id`,
        [input.taskId, taskRunStatusForCodexCompletion()]
      ).then((runUpdate) => this.releaseAgentsIfIdle(client, collectAgentIds(runUpdate.rows)));
      await client.query(
        `insert into ${this.table("task_events")} (id, task_id, event_type, payload_json)
         values ($1, $2, $3, $4)`,
        [
          randomUUID(),
          input.taskId,
          "task.codex_complete",
          JSON.stringify({ reason: input.reason, evidence: input.evidence ?? {} })
        ]
      );
      await client.query("commit");
      return result.rows[0];
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async reviewTask(input: {
    taskId: string;
    verdict: "approve" | "reject" | "block";
    nextStatus: "done" | "queued" | "blocked";
    reason: string;
    reviewScore?: number;
  }): Promise<Record<string, unknown> | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `update ${this.table("tasks")}
         set status = $2,
             blocked_reason = case when $2 = 'blocked' then $3 else null end,
             updated_at = now()
         where id = $1 and status = 'needs_review'
         returning id, goal_id, title, description, role_required, assigned_agent_id, status, priority,
                   blocked_reason, current_attempt, max_attempts, created_at, updated_at`,
        [input.taskId, input.nextStatus, input.reason]
      );
      if (!result.rowCount) {
        await client.query("rollback");
        return null;
      }
      await client.query(
        `insert into ${this.table("task_events")} (id, task_id, event_type, payload_json)
         values ($1, $2, $3, $4)`,
        [
          randomUUID(),
          input.taskId,
          `task.review_${input.verdict}`,
          JSON.stringify({
            verdict: input.verdict,
            nextStatus: input.nextStatus,
            reason: input.reason,
            reviewScore: input.reviewScore ?? null
          })
        ]
      );
      await client.query("commit");
      return result.rows[0];
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async countTaskReviewRejections(taskId: string): Promise<number> {
    const result = await this.pool.query(
      `select count(*)::int as rejection_count
       from ${this.table("task_events")}
       where task_id = $1 and event_type = 'task.review_reject'`,
      [taskId]
    );
    return Number(result.rows[0]?.rejection_count ?? 0);
  }

  async listRecentTaskEvents(taskId: string, limit = 10): Promise<Array<{
    eventType: string;
    payload: Record<string, unknown>;
    createdAt: string;
  }>> {
    const normalizedLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
    const result = await this.pool.query(
      `select event_type, payload_json, created_at
       from ${this.table("task_events")}
       where task_id = $1
       order by created_at desc
       limit $2`,
      [taskId, normalizedLimit]
    );
    return result.rows.reverse().map((row) => ({
      eventType: String(row.event_type),
      payload: normalizeJsonObject(row.payload_json),
      createdAt: new Date(row.created_at).toISOString()
    }));
  }

  async createTaskRun(input: {
    taskId: string;
    cliType: CliType;
    cliModel?: string;
    command: string;
    prompt: string;
  }): Promise<string | null> {
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const taskUpdate = await client.query(
        `update ${this.table("tasks")}
         set status = 'running', current_attempt = current_attempt + 1, updated_at = now()
         where id = $1 and status in ('created', 'queued', 'failed')
         returning id, role_required`,
        [input.taskId]
      );
      if (!taskUpdate.rowCount) {
        await client.query("rollback");
        return null;
      }
      const roleRequired = taskUpdate.rows[0].role_required as AgentRole;
      const agent = await this.claimAgentForRole(client, roleRequired);
      if (agent) {
        await client.query(
          `update ${this.table("tasks")}
           set assigned_agent_id = $2, updated_at = now()
           where id = $1`,
          [input.taskId, agent.id]
        );
      }
      await client.query(
        `insert into ${this.table("task_runs")}
          (id, task_id, agent_id, cli_type, cli_model, command, prompt, status, started_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'running', now())`,
        [id, input.taskId, agent?.id ?? null, input.cliType, input.cliModel ?? null, input.command, input.prompt]
      );
      await client.query(
        `insert into ${this.table("task_events")} (id, task_id, event_type, payload_json)
         values ($1, $2, $3, $4)`,
        [
          randomUUID(),
          input.taskId,
          "task.running",
          JSON.stringify({ runId: id, agentId: agent?.id, agentName: agent?.name, roleRequired })
        ]
      );
      await client.query("commit");
      return id;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async appendRunLog(runId: string, stream: "stdout" | "stderr", chunkText: string, sequence: number): Promise<void> {
    await this.pool.query(
      `insert into ${this.table("task_run_logs")} (id, run_id, stream, chunk_text, sequence)
       values ($1, $2, $3, $4, $5)`,
      [randomUUID(), runId, stream, chunkText, sequence]
    );
  }

  async completeTaskRun(input: {
    taskId: string;
    runId: string;
    exitCode: number;
    modelCallCount?: number | null;
    modelUsageJson?: Record<string, unknown> | null;
  }): Promise<void> {
    const runStatus = input.exitCode === 0 ? "succeeded" : "failed";
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const taskResult = await client.query<{ status: TaskStatus }>(
        `select status
         from ${this.table("tasks")}
         where id = $1
         for update`,
        [input.taskId]
      );
      const currentTaskStatus = taskResult.rows[0]?.status;
      const runUpdate = await client.query(
        `update ${this.table("task_runs")}
         set status = $1,
             exit_code = $2,
             model_call_count = $3,
             model_usage_json = $4,
             finished_at = now()
         where id = $5 and status = 'running'
         returning agent_id`,
        [
          runStatus,
          input.exitCode,
          input.modelCallCount ?? null,
          input.modelUsageJson ? JSON.stringify(input.modelUsageJson) : null,
          input.runId
        ]
      );
      if (!runUpdate.rowCount || !currentTaskStatus) {
        await client.query(
          `insert into ${this.table("task_events")} (id, task_id, event_type, payload_json)
           values ($1, $2, $3, $4)`,
          [
            randomUUID(),
            input.taskId,
            "task.run_completion_ignored",
            JSON.stringify({
              runId: input.runId,
              exitCode: input.exitCode,
              reason: !runUpdate.rowCount ? "run_not_running_or_already_closed" : "task_not_found"
            })
          ]
        );
        await client.query("commit");
        return;
      }
      await this.releaseAgentsIfIdle(client, collectAgentIds(runUpdate.rows));
      const taskStatus = deriveTaskStatusAfterRunCompletion({
        currentStatus: currentTaskStatus,
        exitCode: input.exitCode
      });
      await client.query(
        `update ${this.table("tasks")}
         set status = $1, updated_at = now()
         where id = $2`,
        [taskStatus, input.taskId]
      );
      await client.query(
        `insert into ${this.table("task_events")} (id, task_id, event_type, payload_json)
         values ($1, $2, $3, $4)`,
        [
          randomUUID(),
          input.taskId,
          input.exitCode === 0 ? "task.run_succeeded" : "task.run_failed",
          JSON.stringify({
            runId: input.runId,
            exitCode: input.exitCode,
            previousTaskStatus: currentTaskStatus,
            nextTaskStatus: taskStatus
          })
        ]
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordTaskEvent(taskId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `insert into ${this.table("task_events")} (id, task_id, event_type, payload_json)
       values ($1, $2, $3, $4)`,
      [randomUUID(), taskId, eventType, JSON.stringify(payload)]
    );
  }

  async saveIntakeResult(input: {
    goalId: string;
    documents: CompiledDocument[];
    findings: DocumentFinding[];
    nodes: BuildGraphNodeDraft[];
    edges: BuildGraphEdgeDraft[];
  }): Promise<{ documents: number; findings: number; nodes: number; edges: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`delete from ${this.table("documents")} where goal_id = $1`, [input.goalId]);
      await client.query(`delete from ${this.table("document_findings")} where goal_id = $1`, [input.goalId]);
      await client.query(`delete from ${this.table("build_graph_edges")} where goal_id = $1`, [input.goalId]);
      await client.query(`delete from ${this.table("build_graph_nodes")} where goal_id = $1`, [input.goalId]);

      for (const document of input.documents) {
        await client.query(
          `insert into ${this.table("documents")}
            (id, goal_id, path, kind, line_count, size_bytes)
           values ($1, $2, $3, $4, $5, $6)`,
          [randomUUID(), input.goalId, document.path, document.kind, document.lineCount, document.sizeBytes]
        );
      }

      for (const finding of input.findings) {
        await client.query(
          `insert into ${this.table("document_findings")}
            (id, goal_id, document_path, finding_type, severity, line_number, excerpt)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            randomUUID(),
            input.goalId,
            finding.documentPath,
            finding.findingType,
            finding.severity,
            finding.lineNumber ?? null,
            finding.excerpt
          ]
        );
      }

      for (const node of input.nodes) {
        await client.query(
          `insert into ${this.table("build_graph_nodes")}
            (id, goal_id, node_key, label, node_type, status)
           values ($1, $2, $3, $4, $5, $6)`,
          [randomUUID(), input.goalId, node.nodeKey, node.label, node.nodeType, node.status]
        );
      }

      for (const edge of input.edges) {
        await client.query(
          `insert into ${this.table("build_graph_edges")}
            (id, goal_id, source_key, target_key, label)
           values ($1, $2, $3, $4, $5)`,
          [randomUUID(), input.goalId, edge.sourceKey, edge.targetKey, edge.label ?? null]
        );
      }

      await client.query(
        `insert into ${this.table("system_events")} (id, event_type, payload_json)
         values ($1, $2, $3)`,
        [
          randomUUID(),
          "goal.intake_scanned",
          JSON.stringify({
            goalId: input.goalId,
            documents: input.documents.length,
            findings: input.findings.length,
            nodes: input.nodes.length,
            edges: input.edges.length
          })
        ]
      );

      await client.query("commit");
      return {
        documents: input.documents.length,
        findings: input.findings.length,
        nodes: input.nodes.length,
        edges: input.edges.length
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listDocumentFindings(goalId: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.pool.query(
      `select document_path, finding_type, severity, line_number, excerpt, created_at
       from ${this.table("document_findings")}
       where goal_id = $1
       order by severity desc, document_path asc, line_number asc
       limit 200`,
      [goalId]
    );
    return result.rows;
  }

  async createMilestoneCandidate(input: {
    goalId: string;
    name: string;
    description: string;
    mainCommitSha?: string;
    candidateReason: string;
  }): Promise<{ id: string; status: string }> {
    const id = randomUUID();
    const result = await this.pool.query(
      `insert into ${this.table("milestones")}
        (id, goal_id, name, description, status, main_commit_sha, candidate_reason)
       values ($1, $2, $3, $4, 'candidate', $5, $6)
       returning id, status`,
      [id, input.goalId, input.name, input.description, input.mainCommitSha ?? null, input.candidateReason]
    );
    await this.recordSystemEvent("milestone.candidate", { milestoneId: id, goalId: input.goalId });
    return { id: String(result.rows[0].id), status: String(result.rows[0].status) };
  }

  async requestMilestoneE2E(milestoneId: string): Promise<void> {
    await this.pool.query(
      `update ${this.table("milestones")}
       set status = 'e2e_required', updated_at = now()
       where id = $1 and status = 'candidate'`,
      [milestoneId]
    );
    await this.recordSystemEvent("milestone.e2e_required", { milestoneId });
  }

  async getMilestone(milestoneId: string): Promise<Record<string, unknown> | null> {
    const result = await this.pool.query(
      `select id, goal_id, name, description, status, main_commit_sha, candidate_reason,
              codex_verdict, codex_verdict_reason, created_at, updated_at
       from ${this.table("milestones")}
       where id = $1`,
      [milestoneId]
    );
    return result.rowCount ? result.rows[0] : null;
  }

  async detectMilestoneCandidates(goalId: string): Promise<Array<{ id: string; status: string }>> {
    const goal = await this.getGoal(goalId);
    if (!goal) return [];

    const integrations = await this.pool.query(
      `select iq.id as integration_queue_id,
              iq.status as integration_status,
              iq.result_json,
              p.id as patch_id,
              p.status as patch_status,
              p.changed_files_json
       from ${this.table("integration_queue")} iq
       join ${this.table("patches")} p on p.id = iq.patch_id
       where iq.goal_id = $1
         and iq.status = 'passed'
         and p.status = 'applied'
         and not exists (
           select 1
           from ${this.table("milestones")} m
           where m.goal_id = iq.goal_id
             and m.candidate_reason like '%' || p.id::text || '%'
         )
       order by iq.updated_at asc`,
      [goalId]
    );

    const created: Array<{ id: string; status: string }> = [];
    for (const row of integrations.rows) {
      const resultJson = row.result_json ?? {};
      const testStatus = resultJson.testStatus === "passed" ? "passed" : "missing";
      const finalUserFeatureEvidence = Array.isArray(resultJson.finalUserFeatureEvidence)
        ? resultJson.finalUserFeatureEvidence.map(String)
        : [];
      const realDataPersistenceEvidence = Array.isArray(resultJson.realDataPersistenceEvidence)
        ? resultJson.realDataPersistenceEvidence.map(String)
        : [];
      const changedFiles = Array.isArray(row.changed_files_json) ? row.changed_files_json.map(String) : [];
      const candidate = detectMilestoneCandidate({
        goalTitle: goal.title,
        integrationStatus: row.integration_status,
        patchStatus: row.patch_status,
        changedFiles,
        testStatus,
        finalUserFeatureEvidence,
        realDataPersistenceEvidence
      });
      if (!candidate.shouldCreate) continue;

      const milestone = await this.createMilestoneCandidate({
        goalId,
        name: candidate.name,
        description: candidate.description,
        candidateReason: `${candidate.candidateReason}; patch=${row.patch_id}; integration=${row.integration_queue_id}`
      });
      created.push(milestone);
    }
    await this.recordSystemEvent("milestone.detected", { goalId, created: created.length });
    return created;
  }

  async recordCodexVerdict(input: {
    milestoneId: string;
    verdict: "passed" | "failed" | "blocked";
    reason: string;
  }): Promise<void> {
    const milestone = await this.getMilestone(input.milestoneId);
    if (!milestone) {
      throw new Error(`Milestone not found: ${input.milestoneId}`);
    }
    const currentStatus = String(milestone.status) as MilestoneStatus;
    let nextStatus = milestoneStatusForCodexVerdict(currentStatus, input.verdict);
    if (input.verdict === "passed") {
      const campaigns = await this.listE2ECampaigns(input.milestoneId);
      const caseResultModes = await this.listE2ECampaignCaseResultModes(input.milestoneId);
      const gate = evaluateMilestoneVerdictGate({
        currentStatus,
        verdict: input.verdict,
        e2eCampaigns: campaigns.map((campaign) => ({
          status: String(campaign.status) as E2ECampaignStatus,
          caseResultModes: caseResultModes.get(String(campaign.id)) ?? []
        }))
      });
      if (!gate.allowed) {
        throw new Error(gate.reason);
      }
      nextStatus = gate.nextStatus ?? nextStatus;
    }
    await this.pool.query(
      `update ${this.table("milestones")}
       set status = $1, codex_verdict = $2, codex_verdict_reason = $3, updated_at = now()
       where id = $4`,
      [nextStatus, input.verdict, input.reason, input.milestoneId]
    );
    await this.recordSystemEvent("milestone.codex_verdict", input);
  }

  async listMilestones(goalId?: string): Promise<Array<Record<string, unknown>>> {
    const params: string[] = [];
    const where = goalId ? "where goal_id = $1" : "";
    if (goalId) params.push(goalId);
    const result = await this.pool.query(
      `select id, goal_id, name, description, status, main_commit_sha, candidate_reason,
              codex_verdict, codex_verdict_reason, created_at, updated_at
       from ${this.table("milestones")}
       ${where}
       order by created_at desc`,
      params
    );
    return result.rows;
  }

  async createE2ECampaign(input: {
    milestoneId: string;
    targetUrl: string;
    acceptance: string[];
  }): Promise<{ id: string; status: string; cases: number }> {
    const milestone = await this.getMilestone(input.milestoneId);
    if (!milestone) {
      throw new Error(`Milestone not found: ${input.milestoneId}`);
    }
    const campaignDraft = buildE2ECampaignDraft({
      milestoneName: String(milestone.name),
      targetUrl: input.targetUrl,
      acceptance: input.acceptance
    });
    const campaignId = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const campaign = await client.query(
        `insert into ${this.table("e2e_campaigns")}
          (id, milestone_id, target_url, status)
         values ($1, $2, $3, 'created')
         returning id, status`,
        [campaignId, input.milestoneId, campaignDraft.targetUrl]
      );
      for (const testCase of campaignDraft.cases) {
        await client.query(
          `insert into ${this.table("e2e_cases")}
            (id, campaign_id, title, description, case_type, preconditions, steps_json, expected_result, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'created')`,
          [
            randomUUID(),
            campaignId,
            testCase.title,
            testCase.description,
            testCase.caseType,
            testCase.preconditions,
            JSON.stringify(testCase.steps),
            testCase.expectedResult
          ]
        );
      }
      await client.query(
        `update ${this.table("milestones")}
         set status = 'e2e_running', updated_at = now()
         where id = $1 and status in ('candidate', 'e2e_required')`,
        [input.milestoneId]
      );
      await client.query(
        `insert into ${this.table("system_events")} (id, event_type, payload_json)
         values ($1, $2, $3)`,
        [
          randomUUID(),
          "e2e.campaign_created",
          JSON.stringify({ milestoneId: input.milestoneId, campaignId, cases: campaignDraft.cases.length })
        ]
      );
      await client.query("commit");
      return {
        id: String(campaign.rows[0].id),
        status: String(campaign.rows[0].status),
        cases: campaignDraft.cases.length
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listE2ECampaigns(milestoneId?: string): Promise<Array<Record<string, unknown>>> {
    const params: string[] = [];
    const where = milestoneId ? "where c.milestone_id = $1" : "";
    if (milestoneId) params.push(milestoneId);
    const result = await this.pool.query(
      `select c.id, c.milestone_id, c.target_url, c.status, c.created_at, c.updated_at,
              coalesce(count(ec.id), 0)::int as case_count
       from ${this.table("e2e_campaigns")} c
       left join ${this.table("e2e_cases")} ec on ec.campaign_id = c.id
       ${where}
       group by c.id
       order by c.created_at desc`,
      params
    );
    return result.rows;
  }

  private async listE2ECampaignCaseResultModes(milestoneId: string): Promise<Map<string, string[]>> {
    const result = await this.pool.query(
      `select c.id as campaign_id,
              coalesce(array_agg(ec.result_json ->> 'mode' order by ec.created_at)
                filter (where ec.status = 'passed'), array[]::text[]) as modes
       from ${this.table("e2e_campaigns")} c
       left join ${this.table("e2e_cases")} ec on ec.campaign_id = c.id
       where c.milestone_id = $1
       group by c.id`,
      [milestoneId]
    );
    return new Map(
      result.rows.map((row) => [
        String(row.campaign_id),
        Array.isArray(row.modes) ? row.modes.map(String) : []
      ])
    );
  }

  async listE2ECases(campaignId: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.pool.query(
      `select id, campaign_id, title, description, case_type, preconditions, steps_json,
              expected_result, status, failure_reason, result_json, executed_at, created_at, updated_at
       from ${this.table("e2e_cases")}
       where campaign_id = $1
       order by created_at asc`,
      [campaignId]
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      campaignId: String(row.campaign_id),
      title: String(row.title),
      description: String(row.description),
      caseType: String(row.case_type),
      preconditions: row.preconditions ? String(row.preconditions) : undefined,
      steps: Array.isArray(row.steps_json) ? row.steps_json : [],
      expectedResult: String(row.expected_result),
      status: String(row.status),
      failureReason: row.failure_reason ? String(row.failure_reason) : undefined,
      result: row.result_json ?? {},
      executedAt: row.executed_at ? new Date(row.executed_at).toISOString() : undefined,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    }));
  }

  async recordE2ECaseResult(input: {
    caseId: string;
    status: E2ECaseStatus;
    failureReason?: string;
    result?: Record<string, unknown>;
  }): Promise<{ campaignId: string; campaignStatus: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const updated = await client.query(
        `update ${this.table("e2e_cases")}
         set status = $1,
             failure_reason = $2,
             result_json = $3,
             executed_at = now(),
             updated_at = now()
         where id = $4
         returning campaign_id`,
        [
          input.status,
          input.failureReason ?? null,
          JSON.stringify(input.result ?? {}),
          input.caseId
        ]
      );
      if (!updated.rowCount) {
        throw new Error(`E2E case not found: ${input.caseId}`);
      }
      const campaignId = String(updated.rows[0].campaign_id);
      const cases = await client.query(
        `select status from ${this.table("e2e_cases")} where campaign_id = $1 order by created_at asc`,
        [campaignId]
      );
      const campaignStatus = deriveE2ECampaignStatus(cases.rows.map((row) => String(row.status) as E2ECaseStatus));
      await client.query(
        `update ${this.table("e2e_campaigns")}
         set status = $1, updated_at = now()
         where id = $2`,
        [campaignStatus, campaignId]
      );
      await client.query(
        `insert into ${this.table("system_events")} (id, event_type, payload_json)
         values ($1, $2, $3)`,
        [
          randomUUID(),
          "e2e.case_result_recorded",
          JSON.stringify({ caseId: input.caseId, campaignId, status: input.status, campaignStatus })
        ]
      );
      await client.query("commit");
      return { campaignId, campaignStatus };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async createNotification(input: {
    milestoneId: string;
    title: string;
    body: string;
  }): Promise<{ id: string; status: string }> {
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `insert into ${this.table("notifications")}
          (id, milestone_id, title, body, status)
         values ($1, $2, $3, $4, 'created')
         returning id, status`,
        [id, input.milestoneId, input.title, input.body]
      );
      await client.query(
        `update ${this.table("milestones")}
         set status = 'notified', updated_at = now()
         where id = $1 and status = 'passed'`,
        [input.milestoneId]
      );
      await client.query(
        `insert into ${this.table("system_events")} (id, event_type, payload_json)
         values ($1, $2, $3)`,
        [
          randomUUID(),
          "notification.created",
          JSON.stringify({ notificationId: id, milestoneId: input.milestoneId })
        ]
      );
      await client.query("commit");
      return { id: String(result.rows[0].id), status: String(result.rows[0].status) };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getNotification(notificationId: string): Promise<Record<string, unknown> | null> {
    const result = await this.pool.query(
      `select id, milestone_id, title, body, status, created_at, updated_at
       from ${this.table("notifications")}
       where id = $1`,
      [notificationId]
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return {
      id: String(row.id),
      milestoneId: String(row.milestone_id),
      title: String(row.title),
      body: String(row.body),
      status: String(row.status),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    };
  }

  async ensureNotificationChannel(input: {
    type: NotificationChannelType;
    name: string;
    config: Record<string, unknown>;
  }): Promise<string> {
    const existing = await this.pool.query(
      `select id
       from ${this.table("notification_channels")}
       where type = $1 and name = $2
       order by created_at asc
       limit 1`,
      [input.type, input.name]
    );
    if (existing.rowCount) {
      return String(existing.rows[0].id);
    }
    const id = randomUUID();
    await this.pool.query(
      `insert into ${this.table("notification_channels")}
        (id, type, name, config_json, enabled)
       values ($1, $2, $3, $4, true)`,
      [id, input.type, input.name, JSON.stringify(redactChannelConfig(input.config))]
    );
    return id;
  }

  async recordNotificationDelivery(input: {
    notificationId: string;
    milestoneId: string;
    channelId: string | null;
    status: "sent" | "failed";
    payload: Record<string, unknown>;
    errorMessage?: string;
  }): Promise<string> {
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into ${this.table("notification_deliveries")}
          (id, milestone_id, channel_id, status, payload_json, error_message, sent_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          input.milestoneId,
          input.channelId,
          input.status,
          JSON.stringify(input.payload),
          input.errorMessage ?? null,
          input.status === "sent" ? new Date() : null
        ]
      );
      await client.query(
        `update ${this.table("notifications")}
         set status = case
             when $2 = 'sent' then 'sent'
             when status <> 'sent' then 'failed'
             else status
           end,
           updated_at = now()
         where id = $1`,
        [input.notificationId, input.status]
      );
      await client.query(
        `insert into ${this.table("system_events")} (id, event_type, payload_json)
         values ($1, $2, $3)`,
        [
          randomUUID(),
          input.status === "sent" ? "notification.sent" : "notification.failed",
          JSON.stringify({ notificationId: input.notificationId, deliveryId: id, error: input.errorMessage })
        ]
      );
      await client.query("commit");
      return id;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async saveCliProbeResults(results: CliProbeResult[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      for (const result of results) {
        const models = result.models?.length ? result.models : result.available ? [`${result.cliType}/default`] : [];
        for (const model of models) {
          await client.query(
            `insert into ${this.table("cli_models")}
              (id, cli_type, model, available, raw_source)
             values ($1, $2, $3, $4, $5)
             on conflict (cli_type, model)
             do update set available = excluded.available, raw_source = excluded.raw_source, updated_at = now()`,
            [randomUUID(), result.cliType, model, result.available, result.version ?? result.error ?? null]
          );
        }
      }
      await client.query(
        `insert into ${this.table("system_events")} (id, event_type, payload_json)
         values ($1, $2, $3)`,
        [randomUUID(), "cli.probed", JSON.stringify({ count: results.length })]
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listCliModels(): Promise<Array<Record<string, unknown>>> {
    const result = await this.pool.query(
      `select cli_type, model, available, raw_source, updated_at
       from ${this.table("cli_models")}
       order by cli_type asc, model asc`
    );
    return result.rows;
  }

  async saveGateChecks(input: {
    goalId: string;
    taskId?: string;
    checks: GateCheckResult[];
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      for (const check of input.checks) {
        await client.query(
          `insert into ${this.table("gate_checks")}
            (id, goal_id, task_id, gate_type, status, details_json)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            randomUUID(),
            input.goalId,
            input.taskId ?? null,
            check.gateType,
            check.status,
            JSON.stringify(check)
          ]
        );
      }
      await client.query(
        `insert into ${this.table("system_events")} (id, event_type, payload_json)
         values ($1, $2, $3)`,
        [
          randomUUID(),
          "gate.checked",
          JSON.stringify({
            goalId: input.goalId,
            taskId: input.taskId,
            blocked: input.checks.filter((check) => check.status === "blocked").length
          })
        ]
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async createPatch(input: {
    goalId: string;
    taskId: string;
    patchText: string;
    changedFiles: string[];
    allowedFiles?: string[];
  }): Promise<{ id: string; status: string; queueId: string }> {
    const id = randomUUID();
    const queueId = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `insert into ${this.table("patches")}
          (id, goal_id, task_id, patch_text, changed_files_json, allowed_files_json, status)
         values ($1, $2, $3, $4, $5, $6, 'queued')
         returning id, status`,
        [
          id,
          input.goalId,
          input.taskId,
          input.patchText,
          JSON.stringify(input.changedFiles),
          JSON.stringify(input.allowedFiles ?? [])
        ]
      );
      await client.query(
        `insert into ${this.table("integration_queue")}
          (id, patch_id, goal_id, task_id, status)
         values ($1, $2, $3, $4, 'queued')`,
        [queueId, id, input.goalId, input.taskId]
      );
      await client.query(
        `insert into ${this.table("task_events")} (id, task_id, event_type, payload_json)
         values ($1, $2, $3, $4)`,
        [
          randomUUID(),
          input.taskId,
          "patch.queued",
          JSON.stringify({ patchId: id, queueId, allowedFiles: input.allowedFiles ?? [] })
        ]
      );
      await client.query("commit");
      return { id: String(result.rows[0].id), status: String(result.rows[0].status), queueId };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getQueuedIntegrationForTask(taskId: string): Promise<{
    id: string;
    patchId: string;
    goalId: string;
    taskId: string;
    patchText: string;
    changedFiles: string[];
    allowedFiles: string[];
  } | null> {
    const result = await this.pool.query(
      `select iq.id, iq.patch_id, iq.goal_id, iq.task_id, p.patch_text, p.changed_files_json, p.allowed_files_json
       from ${this.table("integration_queue")} iq
       join ${this.table("patches")} p on p.id = iq.patch_id
       where iq.task_id = $1
         and iq.status = 'queued'
         and p.status = 'queued'
       order by iq.created_at asc
       limit 1`,
      [taskId]
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return {
      id: String(row.id),
      patchId: String(row.patch_id),
      goalId: String(row.goal_id),
      taskId: String(row.task_id),
      patchText: String(row.patch_text),
      changedFiles: Array.isArray(row.changed_files_json) ? row.changed_files_json.map(String) : [],
      allowedFiles: Array.isArray(row.allowed_files_json) ? row.allowed_files_json.map(String) : []
    };
  }

  async retryIntegration(integrationId: string): Promise<{
    id: string;
    patchId: string;
    taskId: string;
    goalId: string;
  } | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `select iq.id, iq.patch_id, iq.goal_id, iq.task_id
         from ${this.table("integration_queue")} iq
         join ${this.table("patches")} p on p.id = iq.patch_id
         where iq.id = $1
           and iq.status in ('failed', 'cancelled')
           and p.status in ('failed', 'rejected')
         for update`,
        [integrationId]
      );
      if (!result.rowCount) {
        await client.query("rollback");
        return null;
      }
      const row = result.rows[0];
      await client.query(
        `update ${this.table("integration_queue")}
         set status = 'queued', result_json = '{}'::jsonb, updated_at = now()
         where id = $1`,
        [integrationId]
      );
      await client.query(
        `update ${this.table("patches")}
         set status = 'queued', updated_at = now()
         where id = $1`,
        [row.patch_id]
      );
      await client.query(
        `insert into ${this.table("task_events")} (id, task_id, event_type, payload_json)
         values ($1, $2, $3, $4)`,
        [
          randomUUID(),
          row.task_id,
          "integration.retry_queued",
          JSON.stringify({ integrationId, patchId: row.patch_id })
        ]
      );
      await client.query("commit");
      return {
        id: String(row.id),
        patchId: String(row.patch_id),
        goalId: String(row.goal_id),
        taskId: String(row.task_id)
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordIntegrationEvidence(input: {
    integrationId: string;
    finalUserFeatureEvidence: string[];
    realDataPersistenceEvidence: string[];
  }): Promise<Record<string, unknown> | null> {
    const result = await this.pool.query(
      `update ${this.table("integration_queue")}
       set result_json = coalesce(result_json, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       where id = $1
       returning id, goal_id, task_id, status, result_json, created_at, updated_at`,
      [
        input.integrationId,
        JSON.stringify({
          finalUserFeatureEvidence: input.finalUserFeatureEvidence,
          realDataPersistenceEvidence: input.realDataPersistenceEvidence
        })
      ]
    );
    if (!result.rowCount) {
      return null;
    }
    const row = result.rows[0];
    await this.recordSystemEvent("integration.evidence_recorded", {
      integrationId: input.integrationId,
      finalUserFeatureEvidence: input.finalUserFeatureEvidence.length,
      realDataPersistenceEvidence: input.realDataPersistenceEvidence.length
    });
    return {
      id: String(row.id),
      goalId: String(row.goal_id),
      taskId: String(row.task_id),
      status: String(row.status),
      result: row.result_json ?? {},
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    };
  }

  async listQueuedIntegrations(goalId: string): Promise<Array<{
    id: string;
    patchId: string;
    taskId: string;
    goalId: string;
    changedFiles: string[];
    allowedFiles: string[];
  }>> {
    const result = await this.pool.query(
      `select iq.id, iq.patch_id, iq.goal_id, iq.task_id, p.changed_files_json, p.allowed_files_json
       from ${this.table("integration_queue")} iq
       join ${this.table("patches")} p on p.id = iq.patch_id
       where iq.goal_id = $1
         and iq.status = 'queued'
         and p.status = 'queued'
       order by iq.created_at asc`,
      [goalId]
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      patchId: String(row.patch_id),
      goalId: String(row.goal_id),
      taskId: String(row.task_id),
      changedFiles: Array.isArray(row.changed_files_json) ? row.changed_files_json.map(String) : [],
      allowedFiles: Array.isArray(row.allowed_files_json) ? row.allowed_files_json.map(String) : []
    }));
  }

  async listIntegrations(goalId?: string): Promise<Array<Record<string, unknown>>> {
    const params: string[] = [];
    const where = goalId ? "where iq.goal_id = $1" : "";
    if (goalId) params.push(goalId);
    const result = await this.pool.query(
      `select iq.id,
              iq.patch_id,
              iq.goal_id,
              iq.task_id,
              iq.status,
              iq.result_json,
              iq.created_at,
              iq.updated_at,
              p.changed_files_json,
              p.allowed_files_json,
              p.status as patch_status
       from ${this.table("integration_queue")} iq
       join ${this.table("patches")} p on p.id = iq.patch_id
       ${where}
       order by iq.created_at desc
       limit 100`,
      params
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      patchId: String(row.patch_id),
      goalId: String(row.goal_id),
      taskId: String(row.task_id),
      status: String(row.status),
      patchStatus: String(row.patch_status),
      changedFiles: Array.isArray(row.changed_files_json) ? row.changed_files_json.map(String) : [],
      allowedFiles: Array.isArray(row.allowed_files_json) ? row.allowed_files_json.map(String) : [],
      result: row.result_json ?? {},
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    }));
  }

  async markIntegrationRunning(integrationId: string): Promise<void> {
    await this.pool.query(
      `update ${this.table("integration_queue")}
       set status = 'running', updated_at = now()
       where id = $1 and status = 'queued'`,
      [integrationId]
    );
  }

  async completeIntegration(input: {
    integrationId: string;
    patchId: string;
    taskId: string;
    status: "passed" | "failed";
    result: Record<string, unknown>;
  }): Promise<void> {
    const patchStatus = input.status === "passed" ? "applied" : "failed";
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `update ${this.table("integration_queue")}
         set status = $1, result_json = $2, updated_at = now()
         where id = $3`,
        [input.status, JSON.stringify(input.result), input.integrationId]
      );
      await client.query(
        `update ${this.table("patches")}
         set status = $1, updated_at = now()
         where id = $2`,
        [patchStatus, input.patchId]
      );
      await client.query(
        `insert into ${this.table("task_events")} (id, task_id, event_type, payload_json)
         values ($1, $2, $3, $4)`,
        [
          randomUUID(),
          input.taskId,
          input.status === "passed" ? "integration.passed" : "integration.failed",
          JSON.stringify({ integrationId: input.integrationId, patchId: input.patchId, result: input.result })
        ]
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async buildFlow(goalId?: string): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] } | null> {
    const goals = goalId ? [await this.getGoal(goalId)] : await this.listGoals(1);
    const goal = goals.find(Boolean);
    if (goalId && !goal) {
      return null;
    }
    const goalLabel = goal?.title ?? "No active goal";
    const productGraph = goal ? await this.loadBuildGraph(goal.id) : null;

    const nodes: FlowNode[] = [
      node("goal", "goal", 0, 0, {
        label: goalLabel,
        status: goal?.status ?? "empty",
        goalId: goal?.id,
        targetRoot: goal?.targetRoot
      }),
      node("plan", "stage", 230, 0, { label: "PLAN.md", status: "pending" }),
      node("spec", "stage", 460, 0, { label: "Specs", status: "pending" }),
      node("test", "stage", 690, 0, { label: "features_test", status: "pending" }),
      node("worker", "agent", 920, 0, { label: "Workers", status: "idle" }),
      node("integration", "stage", 0, 150, { label: "Integration Queue", status: "pending" }),
      node("milestone", "stage", 230, 150, { label: "Milestone", status: "pending" }),
      node("e2e", "stage", 460, 150, { label: "Codex E2E", status: "pending" }),
      node("notify", "stage", 690, 150, { label: "Notify User", status: "pending" })
    ];

    const edges: FlowEdge[] = [
      edge("goal", "plan"),
      edge("plan", "spec"),
      edge("spec", "test"),
      edge("test", "worker"),
      edge("worker", "integration"),
      edge("integration", "milestone"),
      edge("milestone", "e2e"),
      edge("e2e", "notify")
    ];

    if (productGraph && productGraph.nodes.length > 0) {
      nodes.push(
        ...productGraph.nodes.map((graphNode, index) =>
          node(
            `domain:${graphNode.node_key}`,
            "domain",
            (index % 4) * 230,
            330 + Math.floor(index / 4) * 115,
            {
              label: graphNode.label,
              status: graphNode.status,
              nodeType: graphNode.node_type
            }
          )
        )
      );
      edges.push(
        edge("goal", "domain:identity"),
        ...productGraph.edges.map((graphEdge) => ({
          id: `domain:${graphEdge.source_key}-${graphEdge.target_key}`,
          source: `domain:${graphEdge.source_key}`,
          target: `domain:${graphEdge.target_key}`,
          label: graphEdge.label ?? undefined
        }))
      );
    }

    return { nodes, edges };
  }

  async recordSystemEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `insert into ${this.table("system_events")} (id, event_type, payload_json)
       values ($1, $2, $3)`,
      [randomUUID(), eventType, JSON.stringify(payload)]
    );
  }

  async createCodexOutboxEvent(input: CodexOutboxDraft): Promise<CodexOutboxEvent> {
    const result = await this.pool.query(
      `insert into ${this.table("codex_outbox")}
        (id, goal_id, event_type, severity, title, summary, payload_json, dedupe_key)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (dedupe_key)
       do update set updated_at = ${this.table("codex_outbox")}.updated_at
       returning id, goal_id, event_type, severity, status, title, summary, payload_json,
                 created_at, updated_at, acked_at`,
      [
        randomUUID(),
        input.goalId ?? null,
        input.eventType,
        input.severity,
        input.title,
        input.summary,
        JSON.stringify(input.payload),
        input.dedupeKey
      ]
    );
    await this.recordSystemEvent("codex.outbox_event", {
      eventId: String(result.rows[0].id),
      goalId: input.goalId,
      eventType: input.eventType,
      title: input.title
    });
    return mapCodexOutboxEvent(result.rows[0]);
  }

  async listCodexOutboxEvents(input: {
    goalId?: string;
    status?: CodexOutboxStatus;
    eventType?: CodexOutboxEventType;
    limit?: number;
  } = {}): Promise<CodexOutboxEvent[]> {
    const params: Array<string | number> = [input.limit ?? 20];
    const filters: string[] = [];
    if (input.goalId) {
      params.push(input.goalId);
      filters.push(`goal_id = $${params.length}`);
    }
    if (input.status) {
      params.push(input.status);
      filters.push(`status = $${params.length}`);
    }
    if (input.eventType) {
      params.push(input.eventType);
      filters.push(`event_type = $${params.length}`);
    }
    const where = filters.length ? `where ${filters.join(" and ")}` : "";
    const result = await this.pool.query(
      `select id, goal_id, event_type, severity, status, title, summary, payload_json,
              created_at, updated_at, acked_at
       from ${this.table("codex_outbox")}
       ${where}
       order by case severity when 'error' then 0 when 'warning' then 1 else 2 end,
                created_at asc
       limit $1`,
      params
    );
    return result.rows.map(mapCodexOutboxEvent);
  }

  async getCodexOutboxEvent(eventId: string): Promise<CodexOutboxEvent | null> {
    const result = await this.pool.query(
      `select id, goal_id, event_type, severity, status, title, summary, payload_json,
              created_at, updated_at, acked_at
       from ${this.table("codex_outbox")}
       where id = $1`,
      [eventId]
    );
    return result.rowCount ? mapCodexOutboxEvent(result.rows[0]) : null;
  }

  async countReleaseRecordsForCodexOutboxEvent(eventId: string): Promise<number> {
    const result = await this.pool.query(
      `select count(*)::int as release_count
       from ${this.table("release_records")}
       where codex_outbox_event_id = $1`,
      [eventId]
    );
    return Number(result.rows[0]?.release_count ?? 0);
  }

  async ackCodexOutboxEvent(eventId: string): Promise<CodexOutboxEvent | null> {
    const result = await this.pool.query(
      `update ${this.table("codex_outbox")}
       set status = 'acked', acked_at = now(), updated_at = now()
       where id = $1
       returning id, goal_id, event_type, severity, status, title, summary, payload_json,
                 created_at, updated_at, acked_at`,
      [eventId]
    );
    if (!result.rowCount) return null;
    await this.recordSystemEvent("codex.outbox_acked", { eventId });
    return mapCodexOutboxEvent(result.rows[0]);
  }

  async reconcileResolvedCodexOutboxEvents(): Promise<{ acked: number; events: CodexOutboxEvent[] }> {
    const integrationResult = await this.pool.query<{ id: string }>(
      `select co.id
         from ${this.table("codex_outbox")} co
         join ${this.table("integration_queue")} iq
           on iq.id::text = co.payload_json->>'integrationId'
         where co.status = 'pending'
           and co.event_type = 'blocker'
           and iq.status = 'passed'`
    );
    const goalResult = await this.pool.query<{
      id: string;
      event_type: CodexOutboxEventType;
      outbox_status: CodexOutboxStatus;
      goal_status: Goal["status"];
    }>(
      `select co.id,
              co.event_type,
              co.status as outbox_status,
              g.status as goal_status
       from ${this.table("codex_outbox")} co
       join ${this.table("goals")} g
         on g.id = co.goal_id
       where co.status = 'pending'
         and co.event_type = 'blocker'`
    );
    const taskResult = await this.pool.query<{
      id: string;
      event_type: CodexOutboxEventType;
      outbox_status: CodexOutboxStatus;
      task_status: TaskStatus;
    }>(
      `select co.id,
              co.event_type,
              co.status as outbox_status,
              t.status as task_status
       from ${this.table("codex_outbox")} co
       join ${this.table("tasks")} t
         on t.id::text = co.payload_json->>'taskId'
       where co.status = 'pending'
         and co.event_type = 'blocker'`
    );
    const ids = Array.from(new Set([
      ...integrationResult.rows.map((row) => row.id),
      ...goalResult.rows
        .filter((row) => shouldReconcileCodexOutboxForGoalStatus({
          eventType: row.event_type,
          outboxStatus: row.outbox_status,
          goalStatus: row.goal_status
        }))
        .map((row) => row.id),
      ...taskResult.rows
        .filter((row) => shouldReconcileCodexOutboxForTaskStatus({
          eventType: row.event_type,
          outboxStatus: row.outbox_status,
          taskStatus: row.task_status
        }))
        .map((row) => row.id)
    ]));
    if (ids.length === 0) {
      return { acked: 0, events: [] };
    }
    const result = await this.pool.query(
      `update ${this.table("codex_outbox")} co
       set status = 'acked', acked_at = now(), updated_at = now()
       where co.id = any($1::uuid[])
       returning co.id, co.goal_id, co.event_type, co.severity, co.status, co.title, co.summary,
                 co.payload_json, co.created_at, co.updated_at, co.acked_at`,
      [ids]
    );
    const events = result.rows.map(mapCodexOutboxEvent);
    if (events.length > 0) {
      await this.recordSystemEvent("codex.outbox_reconciled", {
        acked: events.length,
        eventIds: events.map((event) => event.id),
        reason: "integration passed or goal closed"
      });
    }
    return { acked: events.length, events };
  }

  async listWatchdogEvents(limit = 30): Promise<Array<Record<string, unknown>>> {
    const result = await this.pool.query(
      `select *
       from (
         select te.id,
                te.event_type,
                te.payload_json,
                te.created_at,
                t.id as task_id,
                t.title as task_title,
                t.role_required,
                t.status as task_status,
                t.blocked_reason,
                t.goal_id,
                null::text as system_scope
         from ${this.table("task_events")} te
         join ${this.table("tasks")} t on t.id = te.task_id
         where te.event_type like 'watchdog.%'
         union all
         select se.id,
                se.event_type,
                se.payload_json,
                se.created_at,
                null::uuid as task_id,
                null::text as task_title,
                null::text as role_required,
                null::text as task_status,
                null::text as blocked_reason,
                null::uuid as goal_id,
                'system'::text as system_scope
         from ${this.table("system_events")} se
         where se.event_type = 'watchdog.run'
       ) events
       order by created_at desc
       limit $1`,
      [limit]
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      eventType: String(row.event_type),
      payload: row.payload_json ?? {},
      createdAt: new Date(row.created_at).toISOString(),
      taskId: row.task_id ? String(row.task_id) : undefined,
      taskTitle: row.task_title ? String(row.task_title) : undefined,
      roleRequired: row.role_required ? String(row.role_required) : undefined,
      taskStatus: row.task_status ? String(row.task_status) : undefined,
      blockedReason: row.blocked_reason ? String(row.blocked_reason) : undefined,
      goalId: row.goal_id ? String(row.goal_id) : undefined,
      scope: row.system_scope ? String(row.system_scope) : "task"
    }));
  }

  async listSystemEvents(input: {
    eventPrefix?: string;
    limit?: number;
  } = {}): Promise<Array<Record<string, unknown>>> {
    const params: Array<string | number> = [input.limit ?? 30];
    const where = input.eventPrefix ? "where event_type like $2" : "";
    if (input.eventPrefix) params.push(`${input.eventPrefix}%`);
    const result = await this.pool.query(
      `select id, event_type, payload_json, created_at
       from ${this.table("system_events")}
       ${where}
       order by created_at desc
       limit $1`,
      params
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      eventType: String(row.event_type),
      payload: row.payload_json ?? {},
      createdAt: new Date(row.created_at).toISOString()
    }));
  }

  private table(name: string): string {
    return `${quoteIdent(this.schema)}.${quoteIdent(name)}`;
  }

  private async loadBuildGraph(goalId: string): Promise<{
    nodes: Array<{ node_key: string; label: string; node_type: string; status: string }>;
    edges: Array<{ source_key: string; target_key: string; label: string | null }>;
  }> {
    const [nodes, edges] = await Promise.all([
      this.pool.query(
        `select node_key, label, node_type, status
         from ${this.table("build_graph_nodes")}
         where goal_id = $1
         order by created_at asc`,
        [goalId]
      ),
      this.pool.query(
        `select source_key, target_key, label
         from ${this.table("build_graph_edges")}
         where goal_id = $1
         order by created_at asc`,
        [goalId]
      )
    ]);
    return { nodes: nodes.rows, edges: edges.rows };
  }

  private async claimAgentForRole(client: pg.PoolClient, role: AgentRole): Promise<AgentRecord | null> {
    const result = await client.query(
      `select id, name, role, status, cli_type, cli_model, created_at, updated_at
       from ${this.table("agents")}
       where role = $1 and status <> 'disabled'
       for update`,
      [role]
    );
    const agent = selectAgentForRun({ role, agents: result.rows.map(mapAgent) });
    if (!agent) return null;
    await client.query(
      `update ${this.table("agents")}
       set status = 'working', updated_at = now()
       where id = $1`,
      [agent.id]
    );
    return agent;
  }

  private async releaseAgentsIfIdle(client: pg.PoolClient, agentIds: string[]): Promise<void> {
    for (const agentId of agentIds) {
      await client.query(
        `update ${this.table("agents")} a
         set status = 'idle', updated_at = now()
         where a.id = $1
           and a.status = 'working'
           and not exists (
             select 1
             from ${this.table("task_runs")} tr
             where tr.agent_id = a.id and tr.status = 'running'
           )`,
        [agentId]
      );
    }
  }

  private async closeOutstandingGoalWorkAfterRelease(
    client: pg.PoolClient,
    input: { goalId: string; releaseRecordId: string; commitSha: string }
  ): Promise<void> {
    const reason = `superseded by pushed passing release ${input.commitSha}`;
    const taskResult = await client.query(
      `update ${this.table("tasks")}
       set status = 'cancelled',
           blocked_reason = $2,
           updated_at = now()
       where goal_id = $1
         and status not in ('done', 'cancelled')
       returning id, title, status`,
      [input.goalId, reason]
    );
    for (const row of taskResult.rows) {
      await client.query(
        `insert into ${this.table("task_events")} (id, task_id, event_type, payload_json)
         values ($1, $2, $3, $4)`,
        [
          randomUUID(),
          row.id,
          "task.release_superseded",
          JSON.stringify({
            goalId: input.goalId,
            releaseRecordId: input.releaseRecordId,
            commitSha: input.commitSha,
            reason
          })
        ]
      );
    }

    if (taskResult.rows.length > 0) {
      const taskIds = taskResult.rows.map((row) => String(row.id));
      const runUpdate = await client.query(
        `update ${this.table("task_runs")}
         set status = 'failed',
             exit_code = coalesce(exit_code, 130),
             finished_at = coalesce(finished_at, now())
         where task_id = any($1::uuid[])
           and status = 'running'
         returning agent_id`,
        [taskIds]
      );
      await this.releaseAgentsIfIdle(client, collectAgentIds(runUpdate.rows));
    }

    const integrationResult = await client.query(
      `update ${this.table("integration_queue")}
       set status = 'cancelled',
           result_json = coalesce(result_json, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       where goal_id = $1
         and status in ('queued', 'running')
       returning id, patch_id, task_id`,
      [
        input.goalId,
        JSON.stringify({
          reason,
          releaseRecordId: input.releaseRecordId,
          commitSha: input.commitSha
        })
      ]
    );
    if (integrationResult.rows.length > 0) {
      await client.query(
        `update ${this.table("patches")}
         set status = 'rejected', updated_at = now()
         where id = any($1::uuid[])
           and status in ('created', 'queued')`,
        [integrationResult.rows.map((row) => String(row.patch_id))]
      );
      for (const row of integrationResult.rows) {
        await client.query(
          `insert into ${this.table("task_events")} (id, task_id, event_type, payload_json)
           values ($1, $2, $3, $4)`,
          [
            randomUUID(),
            row.task_id,
            "integration.release_superseded",
            JSON.stringify({
              goalId: input.goalId,
              integrationId: row.id,
              patchId: row.patch_id,
              releaseRecordId: input.releaseRecordId,
              commitSha: input.commitSha,
              reason
            })
          ]
        );
      }
    }

    await client.query(
      `insert into ${this.table("system_events")} (id, event_type, payload_json)
       values ($1, $2, $3)`,
      [
        randomUUID(),
        "goal.release_cleanup_applied",
        JSON.stringify({
          goalId: input.goalId,
          releaseRecordId: input.releaseRecordId,
          commitSha: input.commitSha,
          cancelledTasks: taskResult.rows.length,
          cancelledIntegrations: integrationResult.rows.length
        })
      ]
    );
  }
}

function redactChannelConfig(config: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    redacted[key] = /token|secret|password/i.test(key) ? "[REDACTED]" : value;
  }
  return redacted;
}

function mapGoal(row: Record<string, unknown>): Goal {
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description),
    targetRoot: String(row.target_root),
    status: row.status as Goal["status"],
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString()
  };
}

function mapAgent(row: Record<string, unknown>): AgentRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    role: row.role as AgentRole,
    status: row.status as AgentRecord["status"],
    cliType: row.cli_type as CliType,
    cliModel: row.cli_model ? String(row.cli_model) : undefined,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString()
  };
}

function collectAgentIds(rows: Array<Record<string, unknown>>): string[] {
  return Array.from(new Set(rows.flatMap((row) => row.agent_id ? [String(row.agent_id)] : [])));
}

function mapCodexOutboxEvent(row: Record<string, unknown>): CodexOutboxEvent {
  return {
    id: String(row.id),
    goalId: row.goal_id ? String(row.goal_id) : undefined,
    eventType: row.event_type as CodexOutboxEvent["eventType"],
    severity: row.severity as CodexOutboxEvent["severity"],
    status: row.status as CodexOutboxEvent["status"],
    title: String(row.title),
    summary: String(row.summary),
    payload: row.payload_json && typeof row.payload_json === "object" && !Array.isArray(row.payload_json)
      ? row.payload_json as Record<string, unknown>
      : {},
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    ackedAt: row.acked_at ? new Date(String(row.acked_at)).toISOString() : undefined
  };
}

function mapReleaseRecord(row: Record<string, unknown>): ReleaseRecord {
  return {
    id: String(row.id),
    goalId: String(row.goal_id),
    codexOutboxEventId: row.codex_outbox_event_id ? String(row.codex_outbox_event_id) : undefined,
    targetRoot: String(row.target_root),
    branch: String(row.branch),
    commitSha: String(row.commit_sha),
    status: row.status as ReleaseRecordStatus,
    pushed: Boolean(row.pushed),
    changedFiles: normalizeJsonArray(row.changed_files_json),
    verification: normalizeVerification(row.verification_json),
    summary: String(row.summary ?? ""),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString()
  };
}

function normalizeJsonArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeVerification(value: unknown): ReleaseVerificationRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.command !== "string") return [];
    if (record.status !== "passed" && record.status !== "failed" && record.status !== "blocked") return [];
    return [{
      command: record.command,
      status: record.status,
      output: typeof record.output === "string" ? record.output : undefined
    }];
  });
}

function node(id: string, type: string, x: number, y: number, data: Record<string, unknown>): FlowNode {
  return { id, type, position: { x, y }, data };
}

function edge(source: string, target: string): FlowEdge {
  return { id: `${source}-${target}`, source, target };
}
