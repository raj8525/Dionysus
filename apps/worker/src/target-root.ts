import type { Goal } from "@dionysus/core";

export function targetRootForGoal(goal: Goal | null, fallback: string): string {
  return goal?.targetRoot || fallback;
}
