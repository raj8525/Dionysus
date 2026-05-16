export interface CliUsageReceipt {
  modelCalls: number;
  raw: Record<string, unknown>;
}

const usageLinePattern = /^DIONYSUS_USAGE_JSON=(.+)$/m;

export function parseCliUsageReceipt(text: string): CliUsageReceipt | null {
  const match = usageLinePattern.exec(text);
  if (!match) return null;

  try {
    const raw = JSON.parse(match[1]) as Record<string, unknown>;
    const modelCalls = Number(raw.modelCalls);
    if (!Number.isFinite(modelCalls) || modelCalls < 0) {
      return null;
    }
    return {
      modelCalls: Math.floor(modelCalls),
      raw
    };
  } catch {
    return null;
  }
}
