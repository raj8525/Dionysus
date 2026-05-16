import { describe, expect, it } from "vitest";

import { selectAgentForRun } from "./agent-assignment.js";
import type { AgentRecord } from "./types.js";

describe("selectAgentForRun", () => {
  it("prefers an idle agent for the requested role and picks the oldest idle worker first", () => {
    const selected = selectAgentForRun({
      role: "worker",
      agents: [
        agent({ id: "worker-b", name: "WorkerB", role: "worker", status: "idle", updatedAt: "2026-05-17T00:00:20.000Z" }),
        agent({ id: "worker-a", name: "WorkerA", role: "worker", status: "idle", updatedAt: "2026-05-17T00:00:10.000Z" }),
        agent({ id: "master", name: "Master", role: "master", status: "idle", updatedAt: "2026-05-17T00:00:00.000Z" })
      ]
    });

    expect(selected?.id).toBe("worker-a");
  });

  it("ignores disabled agents and falls back to the least recently updated non-idle agent", () => {
    const selected = selectAgentForRun({
      role: "worker",
      agents: [
        agent({ id: "worker-a", name: "WorkerA", role: "worker", status: "disabled", updatedAt: "2026-05-17T00:00:00.000Z" }),
        agent({ id: "worker-c", name: "WorkerC", role: "worker", status: "working", updatedAt: "2026-05-17T00:00:30.000Z" }),
        agent({ id: "worker-b", name: "WorkerB", role: "worker", status: "blocked", updatedAt: "2026-05-17T00:00:20.000Z" })
      ]
    });

    expect(selected?.id).toBe("worker-b");
  });

  it("returns null when no enabled agent exists for the requested role", () => {
    const selected = selectAgentForRun({
      role: "test_writer",
      agents: [
        agent({ id: "worker-a", name: "WorkerA", role: "worker", status: "idle" }),
        agent({ id: "test-writer", name: "TestWriter", role: "test_writer", status: "disabled" })
      ]
    });

    expect(selected).toBeNull();
  });
});

function agent(input: Partial<AgentRecord> & Pick<AgentRecord, "id" | "name" | "role" | "status">): AgentRecord {
  return {
    cliType: "mock",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
    ...input
  };
}
