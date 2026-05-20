export type ReportOnlyReviewerVerdict = "PASS" | "BLOCKED";

export interface ReportOnlyReviewerOutputGateResult {
  allowed: boolean;
  reason?: string;
  missingFields?: string[];
  verdict?: ReportOnlyReviewerVerdict;
  score?: number;
}

const requiredReportOnlyReviewerFields = [
  "Verdict",
  "Score",
  "Evidence reviewed",
  "Coverage gaps",
  "Required fixes",
  "Codex handoff"
] as const;

export function evaluateReportOnlyReviewerOutputGate(input: {
  taskTitle?: string;
  taskDescription?: string;
  output: string;
}): ReportOnlyReviewerOutputGateResult {
  if (!isReportOnlyFastLaneReviewer(input.taskTitle, input.taskDescription)) {
    return { allowed: true };
  }

  const output = stripAnsi(input.output);
  const missingFields = requiredReportOnlyReviewerFields.filter((field) => !hasField(output, field));
  if (missingFields.length > 0) {
    return {
      allowed: false,
      reason: `Report-only FastLane Reviewer output is missing required fields: ${missingFields.join(", ")}.`,
      missingFields: [...missingFields]
    };
  }

  const verdict = parseVerdict(output);
  const score = parseScore(output);
  if (!verdict || score === undefined) {
    return {
      allowed: false,
      reason: "Report-only FastLane Reviewer output has invalid Verdict or Score.",
      missingFields: []
    };
  }

  return { allowed: true, verdict, score };
}

function isReportOnlyFastLaneReviewer(taskTitle?: string, taskDescription?: string): boolean {
  const title = taskTitle ?? "";
  const description = taskDescription ?? "";
  return title.startsWith("FastLane Reviewer") && /Report-only mode/i.test(description);
}

function hasField(output: string, field: string): boolean {
  return new RegExp(`(^|\\n)\\s*${escapeRegExp(field)}\\s*:`, "i").test(output);
}

function parseVerdict(output: string): ReportOnlyReviewerVerdict | undefined {
  const match = output.match(/(?:^|\n)\s*Verdict\s*:\s*(PASS|BLOCKED)\b/i);
  if (!match) return undefined;
  return match[1].toUpperCase() as ReportOnlyReviewerVerdict;
}

function parseScore(output: string): number | undefined {
  const match = output.match(/(?:^|\n)\s*Score\s*:\s*(\d{1,3})\b/i);
  if (!match) return undefined;
  const score = Number(match[1]);
  if (!Number.isInteger(score) || score < 0 || score > 100) return undefined;
  return score;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
