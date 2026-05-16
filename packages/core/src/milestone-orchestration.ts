import type { MilestoneStatus } from "./types.js";
import { assertMilestoneTransition } from "./state-machine.js";

export interface MilestoneDetectionInput {
  goalTitle: string;
  integrationStatus: "queued" | "running" | "passed" | "failed" | "cancelled";
  patchStatus: "created" | "queued" | "applied" | "rejected" | "failed";
  changedFiles: string[];
  testStatus: "passed" | "failed" | "blocked" | "missing";
}

export interface MilestoneCandidateDraft {
  shouldCreate: boolean;
  name: string;
  description: string;
  candidateReason: string;
}

export interface E2ECaseDraft {
  title: string;
  description: string;
  caseType: "smoke" | "happy_path" | "negative_path" | "persistence";
  preconditions: string;
  steps: string[];
  expectedResult: string;
}

export interface E2ECampaignDraft {
  targetUrl: string;
  cases: E2ECaseDraft[];
}

export function detectMilestoneCandidate(input: MilestoneDetectionInput): MilestoneCandidateDraft {
  const ready =
    input.integrationStatus === "passed" &&
    input.patchStatus === "applied" &&
    input.testStatus === "passed" &&
    input.changedFiles.length > 0;

  const changedSummary = `${input.changedFiles.length} changed files`;
  return {
    shouldCreate: ready,
    name: `${input.goalTitle} milestone: ${changedSummary} ready for Codex E2E`,
    description: ready
      ? `Integration passed with ${changedSummary}. Codex must run browser E2E before this milestone can be marked done.`
      : `Not ready for milestone. integration=${input.integrationStatus}, patch=${input.patchStatus}, tests=${input.testStatus}.`,
    candidateReason: ready
      ? `Patch applied, tests passed, and user-facing or backend changes exist: ${input.changedFiles.join(", ")}`
      : "Milestone gate is not satisfied."
  };
}

export function buildE2ECampaignDraft(input: {
  milestoneName: string;
  targetUrl: string;
  acceptance: string[];
}): E2ECampaignDraft {
  const acceptanceText = input.acceptance.join("\n");
  return {
    targetUrl: input.targetUrl,
    cases: [
      {
        title: `${input.milestoneName} smoke`,
        description: "打开应用并确认基础页面可渲染，无白屏和关键控制台错误。",
        caseType: "smoke",
        preconditions: "本地 API、前端、数据库和必要依赖已启动。",
        steps: ["打开目标 URL", "等待首屏渲染", "检查关键导航和主内容区域", "收集控制台错误"],
        expectedResult: "页面可用，主内容出现，无阻塞级浏览器错误。"
      },
      {
        title: `${input.milestoneName} happy path`,
        description: `按验收口径执行主路径。\n${acceptanceText}`,
        caseType: "happy_path",
        preconditions: "使用测试账号和测试数据，不触发生产级外部副作用。",
        steps: ["登录测试账号", "进入目标功能页面", "执行新增或变更操作", "确认成功提示和页面状态", "查询或刷新确认结果"],
        expectedResult: "主路径完成，用户可见状态与数据库事实一致。"
      },
      {
        title: `${input.milestoneName} negative path`,
        description: "覆盖必填缺失、重复提交、未授权或非法输入。",
        caseType: "negative_path",
        preconditions: "准备会触发校验失败的输入。",
        steps: ["进入目标功能页面", "提交非法或重复数据", "观察错误提示", "确认无脏数据写入"],
        expectedResult: "展示稳定错误提示或错误码，不产生错误数据。"
      },
      {
        title: `${input.milestoneName} refresh persistence`,
        description: "刷新、重新进入页面后验证结果仍可见。",
        caseType: "persistence",
        preconditions: "主路径已成功执行。",
        steps: ["刷新页面", "重新登录或重新进入目标页面", "查询刚才创建或修改的数据"],
        expectedResult: "结果持久存在，状态不依赖前端内存。"
      }
    ]
  };
}

export function buildMilestoneNotificationDraft(input: {
  milestoneName: string;
  summary: string;
  targetUrl: string;
  verificationCommands: string[];
  residualRisks: string[];
}): { title: string; body: string } {
  return {
    title: `[Dionysus] Milestone passed: ${input.milestoneName}`,
    body: [
      input.summary,
      "",
      "如何使用 / 如何验收:",
      `- 打开: ${input.targetUrl}`,
      ...input.verificationCommands.map((command) => `- 运行: ${command}`),
      "",
      "剩余风险:",
      ...(input.residualRisks.length ? input.residualRisks.map((risk) => `- ${risk}`) : ["- 无已知阻塞风险"])
    ].join("\n")
  };
}

export function milestoneStatusForCodexVerdict(
  currentStatus: MilestoneStatus,
  verdict: "passed" | "failed" | "blocked"
): MilestoneStatus {
  const nextStatus: MilestoneStatus =
    verdict === "passed" ? "passed" : verdict === "failed" ? "e2e_failed" : "e2e_blocked";
  assertMilestoneTransition(currentStatus, nextStatus);
  return nextStatus;
}
