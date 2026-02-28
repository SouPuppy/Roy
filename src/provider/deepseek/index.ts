import type { ProviderConfig } from "@/config";
import type { LlmStatus } from "@/provider/types";

export async function getDeepSeekStatus(cfg: ProviderConfig): Promise<LlmStatus> {
  if (!cfg.api_key) {
    return {
      provider: cfg.name,
      ok: false,
      message: "missing_api_key",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const startedAt = Date.now();

  try {
    const res = await fetch("https://api.deepseek.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cfg.api_key}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    const latency = Date.now() - startedAt;
    if (!res.ok) {
      return {
        provider: cfg.name,
        ok: false,
        latency_ms: latency,
        message: `http_${res.status}`,
      };
    }

    return {
      provider: cfg.name,
      ok: true,
      latency_ms: latency,
      message: "connected",
    };
  } catch (error) {
    return {
      provider: cfg.name,
      ok: false,
      message: error instanceof Error ? error.message : "request_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function askDeepSeek(
  cfg: ProviderConfig,
  question: string,
  context?: string,
): Promise<string> {
  if (!cfg.api_key) {
    throw new Error("missing_api_key");
  }

  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.api_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content: context
            ? `You are Roy. Use the provided memory context when it is relevant.\n\nMemory Context:\n${context}`
            : "You are Roy.",
        },
        { role: "user", content: question },
      ],
      max_tokens: cfg.max_tokens ?? 1024,
    }),
  });

  if (!res.ok) {
    throw new Error(`deepseek_http_${res.status}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    throw new Error("empty_response");
  }
  return answer;
}

export async function embedDeepSeek(cfg: ProviderConfig, text: string): Promise<number[]> {
  if (!cfg.api_key) {
    throw new Error("missing_api_key");
  }

  const res = await fetch("https://api.deepseek.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.api_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // configurable later; keep OpenAI-compatible default first
      model: "text-embedding-3-small",
      input: text,
    }),
  });

  if (!res.ok) {
    throw new Error(`deepseek_embedding_http_${res.status}`);
  }

  const data = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const embedding = data.data?.[0]?.embedding;
  if (!embedding || embedding.length === 0) {
    throw new Error("empty_embedding");
  }
  return embedding;
}
