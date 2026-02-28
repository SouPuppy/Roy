import { decodeTokens, tokenizeText } from "@/rag/embedding";

export async function chunkText(
  text: string,
  chunkTokens = 220,
  overlapTokens = 40,
): Promise<string[]> {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return [];

  const tokenIds = await tokenizeText(normalized);
  if (tokenIds.length === 0) return [];
  if (tokenIds.length <= chunkTokens) return [normalized];

  const chunks: string[] = [];
  const step = Math.max(1, chunkTokens - overlapTokens);
  for (let start = 0; start < tokenIds.length; start += step) {
    const end = Math.min(tokenIds.length, start + chunkTokens);
    const textChunk = (await decodeTokens(tokenIds.slice(start, end))).trim();
    if (textChunk) chunks.push(textChunk);
    if (end >= tokenIds.length) break;
  }
  return chunks;
}

export async function estimateTokenCount(text: string): Promise<number> {
  if (!text.trim()) return 0;
  const tokenIds = await tokenizeText(text);
  return tokenIds.length;
}
