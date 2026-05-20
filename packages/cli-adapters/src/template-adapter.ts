import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { CliType } from "@dionysus/core";
import { resolveOpenCodeModel } from "./opencode-model.js";
import type { AgentRunInput, AgentRunResult, CliAdapter } from "./types.js";

const MAX_OUTPUT_BYTES = 1024 * 1024 * 20;
const COMPLETION_MARKER_PATTERN = /^DIONYSUS_DONE_JSON=(\{.*\})$/;

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
    const cliModel = this.resolvedModel();
    const gitGuard = await createGitGuard(input);
    try {
      const result = await run(command, args, input.cwd, this.options.timeoutMs ?? 20 * 60_000, input.onOutput, gitGuard.env);
      return {
        ...result,
        structuredResult: {
          cliType: this.options.cliType,
          cliModel: cliModel ?? null,
          command,
          argsPreview: args.map((arg) => (arg === input.prompt ? "<prompt>" : arg)),
          completionMarkerDetected: result.completionMarkerDetected ?? false,
          gitGuardEnabled: gitGuard.enabled
        }
      };
    } finally {
      await gitGuard.cleanup();
    }
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
        "--dir",
        input.cwd,
        "--format",
        process.env.DIONYSUS_OPENCODE_FORMAT ?? "default",
        ...optionalPair("--model", this.resolvedModel()),
        ...booleanFlag("--dangerously-skip-permissions", process.env.DIONYSUS_OPENCODE_SKIP_PERMISSIONS ?? "true"),
        input.prompt
      ];
    }
    return [input.prompt];
  }

  private resolvedModel(): string | undefined {
    if (this.options.cliType !== "opencode" || !this.options.model) {
      return this.options.model;
    }
    return resolveOpenCodeModel(this.options.model);
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

async function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  onOutput?: (stream: "stdout" | "stderr", chunkText: string) => void,
  env?: NodeJS.ProcessEnv
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  completionMarkerDetected?: boolean;
}> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let completionMarkerDetected = false;
    let completionTimer: NodeJS.Timeout | undefined;

    const child = spawn(command, args, {
      cwd,
      env,
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
      if (completionTimer) clearTimeout(completionTimer);
      if (extraStderr) {
        onOutput?.("stderr", extraStderr);
      }
      resolve({
        stdout,
        stderr: `${stderr}${extraStderr}`,
        exitCode,
        completionMarkerDetected
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

    const maybeFinishAfterCompletionMarker = (): void => {
      if (settled || completionMarkerDetected) return;
      const marker = parseDionysusCompletionMarker(`${stdout}\n${stderr}`);
      if (!marker) return;
      completionMarkerDetected = true;
      const graceMs = completionGraceMs();
      completionTimer = setTimeout(() => {
        killProcessGroup("SIGTERM");
        setTimeout(() => killProcessGroup("SIGKILL"), 1_000).unref();
        finish(0, `\nDionysus completion marker detected; terminated CLI process group after ${graceMs}ms grace period.`);
      }, graceMs);
      completionTimer.unref();
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      onOutput?.("stdout", chunk.toString());
      stdout = append(stdout, chunk);
      maybeFinishAfterCompletionMarker();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      onOutput?.("stderr", chunk.toString());
      stderr = append(stderr, chunk);
      maybeFinishAfterCompletionMarker();
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

export function parseDionysusCompletionMarker(text: string): Record<string, unknown> | null {
  const payload = findCompletionMarkerPayload(text);
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const status = parsed.status;
    if (status !== "done") return null;
    return parsed;
  } catch {
    return null;
  }
}

function findCompletionMarkerPayload(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const normalized = stripMarkdownLineWrapper(line);
    const match = COMPLETION_MARKER_PATTERN.exec(normalized);
    if (match) return match[1];
  }
  return null;
}

function stripMarkdownLineWrapper(line: string): string {
  return line
    .trim()
    .replace(/^(?:[*_`~]{1,3})+/, "")
    .replace(/(?:[*_`~]{1,3})+$/, "")
    .trim();
}

function completionGraceMs(): number {
  const raw = Number(process.env.DIONYSUS_CLI_COMPLETION_GRACE_MS);
  if (!Number.isFinite(raw) || raw < 0) return 1_500;
  return Math.min(10_000, Math.floor(raw));
}

async function createGitGuard(input: AgentRunInput): Promise<{
  enabled: boolean;
  env: NodeJS.ProcessEnv;
  cleanup: () => Promise<void>;
}> {
  if (!input.targetRoot) {
    return { enabled: false, env: process.env, cleanup: async () => {} };
  }

  const guardDir = await mkdtemp(join(tmpdir(), "dionysus-git-guard-"));
  const guardPath = join(guardDir, "git");
  const realGit = resolveRealGitCommand(process.env.PATH ?? "");
  await writeFile(guardPath, gitGuardScript(realGit));
  await chmod(guardPath, 0o755);

  return {
    enabled: true,
    env: {
      ...process.env,
      PATH: `${guardDir}${delimiter}${process.env.PATH ?? ""}`,
      DIONYSUS_GIT_GUARD_TARGET_ROOT: input.targetRoot,
      DIONYSUS_GIT_GUARD_WORKSPACE_PATH: input.workspacePath ?? input.cwd,
      DIONYSUS_GIT_GUARD_REAL_GIT: realGit
    },
    cleanup: async () => {
      await rm(guardDir, { recursive: true, force: true });
    }
  };
}

function resolveRealGitCommand(pathValue: string): string {
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, "git");
    if (existsSync(candidate)) return candidate;
  }
  return "/usr/bin/git";
}

function gitGuardScript(realGit: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail
real_git=${shellQuote(realGit)}
orig=("$@")
cmd=""
i=0
while [[ $i -lt \${#orig[@]} ]]; do
  arg="\${orig[$i]}"
  case "$arg" in
    -C|-c|--git-dir|--work-tree)
      i=$((i + 2))
      ;;
    --*)
      i=$((i + 1))
      ;;
    -*)
      i=$((i + 1))
      ;;
    *)
      cmd="$arg"
      break
      ;;
  esac
done

case "$cmd" in
  add|am|apply|bisect|checkout|cherry-pick|clean|commit|fetch|merge|mv|pull|push|rebase|reset|restore|revert|rm|stash|submodule|switch|tag|worktree)
    echo "Dionysus git guard blocked 'git $cmd'; agents must not mutate or push repositories. Modify files in the isolated workspace and let Dionysus create the patch." >&2
    exit 97
    ;;
esac

exec "$real_git" "\${orig[@]}"
`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
