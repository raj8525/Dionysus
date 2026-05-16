export type DispatchDecision =
  | {
      action: "dispatch_next";
      reason: string;
    }
  | {
      action: "wait_for_integration";
      reason: string;
      patchId: string;
    }
  | {
      action: "stop";
      reason: string;
    };

export function decidePostRunDispatch(input: {
  exitCode: number;
  queuedPatchId?: string | null;
}): DispatchDecision {
  if (input.exitCode !== 0) {
    return {
      action: "stop",
      reason: "run failed"
    };
  }

  if (input.queuedPatchId) {
    return {
      action: "wait_for_integration",
      reason: "patch must be applied before the next task can run",
      patchId: input.queuedPatchId
    };
  }

  return {
    action: "dispatch_next",
    reason: "run succeeded without target patch"
  };
}

export function shouldDispatchAfterIntegration(input: {
  applyStatus: "applied" | "blocked" | "failed";
}): boolean {
  return input.applyStatus === "applied";
}
