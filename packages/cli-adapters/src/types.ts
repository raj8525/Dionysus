export interface AgentRunInput {
  taskId: string;
  prompt: string;
  cwd: string;
}

export interface AgentRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  structuredResult?: Record<string, unknown>;
}

export interface CliAdapter {
  probe(): Promise<{ available: boolean; details: string }>;
  run(input: AgentRunInput): Promise<AgentRunResult>;
}
