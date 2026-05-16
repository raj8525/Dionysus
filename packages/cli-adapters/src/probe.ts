import type { CliType } from "@dionysus/core";
import { runCommand } from "./shell.js";

export interface CliProbeResult {
  cliType: CliType;
  available: boolean;
  command: string;
  version?: string;
  models?: string[];
  error?: string;
}

export async function probeCli(cliType: CliType): Promise<CliProbeResult> {
  if (cliType === "mock") {
    return { cliType, available: true, command: "mock", version: "mock", models: ["mock/default"] };
  }

  if (cliType === "claude_code") {
    return probeVersion(cliType, "claude", ["--version"]);
  }

  if (cliType === "gemini_cli") {
    return probeVersion(cliType, "gemini", ["--version"]);
  }

  if (cliType === "opencode") {
    const version = await probeVersion(cliType, "opencode", ["--version"]);
    if (!version.available) return version;
    const models = await runCommand("opencode", ["models"], 20_000);
    return {
      ...version,
      models:
        models.exitCode === 0
          ? models.stdout
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean)
          : [],
      error: models.exitCode === 0 ? undefined : models.stderr
    };
  }

  return { cliType, available: false, command: cliType, error: "Unsupported CLI type" };
}

export async function probeAllClis(): Promise<CliProbeResult[]> {
  return Promise.all(["mock", "claude_code", "gemini_cli", "opencode"].map((cliType) => probeCli(cliType as CliType)));
}

async function probeVersion(cliType: CliType, command: string, args: string[]): Promise<CliProbeResult> {
  const result = await runCommand(command, args);
  return {
    cliType,
    available: result.exitCode === 0,
    command,
    version: result.exitCode === 0 ? result.stdout.trim() : undefined,
    error: result.exitCode === 0 ? undefined : result.stderr
  };
}
