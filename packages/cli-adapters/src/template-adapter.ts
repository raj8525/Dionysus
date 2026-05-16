import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CliType } from "@dionysus/core";
import type { AgentRunInput, AgentRunResult, CliAdapter } from "./types.js";

const execFileAsync = promisify(execFile);

export interface TemplateCliAdapterOptions {
  cliType: Exclude<CliType, "mock">;
  model?: string;
  timeoutMs?: number;
}

export class TemplateCliAdapter implements CliAdapter {
  constructor(private readonly options: TemplateCliAdapterOptions) {}

  async probe(): Promise<{ available: boolean; details: string }> {
    const command = this.commandName();
    const result = await run(command, ["--version"], process.cwd(), 15_000);
    return {
      available: result.exitCode === 0,
      details: result.exitCode === 0 ? result.stdout.trim() : result.stderr
    };
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const command = this.commandName();
    const args = this.commandArgs(input);
    const result = await run(command, args, input.cwd, this.options.timeoutMs ?? 20 * 60_000);
    return {
      ...result,
      structuredResult: {
        cliType: this.options.cliType,
        cliModel: this.options.model ?? null,
        command,
        argsPreview: args.map((arg) => (arg === input.prompt ? "<prompt>" : arg))
      }
    };
  }

  private commandName(): string {
    const envName = `DIONYSUS_${this.options.cliType.toUpperCase()}_COMMAND`;
    return process.env[envName] ?? defaultCommand(this.options.cliType);
  }

  private commandArgs(input: AgentRunInput): string[] {
    const envName = `DIONYSUS_${this.options.cliType.toUpperCase()}_ARGS`;
    const template = process.env[envName];
    const values: Record<string, string> = {
      prompt: input.prompt,
      cwd: input.cwd,
      taskId: input.taskId,
      model: this.options.model ?? ""
    };

    if (template) {
      return splitArgs(template).map((arg) => replacePlaceholders(arg, values));
    }

    if (this.options.cliType === "claude_code") {
      return ["-p", input.prompt];
    }
    if (this.options.cliType === "gemini_cli") {
      return ["--prompt", input.prompt];
    }
    if (this.options.cliType === "opencode") {
      const modelArgs = this.options.model ? ["--model", this.options.model] : [];
      return ["run", ...modelArgs, input.prompt];
    }
    return [input.prompt];
  }
}

export function createCliAdapter(options: {
  cliType: CliType;
  model?: string;
  timeoutMs?: number;
}): CliAdapter {
  if (options.cliType === "mock") {
    throw new Error("createCliAdapter does not construct MockAdapter; instantiate MockAdapter directly.");
  }
  return new TemplateCliAdapter({
    cliType: options.cliType,
    model: options.model,
    timeoutMs: options.timeoutMs
  });
}

function defaultCommand(cliType: Exclude<CliType, "mock">): string {
  if (cliType === "claude_code") return "claude";
  if (cliType === "gemini_cli") return "gemini";
  return "opencode";
}

function replacePlaceholders(value: string, replacements: Record<string, string>): string {
  return value.replace(/\{(prompt|cwd|taskId|model)\}/g, (_, key: string) => replacements[key] ?? "");
}

function splitArgs(template: string): string[] {
  return template.match(/"[^"]*"|'[^']*'|\S+/g)?.map((part) => part.replace(/^["']|["']$/g, "")) ?? [];
}

async function run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 20
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
      exitCode: typeof err.code === "number" ? err.code : 1
    };
  }
}
