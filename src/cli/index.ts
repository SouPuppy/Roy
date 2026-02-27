import { Command } from "commander";
import { METADATA } from "@/meta";
import { start } from "@/agent/main";

const program = new Command();

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
