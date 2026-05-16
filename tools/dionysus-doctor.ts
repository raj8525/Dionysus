export interface DoctorResult {
  ok: boolean;
  apiBase: string;
  health: unknown;
  cliProbe: Array<Record<string, unknown>>;
  goalStatus?: unknown;
}

export function compactDoctorResult(result: DoctorResult): Record<string, unknown> {
  return {
    ok: result.ok,
    apiBase: result.apiBase,
    health: result.health,
    cliProbe: result.cliProbe.map((probe) => ({
      cliType: probe.cliType,
      available: probe.available,
      command: probe.command,
      version: probe.version,
      modelCount: Array.isArray(probe.models) ? probe.models.length : undefined
    })),
    goalStatus: result.goalStatus
  };
}
