export function parseAllowedFileScope(description: string): string[] {
  const lines = description.split(/\r?\n/);
  const allowed = new Set<string>();
  let collecting = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const markerMatch = /^(?:allowed files|allowed paths|file scope|允许修改路径|允许修改文件|文件范围|只允许修改)\s*[:：]\s*(.*)$/i.exec(trimmed);
    if (markerMatch) {
      collecting = true;
      addScopeItems(markerMatch[1] ?? "", allowed);
      continue;
    }

    if (collecting) {
      if (!trimmed) {
        collecting = false;
        continue;
      }
      if (/^[-*]\s+/.test(trimmed)) {
        addScopeItems(trimmed.replace(/^[-*]\s+/, ""), allowed);
        continue;
      }
      if (/^(?:[A-Za-z0-9_.-]+\/|\.\/|\/)/.test(trimmed)) {
        addScopeItems(trimmed, allowed);
        continue;
      }
      collecting = false;
    }
  }

  return Array.from(allowed).sort();
}

function addScopeItems(value: string, allowed: Set<string>): void {
  const scopeClause = value.split(/[。；;]/)[0] ?? "";
  const pathPattern =
    /(?:`([^`]+)`)|(?:"([^"]+)")|(?:'([^']+)')|((?:\.{0,2}\/|\/)?[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+(?:\/)?|[A-Za-z0-9_.@-]+\.[A-Za-z0-9_.@-]+)/g;

  for (const match of scopeClause.matchAll(pathPattern)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
    const normalized = normalizeScopePath(raw);
    if (normalized && isLikelyRepositoryPath(normalized)) {
      allowed.add(normalized);
    }
  }
}

function normalizeScopePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/[,.，、]+$/g, "");
}

function isLikelyRepositoryPath(value: string): boolean {
  if (!value) return false;
  if (value.startsWith("/") || value.startsWith("../")) return true;
  const firstSegment = value.split("/")[0] ?? "";
  const knownRoots = new Set([
    "apps",
    "packages",
    "tools",
    "docs",
    "migrations",
    "features_test",
    "tests",
    "scripts",
    "infra",
    "src",
    "test",
    "e2e",
    "cmd",
    "pkg",
    "internal"
  ]);
  if (knownRoots.has(firstSegment)) return true;
  return /^[A-Z0-9_.-]+\.[A-Za-z0-9_.-]+$/i.test(value);
}
