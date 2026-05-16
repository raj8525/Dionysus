import type { AgentRunInput, AgentRunResult, CliAdapter } from "./types.js";

export class MockAdapter implements CliAdapter {
  async probe(): Promise<{ available: boolean; details: string }> {
    return { available: true, details: "MockAdapter is always available" };
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    return {
      stdout: [
        "MockAdapter completed task.",
        `task_id=${input.taskId}`,
        `cwd=${input.cwd}`,
        `prompt_length=${input.prompt.length}`
      ].join("\n"),
      stderr: "",
      exitCode: 0,
      structuredResult: {
        modifiedFiles: [],
        testCommand: "pnpm test",
        risk: "mock run only"
      }
    };
  }
}
