export interface FastLaneItemInput {
  title: string;
  description: string;
}

export interface FastLaneTaskPlan {
  lane: "worker" | "reviewer";
  title: string;
  description: string;
  roleRequired: "worker";
  priority: number;
  queue: boolean;
}

export interface FastLanePlan {
  goal: {
    title: string;
    description: string;
    targetRoot: string;
  };
  tasks: FastLaneTaskPlan[];
  nextCommands: string[];
}

export type FastLanePhase =
  | "closed"
  | "codex_outbox"
  | "blocked"
  | "working"
  | "worker_review"
  | "waiting_for_integration"
  | "ready_for_reviewer"
  | "reviewer_review"
  | "codex_final"
  | "idle";

export interface FastLaneStatusInput {
  goal: Record<string, unknown>;
  tasks: Array<Record<string, unknown>>;
  integrations: Array<Record<string, unknown>>;
  pendingCodexOutbox: Array<Record<string, unknown>>;
}

export interface FastLaneStatusSummary {
  goalId: string;
  goalStatus: string;
  phase: FastLanePhase;
  nextAction: string;
  nextCommands: string[];
  counts: {
    workers: Record<string, number>;
    reviewers: Record<string, number>;
    integrations: Record<string, number>;
    pendingCodexOutbox: number;
  };
  workerTasks: Array<Record<string, unknown>>;
  reviewerTasks: Array<Record<string, unknown>>;
}

export function parseFastLaneItem(value: string): FastLaneItemInput {
  const [rawTitle, ...descriptionParts] = value.split("::");
  const title = rawTitle.trim();
  const description = descriptionParts.join("::").trim() || title;
  if (!title) {
    throw new Error("fast lane item title cannot be empty");
  }
  return { title, description };
}

export function buildFastLanePlan(input: {
  title: string;
  description: string;
  targetRoot: string;
  workers: FastLaneItemInput[];
  reviewers?: FastLaneItemInput[];
  queueReviewers?: boolean;
}): FastLanePlan {
  if (!input.title.trim()) {
    throw new Error("fast lane title is required");
  }
  if (!input.description.trim()) {
    throw new Error("fast lane description is required");
  }
  if (!input.targetRoot.trim()) {
    throw new Error("fast lane targetRoot is required");
  }
  if (input.workers.length === 0) {
    throw new Error("fast lane requires at least one --worker item");
  }

  const workerTasks = input.workers.map((worker, index): FastLaneTaskPlan => ({
    lane: "worker",
    title: `FastLane Worker ${index + 1}: ${worker.title}`,
    description: buildWorkerDescription(input, worker, index + 1),
    roleRequired: "worker",
    priority: 20 + index,
    queue: true
  }));

  const reviewers = input.reviewers?.length
    ? input.reviewers
    : [{
      title: "ReviewerCLI 90 分质量门禁",
      description: "审查所有 Worker 产物，按正确性、契约、测试、UI 一致性和可合并性打分；低于 90 分必须退回 Worker 迭代。"
    }];
  const reviewerTasks = reviewers.map((reviewer, index): FastLaneTaskPlan => ({
    lane: "reviewer",
    title: `FastLane Reviewer ${index + 1}: ${reviewer.title}`,
    description: buildReviewerDescription(input, reviewer, index + 1),
    roleRequired: "worker",
    priority: 80 + index,
    queue: input.queueReviewers ?? false
  }));

  return {
    goal: {
      title: input.title.trim(),
      description: input.description.trim(),
      targetRoot: input.targetRoot.trim()
    },
    tasks: [...workerTasks, ...reviewerTasks],
    nextCommands: [
      "pnpm dionysus agent status --goal-id <goal-id>",
      "pnpm dionysus agent usage --goal-id <goal-id>",
      "pnpm dionysus codex heartbeat --limit 5",
      "Worker 产出 patch 并完成 integration 后，再对 Reviewer 任务运行 pnpm dionysus task enqueue --task-id <reviewer-task-id>"
    ]
  };
}

function buildWorkerDescription(input: {
  title: string;
  description: string;
  targetRoot: string;
}, worker: FastLaneItemInput, index: number): string {
  return [
    `Fast lane worker slot: ${index}`,
    "",
    `Goal: ${input.title.trim()}`,
    `Goal description: ${input.description.trim()}`,
    "",
    `Assigned work: ${worker.title}`,
    worker.description,
    "",
    "Hard rules:",
    "- Work only inside the Dionysus isolated workspace prepared for this task.",
    "- Do not push, commit, reset, or directly edit the target main worktree.",
    "- Preserve SDD/TDD evidence: update docs/specs or features_test when behavior or contract changes.",
    "- Produce the smallest reviewable patch for the assigned file/function boundary.",
    "- Report changed files, test commands, test results, risks, and next suggested owner.",
    "- If a real CLI can report model usage, print one line: DIONYSUS_USAGE_JSON={\"modelCalls\":1}.",
    "",
    "Output bar:",
    "- A patch or clear blocked reason.",
    "- No generic advice without a concrete artifact."
  ].join("\n");
}

function buildReviewerDescription(input: {
  title: string;
  description: string;
  targetRoot: string;
}, reviewer: FastLaneItemInput, index: number): string {
  return [
    `Fast lane reviewer slot: ${index}`,
    "",
    `Goal: ${input.title.trim()}`,
    `Goal description: ${input.description.trim()}`,
    "",
    `Review focus: ${reviewer.title}`,
    reviewer.description,
    "",
    "Hard rules:",
    "- Review only integrated Worker output or explicitly provided patches.",
    "- Score the result from 0 to 100.",
    "- Below 90 is BLOCKED and must include concrete fix instructions for Worker.",
    "- 90 or above may be handed to Codex for final tests, browser E2E, commit, push, and user notification.",
    "- Verify contract, tests, UI parity, real data path, and merge safety.",
    "- If there is no Worker artifact yet, mark blocked; do not pretend to review.",
    "",
    "Required response format:",
    "Verdict: PASS|BLOCKED",
    "Score: <0-100>",
    "Evidence: <files/tests/screenshots/logs>",
    "Required fixes: <concrete list or none>",
    "Codex handoff: <what Codex must verify next>"
  ].join("\n");
}

export function buildFastLaneStatus(input: FastLaneStatusInput): FastLaneStatusSummary {
  const goalId = String(input.goal.id ?? "");
  const goalStatus = String(input.goal.status ?? "unknown");
  const workerTasks = input.tasks.filter((task) => String(task.title ?? "").startsWith("FastLane Worker"));
  const reviewerTasks = input.tasks.filter((task) => String(task.title ?? "").startsWith("FastLane Reviewer"));
  const counts = {
    workers: countByStatus(workerTasks),
    reviewers: countByStatus(reviewerTasks),
    integrations: countByStatus(input.integrations),
    pendingCodexOutbox: input.pendingCodexOutbox.length
  };

  if (["done", "failed", "cancelled"].includes(goalStatus)) {
    return summary({
      goalId,
      goalStatus,
      phase: "closed",
      nextAction: "fast lane goal 已结束，无需继续调度。",
      nextCommands: [],
      counts,
      workerTasks,
      reviewerTasks
    });
  }

  if (input.pendingCodexOutbox.length > 0) {
    return summary({
      goalId,
      goalStatus,
      phase: "codex_outbox",
      nextAction: "先处理 Codex Outbox，再继续 fast lane。",
      nextCommands: ["pnpm dionysus codex heartbeat --limit 5"],
      counts,
      workerTasks,
      reviewerTasks
    });
  }

  if (hasAnyStatus([...workerTasks, ...reviewerTasks], ["blocked", "failed"])) {
    return summary({
      goalId,
      goalStatus,
      phase: "blocked",
      nextAction: "存在 blocked/failed 任务，先查看任务日志和 Codex Outbox。",
      nextCommands: [
        `pnpm dionysus goal status --goal-id ${goalId}`,
        "pnpm dionysus codex heartbeat --limit 5"
      ],
      counts,
      workerTasks,
      reviewerTasks
    });
  }

  if (hasAnyStatus([...workerTasks, ...reviewerTasks], ["queued", "running"])) {
    return summary({
      goalId,
      goalStatus,
      phase: "working",
      nextAction: "已有 Agent 正在工作或排队，继续监控运行和成本。",
      nextCommands: [
        `pnpm dionysus agent status --goal-id ${goalId}`,
        `pnpm dionysus agent usage --goal-id ${goalId}`
      ],
      counts,
      workerTasks,
      reviewerTasks
    });
  }

  const workersNeedingReview = workerTasks.filter((task) => String(task.status) === "needs_review");
  if (workersNeedingReview.length > 0) {
    return summary({
      goalId,
      goalStatus,
      phase: "worker_review",
      nextAction: "先评审 Worker 产物，approve 后才能启动 ReviewerCLI。",
      nextCommands: workersNeedingReview.map((task) =>
        `pnpm dionysus task review --task-id ${String(task.id)} --verdict approve --reason "Worker output accepted by Codex"`
      ),
      counts,
      workerTasks,
      reviewerTasks
    });
  }

  if (hasAnyStatus(input.integrations, ["created", "queued", "running"])) {
    return summary({
      goalId,
      goalStatus,
      phase: "waiting_for_integration",
      nextAction: "等待 integration queue 应用并验证 Worker patch。",
      nextCommands: [`pnpm dionysus integration list --goal-id ${goalId}`],
      counts,
      workerTasks,
      reviewerTasks
    });
  }

  const reviewersReady = reviewerTasks.filter((task) => String(task.status) === "created");
  if (workerTasks.length > 0 && workerTasks.every((task) => String(task.status) === "done") && reviewersReady.length > 0) {
    return summary({
      goalId,
      goalStatus,
      phase: "ready_for_reviewer",
      nextAction: "Worker 已完成，启动 ReviewerCLI 做 90 分质量门禁。",
      nextCommands: reviewersReady.map((task) => `pnpm dionysus task enqueue --task-id ${String(task.id)}`),
      counts,
      workerTasks,
      reviewerTasks
    });
  }

  const reviewersNeedingReview = reviewerTasks.filter((task) => String(task.status) === "needs_review");
  if (reviewersNeedingReview.length > 0) {
    return summary({
      goalId,
      goalStatus,
      phase: "reviewer_review",
      nextAction: "审查 ReviewerCLI 报告；90 分以下 reject，90 分以上进入 Codex 最终 E2E/发布。",
      nextCommands: reviewersNeedingReview.flatMap((task) => [
        `pnpm dionysus run logs --run-id <run-id-for-task-${String(task.id)}>`,
        `pnpm dionysus task review --task-id ${String(task.id)} --verdict approve --reason "Reviewer gate accepted by Codex"`
      ]),
      counts,
      workerTasks,
      reviewerTasks
    });
  }

  if (reviewerTasks.length > 0 && reviewerTasks.every((task) => String(task.status) === "done")) {
    return summary({
      goalId,
      goalStatus,
      phase: "codex_final",
      nextAction: "Reviewer 门禁已完成，Codex 执行最终测试、浏览器 E2E、提交和通知。",
      nextCommands: [
        `pnpm dionysus goal release-ready --goal-id ${goalId}`,
        "pnpm dionysus codex heartbeat --limit 5"
      ],
      counts,
      workerTasks,
      reviewerTasks
    });
  }

  return summary({
    goalId,
    goalStatus,
    phase: "idle",
    nextAction: "没有可自动判断的 fast lane 下一步，查看 goal status。",
    nextCommands: [`pnpm dionysus goal status --goal-id ${goalId}`],
    counts,
    workerTasks,
    reviewerTasks
  });
}

function summary(input: FastLaneStatusSummary): FastLaneStatusSummary {
  return input;
}

function countByStatus(items: Array<Record<string, unknown>>): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const status = String(item.status ?? "unknown");
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
}

function hasAnyStatus(items: Array<Record<string, unknown>>, statuses: string[]): boolean {
  const statusSet = new Set(statuses);
  return items.some((item) => statusSet.has(String(item.status ?? "unknown")));
}
