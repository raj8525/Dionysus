import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface GateCheckResult {
  gateType: "plan" | "spec" | "test" | "implementation" | "integration" | "e2e";
  status: "passed" | "blocked" | "warning";
  required: string[];
  present: string[];
  missing: string[];
}

export async function checkSpecTestGate(targetRoot: string): Promise<GateCheckResult[]> {
  const plan = checkPlan(targetRoot);
  const spec = await checkSpecs(targetRoot);
  const test = await checkTests(targetRoot);
  return [plan, spec, test];
}

function checkPlan(targetRoot: string): GateCheckResult {
  const required = ["docs/PLAN.md"];
  const present = required.filter((path) => existsSync(join(targetRoot, path)));
  return result("plan", required, present);
}

async function checkSpecs(targetRoot: string): Promise<GateCheckResult> {
  const required = ["docs/specs"];
  const specsRoot = join(targetRoot, "docs/specs");
  const present = existsSync(specsRoot) && (await hasFiles(specsRoot, [".md", ".yaml", ".yml", ".json"]))
    ? required
    : [];
  return result("spec", required, present);
}

async function checkTests(targetRoot: string): Promise<GateCheckResult> {
  const required = ["features_test"];
  const testsRoot = join(targetRoot, "features_test");
  const present = existsSync(testsRoot) && (await hasFiles(testsRoot, [".md", ".feature", ".spec.ts", ".test.ts"]))
    ? required
    : [];
  return result("test", required, present);
}

async function hasFiles(root: string, extensions: string[]): Promise<boolean> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory() && (await hasFiles(absolute, extensions))) return true;
    if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      const fileStat = await stat(absolute);
      if (fileStat.size > 0) return true;
    }
  }
  return false;
}

function result(
  gateType: GateCheckResult["gateType"],
  required: string[],
  present: string[]
): GateCheckResult {
  const missing = required.filter((item) => !present.includes(item));
  return {
    gateType,
    status: missing.length > 0 ? "blocked" : "passed",
    required,
    present,
    missing
  };
}
