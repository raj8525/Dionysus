import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, loadDatabaseConfig, quoteIdent } from "./connection.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationDir = resolve(currentDir, "../../../migrations");

async function main(): Promise<void> {
  const config = loadDatabaseConfig();
  const pool = createPool(config);
  const schema = quoteIdent(config.schema);

  try {
    const migrations = [
      "0001_init.sql",
      "0002_intake_graph.sql",
      "0003_cli_configs.sql",
      "0004_gates_patch_queue.sql",
      "0005_e2e_case_results.sql"
    ];
    for (const migrationFile of migrations) {
      const migration = await readFile(resolve(migrationDir, migrationFile), "utf8");
      const sql = migration.replaceAll("__SCHEMA__", schema);
      await pool.query(sql);
    }
    console.log(`Dionysus migration complete for schema ${config.schema}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
