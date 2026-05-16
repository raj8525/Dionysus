import { useEffect, useState } from "react";
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { Activity, AlertTriangle, CheckCircle2, GitCommit, Network, Settings2 } from "lucide-react";
import {
  createGoal,
  fetchAgentCliConfigs,
  fetchCurrentFlow,
  fetchE2ECampaigns,
  fetchE2ECases,
  fetchIntegrations,
  fetchMilestones,
  fetchRuns,
  fetchSystemHealth,
  fetchSystemEvents,
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
  type SystemEvent,
  type SystemHealth,
  type TaskRecord,
  type TaskRunRecord,
  type TargetPreflightResult,
  type WatchdogEvent,
  type WatchdogRunResult
} from "./api.js";
import { AgentConfigValidationError, saveValidatedAgentCliConfig } from "./agent-config-validation.js";
import { summarizeSystemHealth } from "./system-health.js";

const nodeTypes = {
  goal: FlowStatusNode,
  stage: FlowStatusNode,
  agent: FlowStatusNode,
  domain: FlowStatusNode
};

export function App() {
  const [flow, setFlow] = useState<FlowResponse>({ nodes: [], edges: [] });
  const [currentGoal, setCurrentGoal] = useState<Goal | null>(null);
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
  const [releasing, setReleasing] = useState(false);
  const [masterStep, setMasterStep] = useState<MasterStepResult | null>(null);
  const [masterStepping, setMasterStepping] = useState(false);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [runs, setRuns] = useState<TaskRunRecord[]>([]);
  const [masterEvents, setMasterEvents] = useState<SystemEvent[]>([]);
  const [milestones, setMilestones] = useState<MilestoneRecord[]>([]);
  const [e2eCampaigns, setE2ECampaigns] = useState<E2ECampaignRecord[]>([]);
  const [e2eCases, setE2ECases] = useState<E2ECaseRecord[]>([]);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);

  useEffect(() => {
    Promise.all([refreshFlow(), refreshAgentConfigs(), refreshWatchdogEvents(), refreshSystemHealth()])
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (activeGoalId) {
      refreshGoalEvidence(activeGoalId)
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    }
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
    setActiveGoalId(goalNode?.data?.goalId ?? null);
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
      await refreshFlow();
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
    const [nextIntegrations, nextTasks, nextRuns, nextMasterEvents, nextMilestones] = await Promise.all([
      fetchIntegrations(goalId),
      fetchTasks(goalId),
      fetchRuns(goalId, 20),
      fetchSystemEvents("master_control.", 10),
      fetchMilestones(goalId)
    ]);
    setIntegrations(nextIntegrations);
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

const defaultAgentConfigs: Record<AgentRole, AgentCliConfig> = {
  master: { role: "master", cliType: "mock", enabled: true },
  rule_writer: { role: "rule_writer", cliType: "mock", enabled: true },
  test_writer: { role: "test_writer", cliType: "mock", enabled: true },
  worker: { role: "worker", cliType: "mock", enabled: true }
};
