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
  mode: "patch" | "report_only";
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
  dataOnly?: boolean;
}

export type FastLanePhase =
  | "closed"
  | "codex_outbox"
  | "blocked"
  | "working"
  | "worker_review"
  | "ready_for_data_followups"
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

export function isFastLaneReviewerTask(task: Record<string, unknown>): boolean {
  return String(task.title ?? "").startsWith("FastLane Reviewer");
}

export function isFastLaneWorkerTask(task: Record<string, unknown>): boolean {
  return String(task.title ?? "").startsWith("FastLane Worker");
}

export function extractFastLaneAdvanceTaskIds(summary: FastLaneStatusSummary): string[] {
  if (!["ready_for_data_followups", "ready_for_reviewer"].includes(summary.phase)) {
    return [];
  }
  return summary.nextCommands
    .map((command) => command.match(/task enqueue --task-id ([^\s]+)/)?.[1])
    .filter((taskId): taskId is string => Boolean(taskId));
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
  reportOnly?: boolean;
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
    mode: input.reportOnly ? "report_only" : "patch",
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
      input.reportOnly
        ? "Worker report-only 产出后，再对 Reviewer 任务运行 pnpm dionysus task enqueue --task-id <reviewer-task-id>"
        : "Worker 产出 patch 并完成 integration 后，再对 Reviewer 任务运行 pnpm dionysus task enqueue --task-id <reviewer-task-id>"
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
  const htmlTemplatePath = resolveCouponHtmlTemplatePath(pagePath, input.htmlTemplatePath);
  const maturePageGuard = buildCouponPageGuard(pagePath, htmlTemplatePath);
  const htmlTemplateFidelityGate = buildHtmlTemplateFidelityGate(pagePath, htmlTemplatePath);

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
        "- 输出 migration 文件、seed 覆盖说明、验证 SQL 或测试命令。",
        `- 验收命令必须以目标项目根目录 ${targetRoot} 为准，不能把 Dionysus 隔离 workspace 路径写入长期文档。`,
        "- PostgreSQL 验证必须同时给出两种方式：psql 直连命令，以及 `docker compose -f docker-compose.yml exec -T postgres psql -U coupon -d coupon ...` 容器内命令。",
        "- migration 必须幂等；如果重复执行，预期结果应为不重复插入并保持统计不变。"
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
        `- ${maturePageGuard}`,
        ...htmlTemplateFidelityGate.worker,
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
      input.dataOnly
        ? "执行原则：数据先行；本轮只生成数据库 migration/seed、规格和验收证据，不启动 API/Vue Worker。"
        : "执行原则：数据先行、先读后写；本轮只证明最终用户可通过前端读取完整数据库虚拟数据，写路径进入后续里程碑。"
    ].join("\n"),
    targetRoot,
    workers: input.dataOnly ? [workers[0]] : workers,
    reviewers: [{
      title: input.dataOnly
        ? `${moduleName} 数据基座 ReviewerCLI 90 分质量门禁`
        : `${moduleName} ReviewerCLI 90 分质量门禁`,
      description: [
        input.dataOnly ? "审查数据基座是否真正可用于目标项目主库验收。" : "审查数据先行和只读闭环是否真正成立。",
        "必须检查：",
        "- 数据库 migration/seed 是否覆盖页面所有展示字段。",
        input.dataOnly
          ? "- 验收命令必须以 Coupon 根目录为准，不能引用 Dionysus 隔离 workspace 路径。"
          : "- 只读 API 是否从 PostgreSQL 返回真实数据。",
        input.dataOnly
          ? "- PostgreSQL 验证必须提供 psql 与 docker compose 两种执行方式。"
          : "- Vue 页面是否动态读取接口数据，且没有 HTML 注入或主要静态假数据。",
        ...htmlTemplateFidelityGate.reviewer,
        input.dataOnly
          ? "- seed 必须幂等，能重复执行且不会重复插入。"
          : "- E2E/手工浏览器证据是否覆盖最终用户主路径和刷新持久性。",
        "- 写路径不得进入本轮范围。",
        "- 低于 90 分必须 BLOCKED 并列出具体返工项。"
      ].join("\n")
    }]
  });

  const stagedTasks = plan.tasks.map((task) => {
    if (task.lane !== "worker") return task;
    return {
      ...task,
      queue: task.title.includes("数据基座")
    };
  });

  return {
    ...plan,
    tasks: stagedTasks,
    nextCommands: [
      ...plan.nextCommands,
      input.dataOnly
        ? "data-only 模式不会创建 API/Vue Worker；Codex 审查数据基座后可直接运行 migration 和记录 release。"
        : "数据基座完成并由 Codex approve 后，才启动 API/Vue Worker。",
      `pnpm dionysus fastlane status --goal-id <goal-id>`,
      `pnpm dionysus agent usage --target-root ${targetRoot}`
    ]
  };
}

export function buildCouponPageGuard(pagePath: string, htmlTemplatePath?: string): string {
  if (pagePath.endsWith("tenants.vue")) {
    return "特别注意：tenants.vue 是成熟的集团租户管理页，只允许做数据字段、接口读取或小范围交互增量；不得按 hotels.html 或其他 HTML 模板重写布局，不得破坏左侧租户点击切换右侧详情。";
  }
  if (pagePath.endsWith("hotels.vue")) {
    return "特别注意：hotels.vue 当前管理真实酒店门店和部门，只允许围绕 tenant_stores / tenant_departments、/api/admin/hotels 和门店部门交互做增量；不得退回集团租户列表语义，不得复制旧租户页。";
  }
  if (htmlTemplatePath) {
    return "参考 HTML 模板时必须保留核心信息架构、视觉层级、内容密度、主次面板结构和关键交互位置，同时重写为 Vue 响应式数据和组件结构，不得注入整页 HTML，不得换成另一套视觉方案。";
  }
  return "按现有 Vue 页面和项目风格执行；必须重写为 Vue 响应式数据和组件结构，不得注入整页 HTML。";
}

export function isMatureCouponAdminPage(pagePath: string): boolean {
  return pagePath.endsWith("tenants.vue") || pagePath.endsWith("hotels.vue");
}

export function inferCouponHtmlTemplatePath(pagePath: string): string | undefined {
  if (isMatureCouponAdminPage(pagePath)) {
    return undefined;
  }
  const match = pagePath.match(/^apps\/admin-web\/src\/pages\/([^/]+)\.vue$/);
  if (!match) {
    return undefined;
  }
  return `apps/admin-web/html/${match[1]}.html`;
}

export function resolveCouponHtmlTemplatePath(pagePath: string, htmlTemplatePath?: string): string | undefined {
  if (isMatureCouponAdminPage(pagePath)) {
    return undefined;
  }
  return htmlTemplatePath?.trim() || inferCouponHtmlTemplatePath(pagePath);
}

export function buildHtmlTemplateFidelityGate(pagePath?: string, htmlTemplatePath?: string): {
  worker: string[];
  reviewer: string[];
} {
  if (pagePath && isMatureCouponAdminPage(pagePath)) {
    return { worker: [], reviewer: [] };
  }
  const templatePath = htmlTemplatePath?.trim();
  if (!templatePath) {
    return { worker: [], reviewer: [] };
  }
  return {
    worker: [
      "- HTML 模板结构一致性门禁：必须先阅读模板并在结果中列出保留的首屏结构、KPI/卡片/面板/表格/标签/按钮/筛选区、滚动区域和底部区域；如因真实业务逻辑调整，必须说明原因。",
      "- 视觉风格门禁：Vue 版本要保持模板的色彩体系、字体层级、边框/圆角、间距、信息密度和深浅面板比例；禁止把页面重做成另一套 glassmorphism、营销页或稀疏卡片风格。",
      "- 产品语义门禁：不得机械 100% 复刻 HTML；必须站在系统功能、信息架构和最终用户任务流角度分类交互意图。对象行、Tab、筛选 chip、详情卡片等上下文选择入口优先在当前 Vue 页面内更新右侧/下方详情；进入完整管理页、新增、编辑、审批、审计详情、导出等明确 CTA 才跳转子页面或打开真实弹窗。",
      "- 功能保真门禁：不得为了贴近模板删除或打乱既有真实功能入口；所有可见链接、按钮、Tab、卡片点击和新增/编辑/授权等入口必须指向已存在 Vue 路由或执行真实函数，不能留下假下拉、假按钮、不可达 URL 或只展示不工作的控件。",
      "- 浏览器证据门禁：必须新增或扩展 Playwright/E2E 检查，至少断言关键标题、主要分区数量、关键按钮/Tab/状态标签存在、无横向溢出、列表详情联动或刷新持久性；同时分别断言“页内上下文切换不突兀跳转”和“明确 CTA 能进入对应完整子页面/弹窗”。输出截图或说明截图路径。",
      `- 模板对照文件：${templatePath}`
    ],
    reviewer: [
      "- HTML 模板结构一致性是 90 分门禁的一部分：如果首屏信息架构、主面板布局、底部区域、按钮/Tab/筛选区、滚动区域或信息密度与模板明显不一致，必须 BLOCKED。",
      "- 产品语义是 90 分门禁的一部分：Reviewer 必须按最终用户任务流判断点击行为，不能用“所有点击都不跳转”或“所有模板链接都照抄跳转”这种机械规则放行；上下文选择应留在页面内，完整业务动作应进入子功能。",
      "- 功能入口保真是 90 分门禁的一部分：如果 Worker 只替换成模板外观，却丢失已有路由、按钮行为、列表详情联动、弹窗入口或写路径入口，必须 BLOCKED。",
      "- Reviewer 必须明确报告模板对照结论：保留了哪些结构、偏离了哪些结构、偏离是否有业务理由、是否存在横向溢出或文本挤压。",
      "- Reviewer 必须检查 Playwright/E2E 或浏览器截图证据；没有模板一致性、产品语义、页内上下文切换和明确 CTA 路由/弹窗断言或截图证据时，不得给 90 分以上。"
    ]
  };
}

function buildWorkerDescription(input: {
  title: string;
  description: string;
  targetRoot: string;
  reportOnly?: boolean;
}, worker: FastLaneItemInput, index: number): string {
  if (input.reportOnly) {
    return [
      `Fast lane worker slot: ${index}`,
      "",
      "Report-only mode: this task is a read-only audit or planning task.",
      `Goal: ${input.title.trim()}`,
      `Goal description: ${input.description.trim()}`,
      "",
      `Assigned work: ${worker.title}`,
      worker.description,
      "",
      "Hard rules:",
      "- Work only inside the Dionysus isolated workspace prepared for this task.",
      "- Do not modify files, generate patches, push, commit, reset, or directly edit the target main worktree.",
      "- No patch is required; the required artifact is a concrete report with evidence.",
      "- Use target project files, tests, docs, command names, and current runtime evidence as citations.",
      "- Separate proven completion, missing work, weak evidence, contradictions, risks, and recommended next owner.",
      "- Final line must be exactly: DIONYSUS_DONE_JSON={\"status\":\"done\",\"modelCalls\":1}.",
      "",
      "Output bar:",
      "- A concrete report with file paths, commands, evidence strength, risks, and next actions.",
      "- No generic advice without a traceable source or command."
    ].join("\n");
  }

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
    "- Final line must be exactly: DIONYSUS_DONE_JSON={\"status\":\"done\",\"modelCalls\":1}.",
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
  reportOnly?: boolean;
}, reviewer: FastLaneItemInput, index: number): string {
  if (input.reportOnly) {
    return [
      `Fast lane reviewer slot: ${index}`,
      "",
      "Report-only mode: review Worker reports, not integrated patches.",
      `Goal: ${input.title.trim()}`,
      `Goal description: ${input.description.trim()}`,
      "",
      `Review focus: ${reviewer.title}`,
      reviewer.description,
      "",
      "Hard rules:",
      "- Review only Worker report artifacts, cited evidence, logs, and commands.",
      "- Score the report from 0 to 100.",
      "- Below 90 is BLOCKED and must include concrete follow-up questions or rerun instructions for Worker.",
      "- 90 or above may be handed to Codex for final product decision, E2E planning, or next fast lane.",
      "- Do not require a code patch for report-only work.",
      "- If there is no Worker report yet, mark blocked; do not pretend to review.",
      "",
      "Required response format:",
      "Verdict: PASS|BLOCKED",
      "Score: <0-100>",
      "Evidence reviewed: <files/tests/logs/commands cited by Worker>",
      "Coverage gaps: <concrete list or none>",
      "Required fixes: <concrete list or none>",
      "Codex handoff: <what Codex must decide or verify next>"
    ].join("\n");
  }

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
      counts: {
        workers: {},
        reviewers: {},
        integrations: {},
        pendingCodexOutbox: input.pendingCodexOutbox.length
      },
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

  const dataFoundationDone = workerTasks.some((task) =>
    String(task.title ?? "").includes("数据基座") && String(task.status) === "done"
  );
  const dataFollowupWorkers = workerTasks.filter((task) =>
    String(task.status) === "created" &&
    (String(task.title ?? "").includes("只读 API") || String(task.title ?? "").includes("Vue 只读首页"))
  );
  if (dataFoundationDone && dataFollowupWorkers.length > 0) {
    return summary({
      goalId,
      goalStatus,
      phase: "ready_for_data_followups",
      nextAction: "数据基座已完成，可以并发启动只读 API 和 Vue 只读首页 Worker。",
      nextCommands: dataFollowupWorkers.map((task) => `pnpm dionysus task enqueue --task-id ${String(task.id)}`),
      counts,
      workerTasks,
      reviewerTasks
    });
  }

  const reviewersReady = reviewerTasks.filter((task) => String(task.status) === "created");
  const activeWorkerTasks = workerTasks.filter((task) => String(task.status) !== "cancelled");
  if (
    activeWorkerTasks.length > 0 &&
    activeWorkerTasks.every((task) => ["needs_review", "done"].includes(String(task.status))) &&
    reviewersReady.length > 0
  ) {
    return summary({
      goalId,
      goalStatus,
      phase: "ready_for_reviewer",
      nextAction: "Worker 产物已可审查，启动 ReviewerCLI 做 90 分质量门禁。",
      nextCommands: reviewersReady.map((task) => `pnpm dionysus task enqueue --task-id ${String(task.id)}`),
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
      nextAction: "存在阶段门禁需要 Codex 审查 Worker 产物，approve 后才能继续。",
      nextCommands: workersNeedingReview.map((task) =>
        `pnpm dionysus task review --task-id ${String(task.id)} --verdict approve --reason "Worker output accepted by Codex"`
      ),
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
