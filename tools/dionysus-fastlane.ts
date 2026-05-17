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
