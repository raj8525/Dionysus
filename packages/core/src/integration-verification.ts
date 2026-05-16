export function inferIntegrationVerificationCommands(changedFiles: string[]): string[] {
  const commands: string[] = [];
  const normalized = changedFiles.map((file) => file.replace(/\\/g, "/"));

  if (normalized.some((file) => file.startsWith("apps/admin-api/internal/handler/") && file.endsWith("_test.go"))) {
    commands.push("go test -c ./apps/admin-api/internal/handler/");
  } else if (normalized.some((file) => file.endsWith(".go"))) {
    commands.push("go test ./... -count=1");
  }

  if (normalized.some((file) => file.startsWith("apps/admin-web/src/") || file.startsWith("apps/admin-web/html/"))) {
    commands.push("pnpm --filter @coupon/admin-web build");
  }

  return [...new Set(commands)];
}

export function mergeIntegrationVerificationCommands(input: {
  changedFiles: string[];
  configuredCommands: string[];
}): string[] {
  return [...new Set([
    ...inferIntegrationVerificationCommands(input.changedFiles),
    ...input.configuredCommands.filter((command) => command.trim().length > 0)
  ])];
}
