const apiBase = process.env.DIONYSUS_API_BASE ?? "http://localhost:23100";

interface E2ECampaignRecord {
  id: string;
  target_url?: string;
  status: string;
}

interface E2ECaseRecord {
  id: string;
  title: string;
  caseType: string;
  status: string;
}

async function main(): Promise<void> {
  const [domain, action, ...args] = process.argv.slice(2);

  if (domain === "goal" && action === "create") {
    return print(await request("/api/goals", "POST", {
      title: readFlag(args, "--title") ?? "Untitled goal",
      description: readFlag(args, "--description") ?? readFlag(args, "--title") ?? "Untitled goal",
      targetRoot: readFlag(args, "--target-root") ?? process.env.TARGET_COUPON_ROOT ?? process.cwd()
    }));
  }

  if (domain === "goal" && action === "status") {
    const goalId = requiredFlag(args, "--goal-id");
    const [flow, tasks, runs, integrations, milestones] = await Promise.all([
      request(`/api/flow/goal/${goalId}`),
      request(`/api/tasks?goalId=${goalId}`),
      request(`/api/runs?goalId=${goalId}&limit=20`),
      request(`/api/integrations?goalId=${goalId}`),
      request(`/api/milestones?goalId=${goalId}`)
    ]);
    return print({ goalId, flow, tasks, runs, integrations, milestones });
  }

  if (domain === "goal" && action === "preflight") {
    return print(await request(`/api/goals/${requiredFlag(args, "--goal-id")}/preflight`, "POST"));
  }

  if (domain === "goal" && action === "master-step") {
    return print(await request(`/api/goals/${requiredFlag(args, "--goal-id")}/master-step`, "POST"));
  }

  if (domain === "goal" && action === "detect-milestones") {
    return print(await request(`/api/goals/${requiredFlag(args, "--goal-id")}/detect-milestones`, "POST"));
  }

  if (domain === "task" && action === "create") {
    return print(await request("/api/tasks", "POST", {
      goalId: requiredFlag(args, "--goal-id"),
      title: requiredFlag(args, "--title"),
      description: readFlag(args, "--description") ?? requiredFlag(args, "--title"),
      roleRequired: readFlag(args, "--role") ?? "worker",
      priority: optionalNumberFlag(args, "--priority")
    }));
  }

  if (domain === "milestone" && action === "request-e2e") {
    return print(await request(`/api/milestones/${requiredFlag(args, "--milestone-id")}/request-e2e`, "POST"));
  }

  if (domain === "milestone" && action === "create-campaign") {
    return print(await request(`/api/milestones/${requiredFlag(args, "--milestone-id")}/e2e-campaigns`, "POST", {
      targetUrl: requiredFlag(args, "--target-url"),
      acceptance: readRepeatedFlag(args, "--acceptance")
    }));
  }

  if (domain === "milestone" && action === "verdict") {
    return print(await request(`/api/milestones/${requiredFlag(args, "--milestone-id")}/codex-verdict`, "POST", {
      verdict: requiredFlag(args, "--verdict"),
      reason: requiredFlag(args, "--reason")
    }));
  }

  if (domain === "milestone" && action === "notify") {
    return print(await request(`/api/milestones/${requiredFlag(args, "--milestone-id")}/notifications`, "POST", {
      summary: requiredFlag(args, "--summary"),
      targetUrl: requiredFlag(args, "--target-url"),
      verificationCommands: readRepeatedFlag(args, "--verify"),
      residualRisks: readRepeatedFlag(args, "--risk")
    }));
  }

  if (domain === "e2e" && action === "cases") {
    return print(await request(`/api/e2e/campaigns/${requiredFlag(args, "--campaign-id")}/cases`));
  }

  if (domain === "e2e" && action === "case-result") {
    return print(await request(`/api/e2e/cases/${requiredFlag(args, "--case-id")}/result`, "POST", {
      status: requiredFlag(args, "--status"),
      failureReason: readFlag(args, "--failure-reason"),
      result: parseJsonFlag(args, "--result-json") ?? {}
    }));
  }

  if (domain === "e2e" && action === "run-campaign") {
    return print(await runE2ECampaign({
      campaignId: requiredFlag(args, "--campaign-id"),
      mode: (readFlag(args, "--mode") ?? "strict") as "strict" | "render-only",
      screenshotDir: readFlag(args, "--screenshot-dir") ?? ".dionysus/e2e"
    }));
  }

  if (domain === "notification" && action === "deliver") {
    return print(await request(`/api/notifications/${requiredFlag(args, "--notification-id")}/deliver`, "POST"));
  }

  usage();
  process.exitCode = 1;
}

async function runE2ECampaign(input: {
  campaignId: string;
  mode: "strict" | "render-only";
  screenshotDir: string;
}): Promise<Record<string, unknown>> {
  const campaigns = await request("/api/e2e/campaigns") as E2ECampaignRecord[];
  const campaign = campaigns.find((candidate) => candidate.id === input.campaignId);
  if (!campaign) {
    throw new Error(`campaign not found: ${input.campaignId}`);
  }
  if (!campaign.target_url) {
    throw new Error(`campaign has no target_url: ${input.campaignId}`);
  }

  const { chromium } = await import("playwright");
  const { mkdir } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  await mkdir(input.screenshotDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  const cases = await request(`/api/e2e/campaigns/${input.campaignId}/cases`) as E2ECaseRecord[];
  const results: Array<Record<string, unknown>> = [];
  try {
    for (const testCase of cases) {
      const result = await runE2ECase({
        page,
        targetUrl: campaign.target_url,
        testCase,
        mode: input.mode,
        screenshotDir: input.screenshotDir,
        consoleErrors
      });
      const recorded = await request(`/api/e2e/cases/${testCase.id}/result`, "POST", {
        status: result.status,
        failureReason: result.failureReason,
        result: result.evidence
      });
      results.push({ caseId: testCase.id, caseType: testCase.caseType, ...result, recorded });
    }
  } finally {
    await browser.close();
  }

  return {
    campaignId: input.campaignId,
    targetUrl: campaign.target_url,
    mode: input.mode,
    screenshotDir: resolve(input.screenshotDir),
    results
  };
}

async function runE2ECase(input: {
  page: import("playwright").Page;
  targetUrl: string;
  testCase: E2ECaseRecord;
  mode: "strict" | "render-only";
  screenshotDir: string;
  consoleErrors: string[];
}): Promise<{
  status: "passed" | "failed" | "blocked";
  failureReason?: string;
  evidence: Record<string, unknown>;
}> {
  const actionable = input.testCase.caseType === "smoke" || input.testCase.caseType === "persistence";
  if (!actionable && input.mode === "strict") {
    return {
      status: "blocked",
      failureReason: `caseType=${input.testCase.caseType} requires product-specific browser actions; rerun with --mode render-only only for static/document milestones, or record explicit case-result after Codex executes the workflow.`,
      evidence: {
        mode: input.mode,
        caseType: input.testCase.caseType,
        targetUrl: input.targetUrl
      }
    };
  }

  const beforeErrorCount = input.consoleErrors.length;
  await input.page.goto(input.targetUrl, { waitUntil: "networkidle" });
  if (input.testCase.caseType === "persistence") {
    await input.page.reload({ waitUntil: "networkidle" });
  }
  const title = await input.page.title();
  const bodyTextLength = await input.page.locator("body").innerText().then((text) => text.trim().length);
  const screenshotPath = `${input.screenshotDir}/${input.testCase.id}-${input.testCase.caseType}.png`;
  await input.page.screenshot({ path: screenshotPath, fullPage: false });
  const newConsoleErrors = input.consoleErrors.slice(beforeErrorCount);
  const failed = bodyTextLength === 0 || newConsoleErrors.length > 0;
  return {
    status: failed ? "failed" : "passed",
    failureReason: failed ? `bodyTextLength=${bodyTextLength}; consoleErrors=${newConsoleErrors.length}` : undefined,
    evidence: {
      mode: input.mode,
      caveat: !actionable && input.mode === "render-only"
        ? "render-only mode checks rendering only; it does not prove the product workflow."
        : undefined,
      caseType: input.testCase.caseType,
      targetUrl: input.targetUrl,
      title,
      bodyTextLength,
      consoleErrors: newConsoleErrors,
      screenshotPath
    }
  };
}

async function request(path: string, method = "GET", body?: unknown): Promise<unknown> {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(stripUndefined(body))
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
  }
  return payload;
}

function stripUndefined(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function requiredFlag(args: string[], name: string): string {
  const value = readFlag(args, name);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

function readRepeatedFlag(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) {
      values.push(args[index + 1]);
    }
  }
  return values;
}

function optionalNumberFlag(args: string[], name: string): number | undefined {
  const value = readFlag(args, name);
  return value ? Number(value) : undefined;
}

function parseJsonFlag(args: string[], name: string): Record<string, unknown> | undefined {
  const value = readFlag(args, name);
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function usage(): void {
  console.log(`Usage:
  pnpm goal:create -- --title "..." --description "..." --target-root "/path/to/project"
  tsx tools/dionysus.ts goal status --goal-id "..."
  tsx tools/dionysus.ts goal preflight --goal-id "..."
  tsx tools/dionysus.ts goal master-step --goal-id "..."
  tsx tools/dionysus.ts goal detect-milestones --goal-id "..."
  tsx tools/dionysus.ts task create --goal-id "..." --title "..." --role worker
  tsx tools/dionysus.ts milestone request-e2e --milestone-id "..."
  tsx tools/dionysus.ts milestone create-campaign --milestone-id "..." --target-url "..." --acceptance "..."
  tsx tools/dionysus.ts milestone verdict --milestone-id "..." --verdict passed --reason "..."
  tsx tools/dionysus.ts milestone notify --milestone-id "..." --summary "..." --target-url "..."
  tsx tools/dionysus.ts e2e cases --campaign-id "..."
  tsx tools/dionysus.ts e2e case-result --case-id "..." --status passed --result-json '{"note":"..."}'
  tsx tools/dionysus.ts e2e run-campaign --campaign-id "..." --mode strict
  tsx tools/dionysus.ts notification deliver --notification-id "..."
`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
