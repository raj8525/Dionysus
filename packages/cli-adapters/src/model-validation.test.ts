import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveOpenCodeModel } from "./opencode-model.js";
import { validateCliModel } from "./model-validation.js";

const touchedEnv: string[] = [];

describe("CLI model validation", () => {
  afterEach(() => {
    for (const key of touchedEnv) {
      delete process.env[key];
    }
    touchedEnv.length = 0;
  });

  it("resolves local OpenCode minimax alias to the configured provider", () => {
    expect(resolveOpenCodeModel("minimax/MiniMax-M2.7")).toBe("minimax-cn-coding-plan/MiniMax-M2.7");
  });

  it("validates resolved OpenCode models against opencode models", async () => {
    setEnv(
      "DIONYSUS_OPENCODE_COMMAND",
      await fakeOpencodeCommand(["minimax-cn-coding-plan/MiniMax-M2.7", "openai/gpt-5.3-codex"])
    );

    const result = await validateCliModel({
      cliType: "opencode",
      model: "minimax/MiniMax-M2.7"
    });

    expect(result.available).toBe(true);
    expect(result.inputModel).toBe("minimax/MiniMax-M2.7");
    expect(result.resolvedModel).toBe("minimax-cn-coding-plan/MiniMax-M2.7");
  });

  it("returns suggestions when an OpenCode model cannot be resolved", async () => {
    setEnv("DIONYSUS_OPENCODE_COMMAND", await fakeOpencodeCommand(["minimax-cn-coding-plan/MiniMax-M2.7"]));

    const result = await validateCliModel({
      cliType: "opencode",
      model: "minimax/MiniMax-M9"
    });

    expect(result.available).toBe(false);
    expect(result.reason).toBe("MODEL_NOT_FOUND");
    expect(result.suggestions).toEqual([]);
  });
});

async function fakeOpencodeCommand(models: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dionysus-model-validation-"));
  const file = join(dir, "fake-opencode.mjs");
  await writeFile(
    file,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      "if (args.includes('models')) {",
      `  console.log(${JSON.stringify(models.join("\n"))});`,
      "} else {",
      "  console.log('OpenCode Test 1.0');",
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
