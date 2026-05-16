export function resolveOpenCodeModel(
  model: string,
  aliases = process.env.DIONYSUS_OPENCODE_MODEL_ALIASES ?? "minimax=minimax-cn-coding-plan"
): string {
  const parsedAliases = parseProviderAliases(aliases);
  const [provider, ...rest] = model.split("/");
  const modelName = rest.join("/");
  if (!provider || !modelName) return model;
  return parsedAliases[provider] ? `${parsedAliases[provider]}/${modelName}` : model;
}

export function parseProviderAliases(value: string): Record<string, string> {
  return Object.fromEntries(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.split("=").map((part) => part.trim()))
      .filter((parts): parts is [string, string] => Boolean(parts[0]) && Boolean(parts[1]))
  );
}
