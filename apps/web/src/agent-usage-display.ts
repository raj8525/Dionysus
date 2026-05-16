export function describeUsageScope(input: {
  goalId?: string | null;
  goalTitle?: string | null;
  targetRoot?: string | null;
}): string {
  if (!input.goalId) {
    return "当前没有选中目标，展示全部 Agent CLI 调用统计";
  }
  const project = input.targetRoot?.trim() || "未记录项目目录";
  const title = input.goalTitle?.trim() || "未命名目标";
  return `当前项目 ${project} · 目标 ${title} · ${input.goalId}`;
}

export function modelCallLabel(): string {
  return "Model Calls（估算）";
}
