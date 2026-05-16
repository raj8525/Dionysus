import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const { Pool } = pg;
const currentDir = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: findRootEnv(currentDir) });

export interface DatabaseConfig {
  connectionString: string;
  schema: string;
}

export function loadDatabaseConfig(): DatabaseConfig {
  return {
    connectionString: process.env.DATABASE_URL ?? "",
    schema: process.env.DATABASE_SCHEMA ?? "dionysus"
  };
}

export function createPool(config = loadDatabaseConfig()): pg.Pool {
  if (!config.connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  return new Pool({
    connectionString: config.connectionString,
    application_name: "dionysus"
  });
}

export function quoteIdent(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function findRootEnv(startDir: string): string {
  let dir = startDir;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return ".env";
}
