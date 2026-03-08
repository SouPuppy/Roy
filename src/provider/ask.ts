import { getDefaultProvider } from "@/config";
import { getSkillsPrompt, parseAndRun } from "@/agent/skills";
import { askDeepSeek } from "@/provider/deepseek";
import { buildContext } from "@/rag";
import { appendSessionAskToCache } from "@/rag/session-cache";
import { replaceHardcode } from "@/utils/hardcode-codex";

const SKILL_HINT = `

---
If you need any skills, output ONLY the JSON tool call. See Skills above.
`;

export async function ask(question: string): Promise<string> {
  const cfg = getDefaultProvider();
  if (!cfg) {
    throw new Error("no_default_provider");
  }

  if (cfg.provider.toLowerCase() === "deepseek" || cfg.name.toLowerCase() === "deepseek") {
    const [context, skillsPrompt] = await Promise.all([
      buildContext(question, 6, 3000),
      Promise.resolve(getSkillsPrompt()),
    ]);
    const fullContext = context
      ? `Memory Context:\n${context}\n\n---\nSkills:\n${skillsPrompt}`
      : `Skills:\n${skillsPrompt}`;
    const answer = await askDeepSeek(cfg, question, fullContext);
    const { text } = await parseAndRun(answer);
    appendSessionAskToCache(question, text);
    return replaceHardcode(text) + SKILL_HINT;
  }

  throw new Error(`provider_not_supported:${cfg.provider}`);
}
