const queryEmbeddingCache = new Map<string, number[]>();
const CACHE_LIMIT = 512;
const DEFAULT_EMBED_MODEL = "Xenova/bge-small-en-v1.5";

type EmbedPipeline = (text: string, options?: Record<string, unknown>) => Promise<{
  data: number[] | Float32Array;
}>;

type TokenizerCallResult = {
  input_ids: number[] | number[][];
};

type Tokenizer = ((text: string, options?: Record<string, unknown>) => Promise<TokenizerCallResult>) & {
  decode(ids: number[], options?: Record<string, unknown>): string | Promise<string>;
};

/** Progress payload from @xenova/transformers during model file download. */
type PipelineProgress = {
  status: "initiate" | "download" | "progress" | "done";
  name?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
};

const BAR_WIDTH = 24;
const isTTY = typeof process !== "undefined" && process.stdout?.isTTY === true;

function drawProgressBar(progress: PipelineProgress): void {
  if (!isTTY) return;
  const pct = progress.progress ?? 0;
  const filled = Math.round((pct / 100) * BAR_WIDTH);
  const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
  const file = progress.file ?? "model";
  const line = `\r  Downloading ${file} [${bar}] ${pct.toFixed(0)}%`;
  process.stdout.write(line);
}

function clearProgressLine(): void {
  if (!isTTY) return;
  process.stdout.write("\r" + " ".repeat(80) + "\r");
}

function progressCallback(progress: PipelineProgress): void {
  if (progress.status === "progress") {
    drawProgressBar(progress);
  } else if (progress.status === "done") {
    clearProgressLine();
  }
}

let embedderPromise: Promise<EmbedPipeline> | null = null;
let embedderReady = false;
let tokenizerPromise: Promise<Tokenizer> | null = null;

function getEmbedder(): Promise<EmbedPipeline> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const mod = (await import("@xenova/transformers")) as {
        pipeline: (
          task: string,
          model: string,
          options?: { progress_callback?: (p: PipelineProgress) => void },
        ) => Promise<EmbedPipeline>;
      };
      const pipe = await mod.pipeline("feature-extraction", DEFAULT_EMBED_MODEL, {
        progress_callback: progressCallback,
      });
      embedderReady = true;
      return pipe;
    })();
  }
  return embedderPromise;
}

async function getTokenizer(): Promise<Tokenizer> {
  if (!tokenizerPromise) {
    tokenizerPromise = (async () => {
      const mod = (await import("@xenova/transformers")) as unknown as {
        AutoTokenizer: {
          from_pretrained(model: string): Promise<Tokenizer>;
        };
      };
      return mod.AutoTokenizer.from_pretrained(DEFAULT_EMBED_MODEL);
    })();
  }
  return tokenizerPromise;
}

/** Ensure the embedding model is loaded (downloads on first use). For use during wakeup. */
export async function ensureEmbeddingModel(): Promise<void> {
  const embedder = await getEmbedder();
  // Run one minimal forward pass so the model is fully warmed
  await embedder("warmup", { pooling: "mean", normalize: true });
  await getTokenizer();
}

/** Whether the model is already cached on disk (same path @xenova/transformers uses). */
async function isEmbeddingModelCached(): Promise<boolean> {
  const { env } = (await import("@xenova/transformers")) as { env: { cacheDir: string } };
  const { existsSync } = await import("fs");
  const { join } = await import("path");
  const parts = DEFAULT_EMBED_MODEL.split("/");
  const cacheDir = join(env.cacheDir, ...parts);
  return existsSync(cacheDir);
}

/** Status of the embedding model (for `roy status`). Does not trigger loading. */
export async function getEmbeddingStatus(): Promise<{
  model: string;
  status: "not_loaded" | "cached" | "loading" | "ready";
}> {
  if (embedderPromise !== null) {
    return {
      model: DEFAULT_EMBED_MODEL,
      status: embedderReady ? "ready" : "loading",
    };
  }
  const cached = await isEmbeddingModelCached();
  return {
    model: DEFAULT_EMBED_MODEL,
    status: cached ? "cached" : "not_loaded",
  };
}

function cacheSet(key: string, value: number[]): void {
  if (queryEmbeddingCache.size >= CACHE_LIMIT) {
    const oldest = queryEmbeddingCache.keys().next().value as string | undefined;
    if (oldest) queryEmbeddingCache.delete(oldest);
  }
  queryEmbeddingCache.set(key, value);
}

export async function embedText(text: string): Promise<number[]> {
  const key = text.trim().toLowerCase();
  const cached = queryEmbeddingCache.get(key);
  if (cached) return cached;

  const embedder = await getEmbedder();
  const output = await embedder(text, { pooling: "mean", normalize: true });
  const vec = Array.from(output.data);
  cacheSet(key, vec);
  return vec;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (const t of texts) {
    out.push(await embedText(t));
  }
  return out;
}

export async function tokenizeText(text: string): Promise<number[]> {
  const tokenizer = await getTokenizer();
  const encoded = await tokenizer(text, { add_special_tokens: false });
  const ids = encoded.input_ids as unknown;
  if (Array.isArray(ids) && ids.length > 0 && Array.isArray(ids[0])) {
    return ids[0] as number[];
  }
  if (Array.isArray(ids)) {
    return ids as number[];
  }
  if (ids && typeof ids === "object" && "data" in ids) {
    const data = (ids as { data?: ArrayLike<number> }).data;
    if (data) return Array.from(data);
  }
  return [];
}

export async function decodeTokens(tokenIds: number[]): Promise<string> {
  if (tokenIds.length === 0) return "";
  const tokenizer = await getTokenizer();
  return await tokenizer.decode(tokenIds, { skip_special_tokens: true });
}
