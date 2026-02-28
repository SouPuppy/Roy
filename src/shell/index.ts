import { Command } from "commander";
import { METADATA } from "@/meta";
import { start } from "@/node/main";
import { wakeup } from "@/wizard/wakeup";
import { getLlmStatus } from "@/provider";
import { getEmbeddingStatus } from "@/rag/embedding";
import { ask } from "@/provider/ask";
import { getRagStatus, recallScored, remember } from "@/rag";

const program = new Command();

program
  .command("wakeup")
  .description("Initialize Roy for the first time")
  .action(async () => {
    await wakeup();
  });

program
  .command("start")
  .description("Start the agent")
  .action(() => {
    start();
  });

program
  .command("status")
  .description("Show current provider and embedding status")
  .action(async () => {
    const [llm, embedding, rag] = await Promise.all([
      getLlmStatus(),
      getEmbeddingStatus(),
      getRagStatus(),
    ]);
    console.log(
      JSON.stringify(
        {
          llm,
          embedding,
          rag,
        },
        null,
        2,
      ),
    );
  });

program
  .command("ask")
  .description("Ask question to LLM provider")
  .requiredOption("-q, --question <question>", "Question text")
  .action(async (opts: { question: string }) => {
    try {
      const answer = await ask(opts.question);
      console.log(answer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "ask_failed";
      console.error(`ask failed: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command("remember")
  .description("Store memory")
  .argument("<content>", "Memory content")
  .action(async (content: string) => {
    try {
      const record = await remember(content);
      console.log(
        JSON.stringify(
          { id: record.id, kind: record.kind, scope: record.scope, content: record.content },
          null,
          2,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "remember_failed";
      console.error(`remember failed: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command("recall")
  .description("Recall memory in human-readable format")
  .argument("<query>", "Query text")
  .option("-l, --limit <limit>", "Result limit", "5")
  .option("-d, --debug", "Show score breakdown")
  .action(async (query: string, opts: { limit: string; debug?: boolean }) => {
    try {
      const scored = await recallScored(query, { limit: Number(opts.limit) || 5 });
      if (scored.length === 0) {
        console.log("No memories found.");
        return;
      }

      console.log(`Found ${scored.length} memory result(s):\n`);
      for (const [index, m] of scored.entries()) {
        console.log(`${index + 1}. [${m.kind}/${m.scope}] ${m.content}`);
        if (opts.debug) {
          console.log(
            `   score=${m.score.toFixed(3)} vector=${m.vectorScore.toFixed(3)} lexical=${m.lexicalScore.toFixed(3)} importance=${m.importanceScore.toFixed(3)} recency=${m.recencyScore.toFixed(3)}`,
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "recall_failed";
      console.error(`recall failed: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command("version")
  .description("Show version information")
  .action(() => {
    console.log(`
============================
NAME        : ${METADATA.NAME}
BIRTHDATE   : ${METADATA.BIRTHDATE}
----------------------------
MODEL       : ${METADATA.MODEL}
GENERATION  : ${METADATA.GENERATION}
GENDER      : ${METADATA.GENDER}
SERIAL      : ${METADATA.SERIAL}
============================
`.trim());
  });

program
  .command("help")
  .description("Show help information")
  .action(() => {
    program.outputHelp();
  });

program.parse();
