import { spawn } from "node:child_process";
import type { CliType } from "@dionysus/core";
import type { AgentRunInput, AgentRunResult, CliAdapter } from "./types.js";

const MAX_OUTPUT_BYTES = 1024 * 1024 * 20;

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
      return [
        "--print",
        "--output-format",
        "text",
        "--permission-mode",
        process.env.DIONYSUS_CLAUDE_CODE_PERMISSION_MODE ?? "acceptEdits",
        ...optionalPair("--model", this.options.model),
        input.prompt
      ];
    }
    if (this.options.cliType === "gemini_cli") {
      return [
        "--prompt",
        input.prompt,
        "--output-format",
        process.env.DIONYSUS_GEMINI_CLI_OUTPUT_FORMAT ?? "text",
        "--skip-trust",
        "--approval-mode",
        process.env.DIONYSUS_GEMINI_CLI_APPROVAL_MODE ?? "auto_edit",
        ...optionalPair("--model", this.options.model)
      ];
    }
    if (this.options.cliType === "opencode") {
      return [
        "run",
        "--format",
        process.env.DIONYSUS_OPENCODE_FORMAT ?? "default",
        ...optionalPair("--model", this.options.model),
        ...booleanFlag("--dangerously-skip-permissions", process.env.DIONYSUS_OPENCODE_SKIP_PERMISSIONS ?? "true"),
        input.prompt
      ];
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

function optionalPair(flag: string, value: string | undefined): string[] {
  return value ? [flag, value] : [];
}

function booleanFlag(flag: string, value: string | undefined): string[] {
  return value === "1" || value === "true" || value === "yes" ? [flag] : [];
}

async function run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString();
      return next.length > MAX_OUTPUT_BYTES ? next.slice(-MAX_OUTPUT_BYTES) : next;
    };

    const finish = (exitCode: number, extraStderr = ""): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: `${stderr}${extraStderr}`,
        exitCode
      });
    };

    const killProcessGroup = (signal: NodeJS.Signals): void => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // The process may already be gone.
        }
      }
    };

    const timer = setTimeout(() => {
      killProcessGroup("SIGTERM");
      setTimeout(() => killProcessGroup("SIGKILL"), 1_000).unref();
      finish(124, `\nCommand timed out after ${timeoutMs}ms`);
    }, timeoutMs);
    timer.unref();

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => {
      finish(1, stderr ? `\n${error.message}` : error.message);
    });
    child.on("close", (code, signal) => {
      if (signal) {
        finish(1, stderr ? `\nProcess terminated by ${signal}` : `Process terminated by ${signal}`);
        return;
      }
      finish(code ?? 1);
    });
  });
}
