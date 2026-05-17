import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  buildCouponSeedApplyPlan,
  findDestructiveSql
} from "./dionysus-coupon-data.js";

describe("dionysus Coupon data tools", () => {
  it("builds a safe Docker psql apply plan for migrations under targetRoot", () => {
    const targetRoot = fixtureProject("safe");
    writeFileSync(join(targetRoot, "migrations", "001_seed.sql"), [
      "create table if not exists demo_seed (id text primary key);",
      "insert into demo_seed (id) values ('a') on conflict (id) do nothing;"
    ].join("\n"));

    const plan = buildCouponSeedApplyPlan({
      targetRoot,
      migrationPath: "migrations/001_seed.sql",
      verifySql: [
        "SELECT COUNT(*) FROM demo_seed;"
      ]
    });

    expect(plan.status).toBe("ready");
    expect(plan.migrationPath).toBe("migrations/001_seed.sql");
    expect(plan.applyCommand).toContain("docker compose -f docker-compose.yml exec -T postgres psql");
    expect(plan.applyCommand).toContain("< migrations/001_seed.sql");
    expect(plan.verifyCommands[0]).toContain("SELECT COUNT(*) FROM demo_seed;");
    expect(plan.safetyChecks).toContain("blocked destructive SQL patterns were not found");
  });

  it("rejects migrations outside the migrations directory", () => {
    const targetRoot = fixtureProject("outside");
    writeFileSync(join(targetRoot, "seed.sql"), "select 1;");

    expect(() => buildCouponSeedApplyPlan({
      targetRoot,
      migrationPath: "seed.sql",
      verifySql: []
    })).toThrow("under migrations/");
  });

  it("rejects path traversal and absolute migration paths", () => {
    const targetRoot = fixtureProject("path");

    expect(() => buildCouponSeedApplyPlan({
      targetRoot,
      migrationPath: "../Coupon/migrations/001.sql",
      verifySql: []
    })).toThrow("relative path under migrations/");

    expect(() => buildCouponSeedApplyPlan({
      targetRoot,
      migrationPath: "/tmp/migrations/001.sql",
      verifySql: []
    })).toThrow("relative path under migrations/");
  });

  it("rejects destructive SQL before execution", () => {
    const targetRoot = fixtureProject("destructive");
    writeFileSync(join(targetRoot, "migrations", "002_bad.sql"), [
      "create table if not exists demo (id text primary key);",
      "delete from demo;"
    ].join("\n"));

    expect(() => buildCouponSeedApplyPlan({
      targetRoot,
      migrationPath: "migrations/002_bad.sql",
      verifySql: []
    })).toThrow("blocked SQL");
  });

  it("ignores destructive-looking words in SQL comments", () => {
    expect(findDestructiveSql("-- delete from tenant_stores;\nselect 1;")).toEqual([]);
  });
});

function fixtureProject(name: string): string {
  const root = join(tmpdir(), `dionysus-coupon-data-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, "migrations"), { recursive: true });
  return root;
}
