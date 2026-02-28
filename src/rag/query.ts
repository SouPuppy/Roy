const EXPANSION_MAP: Record<string, string[]> = {
  db: ["database", "sqlite", "storage"],
  llm: ["language model", "deepseek", "model"],
  rag: ["retrieval augmented generation", "memory retrieval"],
  ts: ["typescript"],
  js: ["javascript"],
  ai: ["artificial intelligence", "model"],
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function expandQuery(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const tokens = tokenize(trimmed);
  const expanded = new Set<string>([trimmed]);

  for (const token of tokens) {
    const aliases = EXPANSION_MAP[token];
    if (!aliases) continue;
    for (const alias of aliases) {
      expanded.add(alias);
      expanded.add(`${trimmed} ${alias}`);
    }
  }

  return [...expanded];
}
