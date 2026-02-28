export type LlmStatus = {
  provider: string;
  ok: boolean;
  message: string;
  latency_ms?: number;
};
