import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { probeCli } from "./probe.js";

const touchedEnv: string[] = [];

describe("CLI probing", () => {
  afterEach(() => {
    for (const key of touchedEnv) {
      delete process.env[key];
    }
    touchedEnv.length = 0;
  });

  it("honors configured Claude Code command", async () => {
    setEnv("DIONYSUS_CLAUDE_CODE_COMMAND", await fakeCliCommand("Claude Test 1.0"));

    const result = await probeCli("claude_code");

    expect(result.available).toBe(true);
    expect(result.command).toBe(process.env.DIONYSUS_CLAUDE_CODE_COMMAND);
    expect(result.version).toBe("Claude Test 1.0");
  }, 10_000);

  it("loads OpenCode models using configured command", async () => {
    setEnv("DIONYSUS_OPENCODE_COMMAND", await fakeCliCommand("OpenCode Test 1.0", ["openai/gpt-5.4", "google/gemini-2.5-pro"]));

    const result = await probeCli("opencode");

    expect(result.available).toBe(true);
    expect(result.models).toEqual(["openai/gpt-5.4", "google/gemini-2.5-pro"]);
  });
});

async function fakeCliCommand(version: string, models: string[] = []): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dionysus-probe-"));
  const file = join(dir, "fake-cli.mjs");
  await writeFile(
    file,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      "if (args.includes('models')) {",
      `  console.log(${JSON.stringify(models.join("\n"))});`,
      "} else {",
      `  console.log(${JSON.stringify(version)});`,
      "}"
    ].join("\n")
  );
  await chmod(file, 0o755);
  return file;
}

function setEnv(key: string, value: string): void {
  process.env[key] = value;
  touchedEnv.push(key);
}
