export type FastLaneReviewerVerdict = "PASS" | "BLOCKED";

export interface FastLaneReviewerOutputGateResult {
  allowed: boolean;
  reason?: string;
  missingFields?: string[];
  verdict?: FastLaneReviewerVerdict;
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

const requiredPatchReviewerFields = [
  "Verdict",
  "Score",
  "Evidence",
  "Product/UX assessment",
  "Required fixes",
  "Codex handoff"
] as const;

export function evaluateFastLaneReviewerOutputGate(input: {
  taskTitle?: string;
  taskDescription?: string;
  output: string;
}): FastLaneReviewerOutputGateResult {
  if (!isFastLaneReviewer(input.taskTitle)) {
    return { allowed: true };
  }

  return isReportOnlyFastLaneReviewer(input.taskDescription)
    ? evaluateRequiredFields({
      output: input.output,
      requiredFields: requiredReportOnlyReviewerFields,
      missingReasonPrefix: "Report-only FastLane Reviewer output",
      invalidReason: "Report-only FastLane Reviewer output has invalid Verdict or Score."
    })
    : evaluateRequiredFields({
      output: input.output,
      requiredFields: requiredPatchReviewerFields,
      missingReasonPrefix: "FastLane Reviewer output",
      invalidReason: "FastLane Reviewer output has invalid Verdict or Score."
    });
}

export function evaluateReportOnlyReviewerOutputGate(input: {
  taskTitle?: string;
  taskDescription?: string;
  output: string;
}): FastLaneReviewerOutputGateResult {
  if (!isFastLaneReviewer(input.taskTitle) || !isReportOnlyFastLaneReviewer(input.taskDescription)) {
    return { allowed: true };
  }
  return evaluateRequiredFields({
    output: input.output,
    requiredFields: requiredReportOnlyReviewerFields,
    missingReasonPrefix: "Report-only FastLane Reviewer output",
    invalidReason: "Report-only FastLane Reviewer output has invalid Verdict or Score."
  });
}

function evaluateRequiredFields(input: {
  output: string;
  requiredFields: readonly string[];
  missingReasonPrefix: string;
  invalidReason: string;
}): FastLaneReviewerOutputGateResult {
  const output = stripAnsi(input.output);
  const missingFields = input.requiredFields.filter((field) => !hasField(output, field));
  if (missingFields.length > 0) {
    return {
      allowed: false,
      reason: `${input.missingReasonPrefix} is missing required fields: ${missingFields.join(", ")}.`,
      missingFields: [...missingFields]
    };
  }

  const verdict = parseVerdict(output);
  const score = parseScore(output);
  if (!verdict || score === undefined) {
    return {
      allowed: false,
      reason: input.invalidReason,
      missingFields: []
    };
  }

  return { allowed: true, verdict, score };
}

function isFastLaneReviewer(taskTitle?: string): boolean {
  const title = taskTitle ?? "";
  return title.startsWith("FastLane Reviewer");
}

function isReportOnlyFastLaneReviewer(taskDescription?: string): boolean {
  const description = taskDescription ?? "";
  return /Report-only mode/i.test(description);
}

function hasField(output: string, field: string): boolean {
  return new RegExp(`(^|\\n)\\s*${escapeRegExp(field)}\\s*:`, "i").test(output);
}

function parseVerdict(output: string): FastLaneReviewerVerdict | undefined {
  const match = output.match(/(?:^|\n)\s*Verdict\s*:\s*(PASS|BLOCKED)\b/i);
  if (!match) return undefined;
  return match[1].toUpperCase() as FastLaneReviewerVerdict;
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
