import { Command } from "commander";
import { METADATA } from "@/meta";
import { start } from "@/node/main";
import { wakeup } from "@/wizard/wakeup";

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
