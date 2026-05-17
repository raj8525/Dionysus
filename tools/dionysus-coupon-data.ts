import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { normalize, relative, resolve, sep } from "node:path";

export interface CouponSeedApplyInput {
  targetRoot: string;
  migrationPath: string;
  verifySql: string[];
  dryRun?: boolean;
}

export interface CouponSeedApplyPlan {
  status: "ready";
  targetRoot: string;
  migrationPath: string;
  absoluteMigrationPath: string;
  destructiveFindings: string[];
  applyCommand: string;
  verifyCommands: string[];
  safetyChecks: string[];
}

export interface CouponSeedApplyResult {
  status: "dry_run" | "applied";
  plan: CouponSeedApplyPlan;
  apply?: ProcessResult;
  verification: ProcessResult[];
}

export interface ProcessResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const destructivePatterns: Array<{ label: string; pattern: RegExp }> = [
  { label: "DROP statement", pattern: /\bdrop\s+(table|schema|database|view|materialized\s+view|type|function|trigger|index)\b/i },
  { label: "TRUNCATE statement", pattern: /\btruncate\s+table\b/i },
  { label: "DELETE statement", pattern: /\bdelete\s+from\b/i },
  { label: "ALTER TABLE DROP", pattern: /\balter\s+table\b[\s\S]*?\bdrop\s+(column|constraint)\b/i },
  { label: "CREATE DATABASE", pattern: /\bcreate\s+database\b/i },
  { label: "ALTER DATABASE", pattern: /\balter\s+database\b/i }
];

export function buildCouponSeedApplyPlan(input: CouponSeedApplyInput): CouponSeedApplyPlan {
  const targetRoot = requireNonEmpty(input.targetRoot, "targetRoot is required");
  const migrationPath = normalize(requireNonEmpty(input.migrationPath, "migrationPath is required"));
  if (migrationPath.startsWith("..") || migrationPath.includes(`${sep}..${sep}`) || migrationPath.startsWith(sep)) {
    throw new Error("migrationPath must be a relative path under migrations/");
  }
  if (!migrationPath.startsWith(`migrations${sep}`) && !migrationPath.startsWith("migrations/")) {
    throw new Error("migrationPath must be under migrations/");
  }
  if (!migrationPath.endsWith(".sql")) {
    throw new Error("migrationPath must point to a .sql file");
  }

  const absoluteRoot = resolve(targetRoot);
  const absoluteMigrationPath = resolve(absoluteRoot, migrationPath);
  const relativeMigrationPath = relative(absoluteRoot, absoluteMigrationPath);
  if (relativeMigrationPath.startsWith("..") || relativeMigrationPath.startsWith(sep)) {
    throw new Error("migrationPath escapes targetRoot");
  }
  if (!existsSync(absoluteMigrationPath)) {
    throw new Error(`migration file not found: ${absoluteMigrationPath}`);
  }

  const sql = readFileSync(absoluteMigrationPath, "utf8");
  const destructiveFindings = findDestructiveSql(sql);
  if (destructiveFindings.length > 0) {
    throw new Error(`migration contains blocked SQL: ${destructiveFindings.join(", ")}`);
  }

  return {
    status: "ready",
    targetRoot: absoluteRoot,
    migrationPath: relativeMigrationPath,
    absoluteMigrationPath,
    destructiveFindings,
    applyCommand: `docker compose -f docker-compose.yml exec -T postgres psql -U coupon -d coupon -v ON_ERROR_STOP=1 < ${relativeMigrationPath}`,
    verifyCommands: input.verifySql.map((sqlText) => dockerVerifyCommand(sqlText)),
    safetyChecks: [
      "migration path is a relative SQL file under migrations/",
      "migration file stays inside targetRoot",
      "blocked destructive SQL patterns were not found",
      "execution is limited to docker compose postgres psql in the target project"
    ]
  };
}

export async function applyCouponSeed(input: CouponSeedApplyInput): Promise<CouponSeedApplyResult> {
  const plan = buildCouponSeedApplyPlan(input);
  if (input.dryRun) {
    return {
      status: "dry_run",
      plan,
      verification: []
    };
  }

  const migrationSql = readFileSync(plan.absoluteMigrationPath, "utf8");
  const apply = await runDockerPsql({
    cwd: plan.targetRoot,
    commandLabel: plan.applyCommand,
    stdin: migrationSql
  });
  if (apply.exitCode !== 0) {
    return {
      status: "applied",
      plan,
      apply,
      verification: []
    };
  }

  const verification: ProcessResult[] = [];
  for (const sqlText of input.verifySql) {
    verification.push(await runDockerPsql({
      cwd: plan.targetRoot,
      commandLabel: dockerVerifyCommand(sqlText),
      args: ["-tAc", sqlText]
    }));
  }
  return {
    status: "applied",
    plan,
    apply,
    verification
  };
}

export function findDestructiveSql(sql: string): string[] {
  const withoutLineComments = sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  return destructivePatterns
    .filter(({ pattern }) => pattern.test(withoutLineComments))
    .map(({ label }) => label);
}

function dockerVerifyCommand(sqlText: string): string {
  return `docker compose -f docker-compose.yml exec -T postgres psql -U coupon -d coupon -tAc ${JSON.stringify(sqlText)}`;
}

function runDockerPsql(input: {
  cwd: string;
  commandLabel: string;
  args?: string[];
  stdin?: string;
}): Promise<ProcessResult> {
  const args = [
    "compose",
    "-f",
    "docker-compose.yml",
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "coupon",
    "-d",
    "coupon",
    "-v",
    "ON_ERROR_STOP=1",
    ...(input.args ?? [])
  ];

  return new Promise((resolveResult) => {
    const child = spawn("docker", args, {
      cwd: input.cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (exitCode) => {
      resolveResult({
        command: input.commandLabel,
        exitCode,
        stdout,
        stderr
      });
    });
    if (input.stdin) {
      child.stdin.write(input.stdin);
    }
    child.stdin.end();
  });
}

function requireNonEmpty(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(message);
  }
  return trimmed;
}
