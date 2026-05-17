export interface CouponDataFirstGateTask {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  role_required?: unknown;
}

export interface CouponDataFirstGateResult {
  allowed: boolean;
  error?: "COUPON_DATA_FIRST_GATE_BLOCKED";
  reason?: string;
}

const blockedReason = "Coupon 数据先行门禁阻止提前入队：数据基座 Worker 未完成，不能启动只读 API 或 Vue 只读首页。";

export function evaluateCouponDataFirstEnqueueGate(input: {
  task: CouponDataFirstGateTask;
  goalTasks: CouponDataFirstGateTask[];
}): CouponDataFirstGateResult {
  const taskTitle = String(input.task.title ?? "");
  const isReadPathWorker = taskTitle.startsWith("FastLane Worker") &&
    (taskTitle.includes("只读 API") || taskTitle.includes("Vue 只读首页"));
  if (!isReadPathWorker) {
    return { allowed: true };
  }

  const dataFoundationDone = input.goalTasks.some((task) =>
    String(task.title ?? "").startsWith("FastLane Worker") &&
    String(task.title ?? "").includes("数据基座") &&
    String(task.status ?? "") === "done"
  );
  if (dataFoundationDone) {
    return { allowed: true };
  }

  return {
    allowed: false,
    error: "COUPON_DATA_FIRST_GATE_BLOCKED",
    reason: blockedReason
  };
}

export function selectCouponDataFirstFollowupTasks(input: {
  reviewedTask: CouponDataFirstGateTask;
  goalTasks: CouponDataFirstGateTask[];
}): CouponDataFirstGateTask[] {
  const reviewedTitle = String(input.reviewedTask.title ?? "");
  const reviewedStatus = String(input.reviewedTask.status ?? "");
  if (!reviewedTitle.startsWith("FastLane Worker") || !reviewedTitle.includes("数据基座") || reviewedStatus !== "done") {
    return [];
  }

  return input.goalTasks.filter((task) => {
    const title = String(task.title ?? "");
    return String(task.status ?? "") === "created" &&
      title.startsWith("FastLane Worker") &&
      (title.includes("只读 API") || title.includes("Vue 只读首页"));
  });
}
