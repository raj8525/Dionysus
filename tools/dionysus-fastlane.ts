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

export interface CouponDataFirstFastLaneInput {
  module: string;
  title: string;
  description: string;
  targetRoot: string;
  pagePath: string;
  apiPath: string;
  htmlTemplatePath?: string;
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

export function buildCouponDataFirstFastLanePlan(input: CouponDataFirstFastLaneInput): FastLanePlan {
  const moduleName = requireNonEmpty(input.module, "coupon module is required");
  const title = requireNonEmpty(input.title, "coupon fast lane title is required");
  const description = requireNonEmpty(input.description, "coupon fast lane description is required");
  const targetRoot = requireNonEmpty(input.targetRoot, "coupon fast lane targetRoot is required");
  const pagePath = requireNonEmpty(input.pagePath, "coupon page path is required");
  const apiPath = requireNonEmpty(input.apiPath, "coupon API path is required");
  const htmlTemplatePath = input.htmlTemplatePath?.trim();
  const hotelsGuard = pagePath.endsWith("hotels.vue")
    ? "特别注意：hotels.vue 已经是成熟页面，只允许做数据字段、接口读取或小范围交互增量；不得按 hotels.html 重写布局，不得破坏左侧租户点击切换右侧详情。"
    : "参考 HTML 模板时只能理解信息架构和视觉风格，必须重写为 Vue 响应式数据和组件结构，不得注入整页 HTML。";

  const workers: FastLaneItemInput[] = [
    {
      title: `${moduleName} 数据基座`,
      description: [
        "允许修改路径:",
        "- migrations/",
        "- docs/specs/",
        "- docs/contracts/",
        "- docs/domains/",
        "- features_test/",
        "",
        "任务：先补数据库表结构和完整虚拟数据，保证本模块首页该展示的数据在 PostgreSQL 中都有事实来源。",
        "要求：",
        "- 只做数据基座和只读验收准备，不实现写路径。",
        "- seed 必须覆盖页面首屏、列表、详情、状态、统计、空态/异常态可验证数据。",
        "- 更新或补充 docs/specs / contracts / features_test，写清覆盖的字段和验收查询。",
        "- 输出 migration 文件、seed 覆盖说明、验证 SQL 或测试命令。"
      ].join("\n")
    },
    {
      title: `${moduleName} 只读 API`,
      description: [
        "允许修改路径:",
        "- apps/admin-api/",
        "- docs/specs/",
        "- docs/contracts/",
        "- features_test/",
        "",
        `任务：实现或补齐只读 API ${apiPath}，让页面需要展示的数据全部来自 PostgreSQL。`,
        "要求：",
        "- 先读后写，本轮禁止新增创建、编辑、删除等写接口。",
        "- 补齐 handler/service/repository 测试，至少覆盖成功、未登录/无权限、空结果、关键字段完整性。",
        "- 响应字段必须与契约和 Vue 页面需要展示的数据一致。",
        "- 输出测试命令、字段覆盖清单、风险。"
      ].join("\n")
    },
    {
      title: `${moduleName} Vue 只读首页`,
      description: [
        "允许修改路径:",
        `- ${pagePath}`,
        `- ${pagePath.replace(/\.vue$/, "/")}`,
        "- apps/admin-web/src/router/",
        "- apps/admin-web/src/services/",
        "- apps/admin-web/tests/",
        "- docs/qa/",
        "",
        `任务：把 ${pagePath} 接到真实只读 API ${apiPath}，让最终用户看到数据库中的完整虚拟数据。`,
        htmlTemplatePath ? `参考模板：${htmlTemplatePath}` : "参考模板：按现有 Vue 页面和项目风格执行。",
        "要求：",
        "- Vue 页面必须读取真实接口数据，不能保留固定假数据作为主要展示来源。",
        "- 禁止 v-html、raw HTML import、长字符串整页模板、把 HTML 文件直接塞进 Vue。",
        "- 必须实现 loading、error、empty state、刷新后数据仍一致的行为。",
        "- 必须保留既有成熟交互；如果是列表详情页，点击左侧列表必须更新右侧详情。",
        `- ${hotelsGuard}`,
        "- 输出浏览器验收步骤、截图路径或 Playwright/E2E 命令。"
      ].join("\n")
    }
  ];

  const plan = buildFastLanePlan({
    title,
    description: [
      description,
      "",
      `Coupon module: ${moduleName}`,
      "执行原则：数据先行、先读后写；本轮只证明最终用户可通过前端读取完整数据库虚拟数据，写路径进入后续里程碑。"
    ].join("\n"),
    targetRoot,
    workers,
    reviewers: [{
      title: `${moduleName} ReviewerCLI 90 分质量门禁`,
      description: [
        "审查数据先行和只读闭环是否真正成立。",
        "必须检查：",
        "- 数据库 migration/seed 是否覆盖页面所有展示字段。",
        "- 只读 API 是否从 PostgreSQL 返回真实数据。",
        "- Vue 页面是否动态读取接口数据，且没有 HTML 注入或主要静态假数据。",
        "- E2E/手工浏览器证据是否覆盖最终用户主路径和刷新持久性。",
        "- 写路径不得进入本轮范围。",
        "- 低于 90 分必须 BLOCKED 并列出具体返工项。"
      ].join("\n")
    }]
  });

  return {
    ...plan,
    nextCommands: [
      ...plan.nextCommands,
      `pnpm dionysus fastlane status --goal-id <goal-id>`,
      `pnpm dionysus agent usage --target-root ${targetRoot}`
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

function requireNonEmpty(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(message);
  }
  return trimmed;
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
        `pnpm dionysus task review --task-id ${String(task.id)} --verdict approve --score 90 --reason "Reviewer gate accepted by Codex"`
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
