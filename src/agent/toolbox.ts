export type ToolResult = {
  result_code: number; // 0 = success
  stdout?: string;
  stderr?: string;
};

export type ToolDef = {
  name: string;
  prompt: string; // SKILL.md content for LLM
  run: (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;
};
