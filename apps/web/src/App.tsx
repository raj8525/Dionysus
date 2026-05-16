import { useEffect, useState } from "react";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { Activity, AlertTriangle, CheckCircle2, GitCommit, Network } from "lucide-react";
import { createGoal, fetchCurrentFlow, type FlowResponse, type Goal } from "./api.js";

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

  useEffect(() => {
    refreshFlow()
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
      </section>
    </main>
  );
}

function FlowStatusNode({ data }: { data: Record<string, unknown> }) {
  const status = String(data.status ?? "unknown");
  return (
    <div className={`flowNode status-${status}`}>
      <strong>{String(data.label ?? "Untitled")}</strong>
      <span>{status}</span>
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
