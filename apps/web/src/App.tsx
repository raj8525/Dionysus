import { useEffect, useState } from "react";
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { Activity, AlertTriangle, CheckCircle2, GitCommit, Network, Settings2 } from "lucide-react";
import {
  createGoal,
  fetchAgentCliConfigs,
  fetchCurrentFlow,
  fetchWatchdogEvents,
  probeClis,
  runWatchdog,
  saveAgentCliConfig,
  type AgentCliConfig,
  type AgentRole,
  type CliProbeResult,
  type CliType,
  type FlowResponse,
  type Goal,
  type WatchdogEvent,
  type WatchdogRunResult
} from "./api.js";

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
  const [probing, setProbing] = useState(false);
  const [watchdogEvents, setWatchdogEvents] = useState<WatchdogEvent[]>([]);
  const [watchdogRun, setWatchdogRun] = useState<WatchdogRunResult | null>(null);
  const [watchdogRunning, setWatchdogRunning] = useState(false);

  useEffect(() => {
    Promise.all([refreshFlow(), refreshAgentConfigs(), refreshWatchdogEvents()])
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function refreshFlow() {
    const nextFlow = await fetchCurrentFlow();
    setFlow(nextFlow);
    const goalNode = nextFlow.nodes.find((candidate) => {
      const node = candidate as { id?: string };
      return node.id === "goal";
    }) as { data?: { label?: string } } | undefined;
    if (goalNode?.data?.label) {
      setFlowGoalTitle(goalNode.data.label);
    }
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
      const saved = await saveAgentCliConfig(agentConfigs[role]);
      setAgentConfigs((current) => ({ ...current, [role]: saved }));
    } catch (err) {
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

  function updateRoleConfig(role: AgentRole, patch: Partial<AgentCliConfig>) {
    setAgentConfigs((current) => ({
      ...current,
      [role]: {
        ...current[role],
        ...patch
      }
    }));
  }

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
            <StatusCard icon={<Activity />} label="Workers" value="0 / 4" tone="neutral" />
            <StatusCard icon={<GitCommit />} label="main" value="pending" tone="neutral" />
            <StatusCard icon={<CheckCircle2 />} label="E2E" value="waiting" tone="neutral" />
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
