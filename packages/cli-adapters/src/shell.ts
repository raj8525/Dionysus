import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runCommand(command: string, args: string[], timeoutMs = 15_000): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  try {
    const result = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 10
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
      exitCode: typeof err.code === "number" ? err.code : 1
    };
  }
}
