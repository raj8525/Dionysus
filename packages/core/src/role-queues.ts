import type { AgentRole } from "./types.js";

export function queueForRole(role: AgentRole): string {
  if (role === "master") return "dionysus.master";
  if (role === "rule_writer") return "dionysus.rule_writer";
  if (role === "test_writer") return "dionysus.test_writer";
  return "dionysus.worker";
}
