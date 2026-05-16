import { useEffect, useState } from "react";
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { Activity, AlertTriangle, BarChart3, CheckCircle2, GitCommit, Network, Settings2 } from "lucide-react";
import {
  createGoal,
  fetchAgents,
  fetchAgentCliConfigs,
  fetchAgentCliUsage,
  fetchCurrentFlow,
  fetchE2ECampaigns,
  fetchGoal,
  fetchE2ECases,
  fetchIntegrations,
  fetchReleases,
  fetchMilestones,
  fetchRunLogs,
  fetchRuns,
  fetchGoals,
  fetchSystemHealth,
  fetchSystemEvents,
  fetchGoalFlow,
  fetchTasks,
  fetchWatchdogEvents,
  probeClis,
  releaseReadyIntegrations,
  runMasterStep,
  runTargetPreflight,
  runWatchdog,
  saveAgentCliConfig,
  validateCliModel,
  type AgentCliConfig,
  type AgentCliUsageSummary,
  type AgentRecord,
  type AgentRole,
  type CliModelValidationResult,
  type CliProbeResult,
  type CliType,
  type E2ECampaignRecord,
  type E2ECaseRecord,
  type FlowResponse,
  type Goal,
  type IntegrationRecord,
  type MasterStepResult,
  type MilestoneRecord,
  type ReleaseReadyIntegrationsResult,
  type ReleaseRecord,
  type SystemEvent,
  type SystemHealth,
  type TaskRecord,
  type TaskRunLogRecord,
  type TaskRunRecord,
  type TargetPreflightResult,
  type WatchdogEvent,
  type WatchdogRunResult
} from "./api.js";
import { AgentConfigValidationError, saveValidatedAgentCliConfig } from "./agent-config-validation.js";
import { cliCallTotalLabel, describeUsageScope, liveUsageRefreshLabel, modelCallTotalLabel, modelCallLabel } from "./agent-usage-display.js";
import { summarizeSystemHealth } from "./system-health.js";

const nodeTypes = {
  goal: FlowStatusNode,
  stage: FlowStatusNode,
  agent: FlowStatusNode,
  domain: FlowStatusNode
};
const usageRefreshIntervalMs = 5000;

export function App() {
  const [flow, setFlow] = useState<FlowResponse>({ nodes: [], edges: [] });
  const [currentGoal, setCurrentGoal] = useState<Goal | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [flowGoalTitle, setFlowGoalTitle] = useState("等待 Codex 创建目标");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [agentConfigs, setAgentConfigs] = useState<Record<AgentRole, AgentCliConfig>>(defaultAgentConfigs);
  const [probeResults, setProbeResults] = useState<CliProbeResult[]>([]);
  const [savingRole, setSavingRole] = useState<AgentRole | null>(null);
  const [modelValidations, setModelValidations] = useState<Partial<Record<AgentRole, CliModelValidationResult>>>({});
  const [probing, setProbing] = useState(false);
  const [watchdogEvents, setWatchdogEvents] = useState<WatchdogEvent[]>([]);
  const [watchdogRun, setWatchdogRun] = useState<WatchdogRunResult | null>(null);
  const [watchdogRunning, setWatchdogRunning] = useState(false);
  const [activeGoalId, setActiveGoalId] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<TargetPreflightResult | null>(null);
  const [preflightRunning, setPreflightRunning] = useState(false);
  const [integrations, setIntegrations] = useState<IntegrationRecord[]>([]);
  const [releaseResult, setReleaseResult] = useState<ReleaseReadyIntegrationsResult | null>(null);
  const [releaseRecords, setReleaseRecords] = useState<ReleaseRecord[]>([]);
  const [releaseRecordsScope, setReleaseRecordsScope] = useState<"current" | "global">("current");
  const [releasing, setReleasing] = useState(false);
  const [masterStep, setMasterStep] = useState<MasterStepResult | null>(null);
  const [masterStepping, setMasterStepping] = useState(false);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [runs, setRuns] = useState<TaskRunRecord[]>([]);
  const [runLogs, setRunLogs] = useState<Record<string, TaskRunLogRecord[]>>({});
  const [loadingRunLogs, setLoadingRunLogs] = useState<string | null>(null);
  const [masterEvents, setMasterEvents] = useState<SystemEvent[]>([]);
  const [milestones, setMilestones] = useState<MilestoneRecord[]>([]);
  const [e2eCampaigns, setE2ECampaigns] = useState<E2ECampaignRecord[]>([]);
  const [e2eCases, setE2ECases] = useState<E2ECaseRecord[]>([]);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [agentCliUsage, setAgentCliUsage] = useState<AgentCliUsageSummary | null>(null);
  const [agents, setAgents] = useState<AgentRecord[]>([]);

  useEffect(() => {
    Promise.all([refreshGoals(), refreshFlow(), refreshAgentConfigs(), refreshAgents(), refreshWatchdogEvents(), refreshSystemHealth(), refreshAgentCliUsage()])
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (activeGoalId) {
      refreshGoalEvidence(activeGoalId)
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
      refreshAgentCliUsage(activeGoalId)
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    }
  }, [activeGoalId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      Promise.all([
        refreshSystemHealth(),
        refreshAgents(),
        refreshAgentCliUsage(activeGoalId),
        activeGoalId ? refreshGoalEvidence(activeGoalId) : Promise.resolve()
      ]).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    }, usageRefreshIntervalMs);
    return () => window.clearInterval(interval);
  }, [activeGoalId]);

  async function refreshFlow() {
    const nextFlow = await fetchCurrentFlow();
    setFlow(nextFlow);
    const goalNode = nextFlow.nodes.find((candidate) => {
      const node = candidate as { id?: string };
      return node.id === "goal";
    }) as { data?: { label?: string; goalId?: string } } | undefined;
    if (goalNode?.data?.label) {
      setFlowGoalTitle(goalNode.data.label);
    }
    const nextGoalId = goalNode?.data?.goalId ?? null;
    setActiveGoalId(nextGoalId);
    if (nextGoalId) {
      setCurrentGoal(await fetchGoal(nextGoalId));
    } else {
      setCurrentGoal(null);
    }
  }

  async function refreshGoals() {
    setGoals(await fetchGoals(20));
  }

  async function selectGoal(goalId: string) {
    if (!goalId) return;
    setError(null);
    const [goal, nextFlow] = await Promise.all([
      fetchGoal(goalId),
      fetchGoalFlow(goalId)
    ]);
    setCurrentGoal(goal);
    setActiveGoalId(goal.id);
    setFlow(nextFlow);
    setFlowGoalTitle(goal.title);
  }

  async function createCouponGoal() {
    setCreating(true);
    setError(null);
    try {
      const goal = await createGoal({
        title: "完整实现 Coupon SaaS 系统",
        description: "读取 Coupon 文档和管理后台页面，按 SDD、TDD、主干提交和 Codex E2E 持续推进。",
        targetRoot: "/Volumes/MacMiniSSD/code/Coupon"
      });
      setCurrentGoal(goal);
      setActiveGoalId(goal.id);
      await Promise.all([refreshGoals(), refreshFlow()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function refreshAgentConfigs() {
    const configs = await fetchAgentCliConfigs();
    setAgentConfigs((current) => {
      const next = { ...current };
      for (const config of configs) {
        next[config.role] = config;
      }
      return next;
    });
  }

  async function refreshAgents() {
    setAgents(await fetchAgents());
  }

  async function saveRoleConfig(role: AgentRole) {
    setSavingRole(role);
    setError(null);
    try {
      const result = await saveValidatedAgentCliConfig(agentConfigs[role], {
        validate: validateCliModel,
        save: saveAgentCliConfig
      });
      setAgentConfigs((current) => ({ ...current, [role]: result.saved }));
      setModelValidations((current) => ({
        ...current,
        [role]: result.validation
      }));
    } catch (err) {
      if (err instanceof AgentConfigValidationError) {
        setModelValidations((current) => ({
          ...current,
          [role]: err.validation
        }));
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingRole(null);
    }
  }

  async function runCliProbe() {
    setProbing(true);
    setError(null);
    try {
      setProbeResults(await probeClis());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProbing(false);
    }
  }

  async function refreshWatchdogEvents() {
    setWatchdogEvents(await fetchWatchdogEvents(20));
  }

  async function refreshSystemHealth() {
    setSystemHealth(await fetchSystemHealth());
  }

  async function refreshAgentCliUsage(goalId = activeGoalId) {
    setAgentCliUsage(await fetchAgentCliUsage(goalId ?? undefined));
  }

  async function executeWatchdog() {
    setWatchdogRunning(true);
    setError(null);
    try {
      const result = await runWatchdog();
      setWatchdogRun(result);
      await refreshWatchdogEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWatchdogRunning(false);
    }
  }

  async function executePreflight() {
    if (!activeGoalId) {
      setError("当前没有可执行 preflight 的目标");
      return;
    }
    setPreflightRunning(true);
    setError(null);
    try {
      setPreflight(await runTargetPreflight(activeGoalId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreflightRunning(false);
    }
  }

  async function refreshIntegrations(goalId = activeGoalId) {
    if (!goalId) return;
    setIntegrations(await fetchIntegrations(goalId));
  }

  async function refreshGoalEvidence(goalId = activeGoalId) {
    if (!goalId) return;
    const [nextIntegrations, currentReleases, nextTasks, nextRuns, nextMasterEvents, nextMilestones] = await Promise.all([
      fetchIntegrations(goalId),
      fetchReleases(goalId),
      fetchTasks(goalId),
      fetchRuns(goalId, 20),
      fetchSystemEvents("master_control.", 10),
      fetchMilestones(goalId)
    ]);
    const nextReleases = currentReleases.length ? currentReleases : await fetchReleases();
    setIntegrations(nextIntegrations);
    setReleaseRecords(nextReleases);
    setReleaseRecordsScope(currentReleases.length ? "current" : "global");
    setTasks(nextTasks);
    setRuns(nextRuns);
    setMasterEvents(nextMasterEvents);
    setMilestones(nextMilestones);
    const latestMilestone = nextMilestones[0];
    if (!latestMilestone) {
      setE2ECampaigns([]);
      setE2ECases([]);
      return;
    }
    const campaigns = await fetchE2ECampaigns(latestMilestone.id);
    setE2ECampaigns(campaigns);
    const latestCampaign = campaigns[0];
    setE2ECases(latestCampaign ? await fetchE2ECases(latestCampaign.id) : []);
  }

  async function toggleRunLogs(runId: string) {
    if (runLogs[runId]) {
      setRunLogs((current) => {
        const next = { ...current };
        delete next[runId];
        return next;
      });
      return;
    }
    setLoadingRunLogs(runId);
    setError(null);
    try {
      const response = await fetchRunLogs(runId);
      setRunLogs((current) => ({ ...current, [runId]: response.logs }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingRunLogs(null);
    }
  }

  async function releaseIntegrations() {
    if (!activeGoalId) {
      setError("当前没有可发布 integration 的目标");
      return;
    }
    setReleasing(true);
    setError(null);
    try {
      const result = await releaseReadyIntegrations(activeGoalId);
      setReleaseResult(result);
      await refreshGoalEvidence(activeGoalId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReleasing(false);
    }
  }

  async function runMasterAutopilotStep() {
    if (!activeGoalId) {
      setError("当前没有可运行 Master Step 的目标");
      return;
    }
    setMasterStepping(true);
    setError(null);
    try {
      const result = await runMasterStep(activeGoalId);
      setMasterStep(result);
      await Promise.all([refreshFlow(), refreshGoalEvidence(activeGoalId), refreshWatchdogEvents()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMasterStepping(false);
    }
  }

  function updateRoleConfig(role: AgentRole, patch: Partial<AgentCliConfig>) {
    setAgentConfigs((current) => ({
      ...current,
      [role]: {
        ...current[role],
        ...patch
      }
    }));
  }

  const healthSummary = summarizeSystemHealth(systemHealth);
  const usageByRole = new Map(agentCliUsage?.byAgent.map((usage) => [usage.role, usage]) ?? []);
  const usageByAgentInstance = agentCliUsage?.byAgentInstance ?? [];
  const usageByCli = agentCliUsage?.byCli ?? [];
  const usageGeneratedLabel = agentCliUsage?.generatedAt
    ? new Date(agentCliUsage.generatedAt).toLocaleTimeString()
    : "未加载";
  const usageScopeLabel = describeUsageScope({
    goalId: activeGoalId,
    goalTitle: currentGoal?.title ?? flowGoalTitle,
    targetRoot: currentGoal?.targetRoot
  });

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <Network size={24} />
          <div>
            <h1>Dionysus</h1>
            <p>Codex Agent Team 控制面</p>
          </div>
        </div>
        <nav>
          <a className="active">Dashboard</a>
          <a>Flow</a>
          <a>Agents</a>
          <a>Tasks</a>
          <a>Runs</a>
          <a>Milestones</a>
          <a>Notifications</a>
        </nav>
      </aside>
      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">当前目标</p>
            <h2>{currentGoal?.title ?? flowGoalTitle}</h2>
          </div>
          <div className="statusGrid">
            <StatusCard icon={<Activity />} label="Runtime" value={healthSummary.overall} tone={healthSummary.overall === "ready" ? "good" : "bad"} />
            <StatusCard icon={<CheckCircle2 />} label="RabbitMQ" value={healthSummary.rabbitmq} tone={healthSummary.rabbitmq === "ready" ? "good" : "bad"} />
            <StatusCard icon={<GitCommit />} label="Worker" value={healthSummary.workerLabel} tone={healthSummary.worker === "ready" ? "good" : "bad"} />
          </div>
        </header>
        <section className="actionBar">
          <select
            className="goalSelect"
            value={activeGoalId ?? ""}
            onChange={(event) => selectGoal(event.target.value).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}
          >
            <option value="">选择已有目标</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title} · {goal.status}
              </option>
            ))}
          </select>
          <button type="button" onClick={createCouponGoal} disabled={creating}>
            {creating ? "创建中..." : "创建 Coupon 目标"}
          </button>
          <button type="button" className="secondary" onClick={refreshFlow}>
            刷新流程图
          </button>
        </section>
        {error ? (
          <div className="errorBox">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        ) : null}
        <section className="flowPanel">
          <ReactFlow nodes={flow.nodes as Node[]} edges={flow.edges as Edge[]} nodeTypes={nodeTypes} fitView>
            <Background />
            <Controls />
          </ReactFlow>
        </section>
        <section className="runtimePanel">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Runtime Health</p>
              <h3>系统依赖与 Agent Runtime</h3>
            </div>
            <button type="button" className="secondary" onClick={refreshSystemHealth}>
              刷新健康状态
            </button>
          </div>
          {systemHealth ? (
            <div className="runtimeGrid">
              <StatusCard
                icon={<CheckCircle2 />}
                label="PostgreSQL"
                value={`${healthSummary.database} / ${systemHealth.database.schema}`}
                tone={healthSummary.database === "ready" ? "good" : "bad"}
              />
              <StatusCard
                icon={<Network />}
                label="RabbitMQ"
                value={systemHealth.rabbitmq.ok ? "connected" : "failed"}
                tone={systemHealth.rabbitmq.ok ? "good" : "bad"}
              />
              <StatusCard
                icon={<Activity />}
                label="Worker"
                value={healthSummary.workerLabel}
                tone={healthSummary.worker === "ready" ? "good" : "bad"}
              />
              <StatusCard
                icon={<GitCommit />}
                label="Heartbeat"
                value={systemHealth.worker.lastSeenAt ? new Date(systemHealth.worker.lastSeenAt).toLocaleTimeString() : "missing"}
                tone={healthSummary.worker === "ready" ? "good" : "bad"}
              />
            </div>
          ) : (
            <div className="emptyState">尚未加载系统健康状态</div>
          )}
          <div className="agentInstanceStrip">
            {agents.length ? (
              agents.map((agent) => (
                <article key={agent.id} className={`agentInstance ${agent.status}`}>
                  <strong>{agent.name}</strong>
                  <span>{roleLabels[agent.role]} · {agent.status}</span>
                  <em>{agent.cliType}{agent.cliModel ? ` / ${agent.cliModel}` : ""}</em>
                </article>
              ))
            ) : (
              <div className="emptyState">尚未加载 Agent 实例</div>
            )}
          </div>
        </section>
        <section className="usagePanel">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Live Usage</p>
              <h3>Agent CLI / 模型调用统计</h3>
              <span className="usageScope">{usageScopeLabel}</span>
            </div>
            <div className="sectionActions">
              <span className="refreshBadge">{liveUsageRefreshLabel(usageRefreshIntervalMs)} · {usageGeneratedLabel}</span>
              <button type="button" className="secondary" onClick={() => refreshAgentCliUsage()}>
                刷新统计
              </button>
            </div>
          </div>
          {agentCliUsage ? (
            <>
              <div className="usageSummary">
                <StatusCard icon={<BarChart3 />} label="CLI Calls" value={String(agentCliUsage.totals.cliCalls)} tone="neutral" />
                <StatusCard icon={<Activity />} label={modelCallLabel()} value={String(agentCliUsage.totals.modelCalls)} tone="neutral" />
                <StatusCard icon={<CheckCircle2 />} label="Succeeded" value={String(agentCliUsage.totals.succeededCalls)} tone="good" />
                <StatusCard icon={<AlertTriangle />} label="Failed" value={String(agentCliUsage.totals.failedCalls)} tone={agentCliUsage.totals.failedCalls ? "bad" : "neutral"} />
              </div>
              <p className="usageNote">
                Model Calls 优先使用 CLI 输出的 DIONYSUS_USAGE_JSON 真实回执；缺少回执时，非 mock CLI run 按 1 次估算。
              </p>
              <div className="cliUsagePanel">
                <div className="subsectionTitle">
                  <strong>按 Agent 实例</strong>
                  <span>总 CLI 调用 / 模型调用 / 状态</span>
                </div>
                <div className="usageGrid">
                  {usageByAgentInstance.length ? (
                    usageByAgentInstance.map((usage) => (
                      <article key={usage.agentKey} className="usageCard">
                        <div className="usageCardHeader">
                          <div>
                            <strong>{usage.agentName}</strong>
                            <span>{roleLabels[usage.role]} · {usage.lastRunAt ? `最近 ${new Date(usage.lastRunAt).toLocaleTimeString()}` : "尚无调用"}</span>
                          </div>
                          <b>{cliCallTotalLabel(usage.cliCalls)}</b>
                        </div>
                        <div className="usageMetrics">
                          <span>{modelCallTotalLabel(usage.modelCalls)}</span>
                          <span>运行中 {usage.runningCalls}</span>
                          <span>失败 {usage.failedCalls}</span>
                        </div>
                        <div className="modelUsageList">
                          {usage.models.length ? (
                            usage.models.map((model) => (
                              <div key={`${usage.agentKey}-${model.cliType}-${model.cliModel}`} className="modelUsageRow">
                                <span>{model.cliType}</span>
                                <strong>{model.cliModel}</strong>
                                <em>{model.modelCalls}/{model.cliCalls}</em>
                              </div>
                            ))
                          ) : (
                            <div className="modelUsageEmpty">暂无 CLI run</div>
                          )}
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="modelUsageEmpty">暂无 Agent 实例调用数据</div>
                  )}
                </div>
              </div>
              <div className="subsectionTitle roleUsageTitle">
                <strong>按 Agent 角色</strong>
                <span>用于确认 Master / RuleWriter / TestWriter / Worker 是否都在推进</span>
              </div>
              <div className="usageGrid">
                {roleOrder.map((role) => {
                  const usage = usageByRole.get(role);
                  return (
                    <article key={role} className="usageCard">
                      <div className="usageCardHeader">
                        <div>
                          <strong>{roleLabels[role]}</strong>
                          <span>{usage?.lastRunAt ? `最近 ${new Date(usage.lastRunAt).toLocaleTimeString()}` : "尚无调用"}</span>
                        </div>
                        <b>{cliCallTotalLabel(usage?.cliCalls ?? 0)}</b>
                      </div>
                      <div className="usageMetrics">
                        <span>{modelCallTotalLabel(usage?.modelCalls ?? 0)}</span>
                        <span>运行中 {usage?.runningCalls ?? 0}</span>
                        <span>失败 {usage?.failedCalls ?? 0}</span>
                      </div>
                      <div className="modelUsageList">
                        {usage?.models.length ? (
                          usage.models.map((model) => (
                            <div key={`${role}-${model.cliType}-${model.cliModel}`} className="modelUsageRow">
                              <span>{model.cliType}</span>
                              <strong>{model.cliModel}</strong>
                              <em>{model.modelCalls}/{model.cliCalls}</em>
                            </div>
                          ))
                        ) : (
                          <div className="modelUsageEmpty">暂无 CLI run</div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="cliUsagePanel">
                <div className="subsectionTitle">
                  <strong>按 CLI 聚合</strong>
                  <span>模型调用 / CLI 调用</span>
                </div>
                <div className="cliUsageGrid">
                  {usageByCli.length ? (
                    usageByCli.map((usage) => (
                      <article key={usage.cliType} className="cliUsageCard">
                        <div>
                          <strong>{cliLabels[usage.cliType]}</strong>
                          <span>{usage.lastRunAt ? `最近 ${new Date(usage.lastRunAt).toLocaleTimeString()}` : "尚无调用"}</span>
                        </div>
                        <b>{usage.modelCalls}/{usage.cliCalls}</b>
                        <em>运行中 {usage.runningCalls} · 失败 {usage.failedCalls}</em>
                      </article>
                    ))
                  ) : (
                    <div className="modelUsageEmpty">暂无 CLI 聚合数据</div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="emptyState">尚未加载 Agent 调用统计</div>
          )}
        </section>
        <section className="preflightPanel">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Preflight</p>
              <h3>真实试运行门禁</h3>
            </div>
            <button type="button" onClick={executePreflight} disabled={preflightRunning || !activeGoalId}>
              {preflightRunning ? "检查中..." : "执行 Preflight"}
            </button>
          </div>
          {preflight ? (
            <div className={`preflightResult ${preflight.status}`}>
              <div className="preflightSummary">
                <StatusCard
                  icon={<GitCommit />}
                  label="Git"
                  value={preflight.git.clean ? "clean" : `${preflight.git.changes.length} changes`}
                  tone={preflight.git.clean ? "good" : "bad"}
                />
                <StatusCard
                  icon={<CheckCircle2 />}
                  label="Gates"
                  value={`${preflight.gates.filter((gate) => gate.status === "passed").length}/${preflight.gates.length}`}
                  tone={preflight.status === "passed" ? "good" : "bad"}
                />
              </div>
              <div className="blockerList">
                {preflight.blockers.length ? (
                  preflight.blockers.map((blocker) => <span key={blocker}>{blocker}</span>)
                ) : (
                  <span>全部门禁通过，可以进入真实试运行。</span>
                )}
              </div>
            </div>
          ) : (
            <div className="emptyState">尚未执行 preflight</div>
          )}
        </section>
        <section className="masterPanel">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Master</p>
              <h3>单步自动调度</h3>
            </div>
            <button type="button" onClick={runMasterAutopilotStep} disabled={masterStepping || !activeGoalId}>
              {masterStepping ? "运行中..." : "运行 Master Step"}
            </button>
          </div>
          {masterStep ? (
            <div className="masterStepResult">
              <strong>{masterStep.decision.action}</strong>
              <p>{masterStep.decision.reason}</p>
              {masterStep.blockers?.length ? <span>{masterStep.blockers.join("; ")}</span> : null}
            </div>
          ) : (
            <div className="emptyState">尚未执行 Master Step</div>
          )}
          <div className="masterEventList">
            {masterEvents.map((event) => (
              <article key={event.id} className="masterEvent">
                <div>
                  <strong>{event.eventType}</strong>
                  <span>{new Date(event.createdAt).toLocaleString()}</span>
                </div>
                <p>{describePayload(event.payload)}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="integrationPanel">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Integration</p>
              <h3>Patch 集成队列</h3>
            </div>
            <div className="sectionActions">
              <button type="button" className="secondary" onClick={() => refreshIntegrations()}>
                刷新队列
              </button>
              <button type="button" onClick={releaseIntegrations} disabled={releasing || !activeGoalId}>
                {releasing ? "发布中..." : "发布可集成项"}
              </button>
            </div>
          </div>
          {releaseResult?.status === "blocked" ? (
            <div className="errorBox">
              <AlertTriangle size={18} />
              <span>{releaseResult.blockers?.join("; ")}</span>
            </div>
          ) : null}
          <div className="integrationList">
            {integrations.length ? (
              integrations.map((integration) => (
                <article key={integration.id} className="integrationItem">
                  <div>
                    <strong>{integration.status}</strong>
                    <span>{new Date(integration.createdAt).toLocaleString()}</span>
                  </div>
                  <p>{integration.changedFiles.join(", ") || "无文件列表"}</p>
                  <span className="eventPill neutral">patch: {integration.patchStatus}</span>
                </article>
              ))
            ) : (
              <div className="emptyState">暂无 integration 记录</div>
            )}
          </div>
        </section>
        <section className="evidencePanel">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Release</p>
              <h3>Codex 发布记录</h3>
              <span className="releaseScope">
                {releaseRecordsScope === "current" ? "当前目标" : "当前目标暂无记录，显示全局最近记录"}
              </span>
            </div>
            <button type="button" className="secondary" onClick={() => refreshGoalEvidence()}>
              刷新发布记录
            </button>
          </div>
          <div className="releaseList">
            {releaseRecords.length ? (
              releaseRecords.map((record) => (
                <article key={record.id} className="releaseItem">
                  <div>
                    <strong>{record.status} · {record.branch}</strong>
                    <span>{new Date(record.createdAt).toLocaleString()}</span>
                  </div>
                  <p>{record.summary || "无发布摘要"}</p>
                  <div className="releaseMeta">
                    <span>commit {record.commitSha.slice(0, 12)}</span>
                    <span>{record.pushed ? "已推送" : "未推送"}</span>
                    <span>{record.changedFiles.length} files</span>
                    <span>{record.verification.length} checks</span>
                  </div>
                  {record.changedFiles.length ? <small>{record.changedFiles.join(", ")}</small> : null}
                </article>
              ))
            ) : (
              <div className="emptyState">暂无 Codex release record</div>
            )}
          </div>
        </section>
        <section className="evidencePanel">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Evidence</p>
              <h3>任务与运行证据</h3>
            </div>
            <button type="button" className="secondary" onClick={() => refreshGoalEvidence()}>
              刷新证据
            </button>
          </div>
          <div className="evidenceGrid">
            <div className="evidenceColumn">
              <h4>Tasks</h4>
              {tasks.length ? (
                tasks.map((task) => (
                  <article key={task.id} className="evidenceItem">
                    <div>
                      <strong>{task.title}</strong>
                      <span>{task.status}</span>
                    </div>
                    <p>{task.role_required} · priority {task.priority} · attempt {task.current_attempt}/{task.max_attempts}</p>
                    {task.blocked_reason ? <small>{task.blocked_reason}</small> : null}
                  </article>
                ))
              ) : (
                <div className="emptyState">暂无任务</div>
              )}
            </div>
            <div className="evidenceColumn">
              <h4>Runs</h4>
              {runs.length ? (
                runs.map((run) => (
                  <article key={run.id} className="evidenceItem">
                    <div>
                      <strong>{run.taskTitle}</strong>
                      <span>{run.status}{typeof run.exitCode === "number" ? ` / ${run.exitCode}` : ""}</span>
                    </div>
                    <p>{run.roleRequired} · {run.cliType} · {run.command}</p>
                    <button type="button" className="inlineAction" onClick={() => toggleRunLogs(run.id)}>
                      {loadingRunLogs === run.id ? "读取中..." : runLogs[run.id] ? "收起完整日志" : "查看完整日志"}
                    </button>
                    {runLogs[run.id] ? (
                      <div className="runLogBox">
                        {runLogs[run.id].length ? (
                          runLogs[run.id].map((log) => (
                            <pre key={log.id} className={log.stream === "stderr" ? "stderrLog" : "stdoutLog"}>
                              {`${log.stream} #${log.sequence}\n${log.chunkText}`}
                            </pre>
                          ))
                        ) : (
                          <small>该 run 暂无日志分片</small>
                        )}
                      </div>
                    ) : null}
                    {run.logPreview ? <pre>{run.logPreview}</pre> : null}
                  </article>
                ))
              ) : (
                <div className="emptyState">暂无运行记录</div>
              )}
            </div>
          </div>
        </section>
        <section className="milestonePanel">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Milestones / E2E</p>
              <h3>里程碑与浏览器验收证据</h3>
            </div>
            <button type="button" className="secondary" onClick={() => refreshGoalEvidence()}>
              刷新里程碑
            </button>
          </div>
          <div className="milestoneGrid">
            <div className="evidenceColumn">
              <h4>Milestones</h4>
              {milestones.length ? (
                milestones.map((milestone) => (
                  <article key={milestone.id} className="evidenceItem">
                    <div>
                      <strong>{milestone.name}</strong>
                      <span>{milestone.status}</span>
                    </div>
                    <p>{milestone.candidate_reason ?? milestone.description}</p>
                    {milestone.codex_verdict ? <small>Codex: {milestone.codex_verdict}</small> : null}
                  </article>
                ))
              ) : (
                <div className="emptyState">暂无 milestone</div>
              )}
            </div>
            <div className="evidenceColumn">
              <h4>E2E Campaigns</h4>
              {e2eCampaigns.length ? (
                e2eCampaigns.map((campaign) => (
                  <article key={campaign.id} className="evidenceItem">
                    <div>
                      <strong>{campaign.target_url ?? campaign.id}</strong>
                      <span>{campaign.status}</span>
                    </div>
                    <p>{campaign.case_count} cases · {new Date(campaign.updated_at).toLocaleString()}</p>
                  </article>
                ))
              ) : (
                <div className="emptyState">暂无 E2E campaign</div>
              )}
            </div>
            <div className="evidenceColumn">
              <h4>E2E Cases</h4>
              {e2eCases.length ? (
                e2eCases.map((testCase) => (
                  <article key={testCase.id} className="evidenceItem">
                    <div>
                      <strong>{testCase.caseType}</strong>
                      <span>{testCase.status}</span>
                    </div>
                    <p>{testCase.title}</p>
                    {testCase.failureReason ? <small>{testCase.failureReason}</small> : null}
                  </article>
                ))
              ) : (
                <div className="emptyState">暂无 E2E case</div>
              )}
            </div>
          </div>
        </section>
        <section className="agentsPanel">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Agents</p>
              <h3>角色 CLI 配置</h3>
            </div>
            <button type="button" className="secondary" onClick={runCliProbe} disabled={probing}>
              <Settings2 size={16} />
              {probing ? "探测中..." : "探测 CLI"}
            </button>
          </div>
          <div className="agentGrid">
            {roleOrder.map((role) => (
              <AgentConfigCard
                key={role}
                config={agentConfigs[role]}
                probeResults={probeResults}
                validation={modelValidations[role]}
                saving={savingRole === role}
                onChange={(patch) => updateRoleConfig(role, patch)}
                onSave={() => saveRoleConfig(role)}
              />
            ))}
          </div>
        </section>
        <section className="watchdogPanel">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Watchdog</p>
              <h3>停滞任务与自动修复</h3>
            </div>
            <div className="sectionActions">
              <button type="button" className="secondary" onClick={refreshWatchdogEvents}>
                刷新记录
              </button>
              <button type="button" onClick={executeWatchdog} disabled={watchdogRunning}>
                {watchdogRunning ? "巡检中..." : "立即巡检"}
              </button>
            </div>
          </div>
          <div className="watchdogSummary">
            <StatusCard
              icon={<Activity />}
              label="Checked"
              value={String(watchdogRun?.checked ?? watchdogEvents.length)}
              tone="neutral"
            />
            <StatusCard
              icon={<CheckCircle2 />}
              label="Retry"
              value={String(watchdogRun?.actions.filter((action) => action.decision.action === "retry").length ?? 0)}
              tone="good"
            />
            <StatusCard
              icon={<AlertTriangle />}
              label="Blocked"
              value={String(watchdogRun?.actions.filter((action) => action.decision.action === "block").length ?? 0)}
              tone="bad"
            />
          </div>
          <div className="watchdogList">
            {watchdogEvents.length ? (
              watchdogEvents.map((event) => <WatchdogEventRow key={event.id} event={event} />)
            ) : (
              <div className="emptyState">暂无 watchdog 事件</div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function FlowStatusNode({ data }: { data: Record<string, unknown> }) {
  const status = String(data.status ?? "unknown");
  return (
    <div className={`flowNode status-${status}`}>
      <Handle type="target" position={Position.Left} />
      <strong>{String(data.label ?? "Untitled")}</strong>
      <span>{status}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function StatusCard(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "neutral" | "good" | "bad";
}) {
  return (
    <div className={`statusCard ${props.tone}`}>
      {props.icon}
      <div>
        <span>{props.label}</span>
        <strong>{props.value}</strong>
      </div>
    </div>
  );
}

function AgentConfigCard(props: {
  config: AgentCliConfig;
  probeResults: CliProbeResult[];
  validation?: CliModelValidationResult;
  saving: boolean;
  onChange: (patch: Partial<AgentCliConfig>) => void;
  onSave: () => void;
}) {
  const probe = props.probeResults.find((result) => result.cliType === props.config.cliType);
  return (
    <article className="agentCard">
      <div className="agentCardTitle">
        <strong>{roleLabels[props.config.role]}</strong>
        <span className={probe?.available ? "probeGood" : probe ? "probeBad" : "probeUnknown"}>
          {probe ? (probe.available ? "可用" : "不可用") : "未探测"}
        </span>
      </div>
      <label>
        CLI
        <select
          value={props.config.cliType}
          onChange={(event) => props.onChange({ cliType: event.target.value as CliType })}
        >
          {cliTypes.map((cliType) => (
            <option key={cliType} value={cliType}>
              {cliType}
            </option>
          ))}
        </select>
      </label>
      <label>
        模型
        <input
          value={props.config.cliModel ?? ""}
          onChange={(event) => props.onChange({ cliModel: event.target.value || undefined })}
          placeholder={props.config.cliType === "opencode" ? "选择或填写 OpenCode 模型" : "默认模型"}
          list={`models-${props.config.role}`}
        />
        <datalist id={`models-${props.config.role}`}>
          {(probe?.models ?? []).map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </label>
      <label className="inlineToggle">
        <input
          type="checkbox"
          checked={props.config.enabled}
          onChange={(event) => props.onChange({ enabled: event.target.checked })}
        />
        启用
      </label>
      {props.validation ? (
        <div className={`modelValidation ${props.validation.available ? "passed" : "failed"}`}>
          <strong>{props.validation.available ? "模型可用" : "模型不可用"}</strong>
          <span>
            {props.validation.inputModel ?? "(默认)"} → {props.validation.resolvedModel ?? "(未解析)"}
          </span>
          {!props.validation.available && props.validation.suggestions?.length ? (
            <small>建议：{props.validation.suggestions.join(", ")}</small>
          ) : null}
        </div>
      ) : null}
      <button type="button" onClick={props.onSave} disabled={props.saving}>
        {props.saving ? "保存中..." : "保存配置"}
      </button>
    </article>
  );
}

function WatchdogEventRow({ event }: { event: WatchdogEvent }) {
  return (
    <article className="watchdogEvent">
      <div>
        <strong>{event.taskTitle ?? event.eventType}</strong>
        <span>{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="watchdogMeta">
        <span className={`eventPill ${event.eventType.includes("blocked") ? "bad" : "neutral"}`}>
          {event.eventType}
        </span>
        {event.roleRequired ? <span>{event.roleRequired}</span> : null}
        {event.taskStatus ? <span>{event.taskStatus}</span> : null}
      </div>
      <p>{event.blockedReason ?? describePayload(event.payload)}</p>
    </article>
  );
}

function describePayload(payload: Record<string, unknown>): string {
  const reason = payload.reason;
  if (typeof reason === "string") return reason;
  const checked = payload.checked;
  const retried = payload.retried;
  const blocked = payload.blocked;
  if (typeof checked === "number") {
    return `checked=${checked}, retried=${String(retried ?? 0)}, blocked=${String(blocked ?? 0)}`;
  }
  return JSON.stringify(payload);
}

const roleOrder: AgentRole[] = ["master", "rule_writer", "test_writer", "worker"];

const roleLabels: Record<AgentRole, string> = {
  master: "Master",
  rule_writer: "RuleWriter",
  test_writer: "TestWriter",
  worker: "Worker"
};

const cliTypes: CliType[] = ["mock", "claude_code", "gemini_cli", "opencode"];

const cliLabels: Record<CliType, string> = {
  mock: "Mock",
  claude_code: "Claude Code",
  gemini_cli: "Gemini CLI",
  opencode: "OpenCode"
};

const defaultAgentConfigs: Record<AgentRole, AgentCliConfig> = {
  master: { role: "master", cliType: "mock", enabled: true },
  rule_writer: { role: "rule_writer", cliType: "mock", enabled: true },
  test_writer: { role: "test_writer", cliType: "mock", enabled: true },
  worker: { role: "worker", cliType: "mock", enabled: true }
};
