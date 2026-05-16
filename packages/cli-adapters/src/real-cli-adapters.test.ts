import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCliAdapter } from "./template-adapter.js";

const touchedEnv: string[] = [];

describe("real CLI adapters", () => {
  afterEach(() => {
    for (const key of touchedEnv) {
      delete process.env[key];
    }
    touchedEnv.length = 0;
  });

  it("runs Claude Code in non-interactive print mode", async () => {
    const command = await fakeCliCommand();
    setEnv("DIONYSUS_CLAUDE_CODE_COMMAND", command);
    setEnv("DIONYSUS_CLAUDE_CODE_PERMISSION_MODE", "acceptEdits");

    const result = await createCliAdapter({ cliType: "claude_code", model: "sonnet" }).run({
      taskId: "task-1",
      cwd: process.cwd(),
      prompt: "实现一个功能"
    });

    const args = JSON.parse(result.stdout) as string[];
    expect(args).toEqual([
      "--print",
      "--output-format",
      "text",
      "--permission-mode",
      "acceptEdits",
      "--model",
      "sonnet",
      "实现一个功能"
    ]);
  });

  it("runs Gemini CLI in headless trusted workspace mode", async () => {
    const command = await fakeCliCommand();
    setEnv("DIONYSUS_GEMINI_CLI_COMMAND", command);
    setEnv("DIONYSUS_GEMINI_CLI_APPROVAL_MODE", "auto_edit");

    const result = await createCliAdapter({ cliType: "gemini_cli", model: "gemini-2.5-pro" }).run({
      taskId: "task-2",
      cwd: process.cwd(),
      prompt: "写测试"
    });

    const args = JSON.parse(result.stdout) as string[];
    expect(args).toEqual([
      "--prompt",
      "写测试",
      "--output-format",
      "text",
      "--skip-trust",
      "--approval-mode",
      "auto_edit",
      "--model",
      "gemini-2.5-pro"
    ]);
  });

  it("runs OpenCode with run command, model, and explicit permission flag", async () => {
    const command = await fakeCliCommand();
    setEnv("DIONYSUS_OPENCODE_COMMAND", command);
    setEnv("DIONYSUS_OPENCODE_SKIP_PERMISSIONS", "true");

    const result = await createCliAdapter({ cliType: "opencode", model: "openai/gpt-5.3-codex" }).run({
      taskId: "task-3",
      cwd: process.cwd(),
      prompt: "修改代码"
    });

    const args = JSON.parse(result.stdout) as string[];
    expect(args).toEqual([
      "run",
      "--dir",
      process.cwd(),
      "--format",
      "default",
      "--model",
      "openai/gpt-5.3-codex",
      "--dangerously-skip-permissions",
      "修改代码"
    ]);
  });

  it("returns a structured timeout instead of hanging forever", async () => {
    const command = await hangingCliCommand();
    setEnv("DIONYSUS_CLAUDE_CODE_COMMAND", command);

    const result = await createCliAdapter({ cliType: "claude_code", timeoutMs: 100 }).run({
      taskId: "task-timeout",
      cwd: process.cwd(),
      prompt: "会超时"
    });

    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain("timed out");
  });
});

async function fakeCliCommand(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dionysus-cli-"));
  const file = join(dir, "fake-cli.mjs");
  await writeFile(file, "#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)))\n");
  await chmod(file, 0o755);
  return file;
}

function setEnv(key: string, value: string): void {
  process.env[key] = value;
  touchedEnv.push(key);
}

async function hangingCliCommand(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dionysus-cli-hang-"));
  const file = join(dir, "hanging-cli.mjs");
  await writeFile(file, "#!/usr/bin/env node\nsetInterval(() => {}, 1000)\n");
  await chmod(file, 0o755);
  return file;
}
