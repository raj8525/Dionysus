export interface CliUsageReceipt {
  modelCalls: number;
  raw: Record<string, unknown>;
}

const usageLinePattern = /^DIONYSUS_USAGE_JSON=(.+)$/;
const doneLinePattern = /^DIONYSUS_DONE_JSON=(.+)$/;

export function parseCliUsageReceipt(text: string): CliUsageReceipt | null {
  const payload = findUsagePayload(text);
  if (!payload) return null;

  try {
    const raw = JSON.parse(payload) as Record<string, unknown>;
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

function findUsagePayload(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const normalized = stripMarkdownLineWrapper(line);
    const match = usageLinePattern.exec(normalized) ?? doneLinePattern.exec(normalized);
    if (match) return match[1];
  }
  return null;
}

function stripMarkdownLineWrapper(line: string): string {
  return line
    .trim()
    .replace(/^(?:[*_`~]{1,3})+/, "")
    .replace(/(?:[*_`~]{1,3})+$/, "")
    .trim();
}
