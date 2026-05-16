import { randomUUID } from "node:crypto";
import type { AgentRole, CliType, FlowEdge, FlowNode, Goal } from "@dionysus/core";
import type pg from "pg";
import { quoteIdent } from "./connection.js";
import type {
  BuildGraphEdgeDraft,
  BuildGraphNodeDraft,
  CompiledDocument,
  DocumentFinding
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

  async markTaskQueued(taskId: string): Promise<void> {
    await this.pool.query(
      `update ${this.table("tasks")}
       set status = 'queued', updated_at = now()
       where id = $1 and status = 'created'`,
      [taskId]
    );
    await this.recordTaskEvent(taskId, "task.queued", {});
  }

  async createTaskRun(input: {
    taskId: string;
    cliType: CliType;
    cliModel?: string;
    command: string;
    prompt: string;
  }): Promise<string> {
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into ${this.table("task_runs")}
          (id, task_id, cli_type, cli_model, command, prompt, status, started_at)
         values ($1, $2, $3, $4, $5, $6, 'running', now())`,
        [id, input.taskId, input.cliType, input.cliModel ?? null, input.command, input.prompt]
      );
      await client.query(
        `update ${this.table("tasks")}
         set status = 'running', current_attempt = current_attempt + 1, updated_at = now()
         where id = $1`,
        [input.taskId]
      );
      await client.query(
        `insert into ${this.table("task_events")} (id, task_id, event_type, payload_json)
         values ($1, $2, $3, $4)`,
        [randomUUID(), input.taskId, "task.running", JSON.stringify({ runId: id })]
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

  async completeTaskRun(input: { taskId: string; runId: string; exitCode: number }): Promise<void> {
    const runStatus = input.exitCode === 0 ? "succeeded" : "failed";
    const taskStatus = input.exitCode === 0 ? "needs_review" : "failed";
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `update ${this.table("task_runs")}
         set status = $1, exit_code = $2, finished_at = now()
         where id = $3`,
        [runStatus, input.exitCode, input.runId]
      );
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
          JSON.stringify({ runId: input.runId, exitCode: input.exitCode })
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

  async recordCodexVerdict(input: {
    milestoneId: string;
    verdict: "passed" | "failed" | "blocked";
    reason: string;
  }): Promise<void> {
    const nextStatus =
      input.verdict === "passed" ? "passed" : input.verdict === "failed" ? "e2e_failed" : "e2e_blocked";
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

  async buildFlow(goalId?: string): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] } | null> {
    const goals = goalId ? [await this.getGoal(goalId)] : await this.listGoals(1);
    const goal = goals.find(Boolean);
    if (goalId && !goal) {
      return null;
    }
    const goalLabel = goal?.title ?? "No active goal";
    const productGraph = goal ? await this.loadBuildGraph(goal.id) : null;

    const nodes: FlowNode[] = [
      node("goal", "goal", 0, 0, { label: goalLabel, status: goal?.status ?? "empty" }),
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

function node(id: string, type: string, x: number, y: number, data: Record<string, unknown>): FlowNode {
  return { id, type, position: { x, y }, data };
}

function edge(source: string, target: string): FlowEdge {
  return { id: `${source}-${target}`, source, target };
}
