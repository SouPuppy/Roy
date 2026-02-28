import { Command } from "commander";
import { METADATA } from "@/meta";
import { start } from "@/node/main";
import { wakeup } from "@/wizard/wakeup";
import { getLlmStatus } from "@/provider";
import { ask } from "@/provider/ask";

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
  .description("Show current provider status")
  .action(async () => {
    const llm = await getLlmStatus();
    console.log(
      JSON.stringify(
        {
          llm,
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
