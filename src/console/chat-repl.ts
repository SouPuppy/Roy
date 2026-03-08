import * as readline from "readline";
import { ask } from "@/provider/ask";
import { appendToSession } from "@/agent/session";
import { METADATA } from "@/meta";
import { log } from "@/logger";

/** Chat uses info level to avoid debug logs interleaving with prompt. */
const CHAT_LOG_LEVEL = "info";

function runCommand(input: string): boolean {
  const cmd = input.split(/\s+/)[0]?.toLowerCase();
  if (cmd === "/clear") {
    console.clear();
    return true;
  }
  if (cmd === "/info") {
    console.log(`
============================
NAME        : ${METADATA.NAME}
BIRTHDATE   : ${METADATA.BIRTHDATE}
SERIAL      : ${METADATA.SERIAL}
----------------------------
MODEL       : ${METADATA.MODEL}
GENERATION  : ${METADATA.GENERATION}
GENDER      : ${METADATA.GENDER}
============================
`.trim());
    return true;
  }
  console.log("Unknown command. Available: /clear /info");
  return true;
}

export async function runChatRepl(opts?: { debug?: boolean }): Promise<void> {
  const prevLevel = log.level;
  if (!opts?.debug) {
    log.level = CHAT_LOG_LEVEL;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let i = 0;

  const next = (): void => {
    setImmediate(prompt);
  };

  const prompt = (): void => {
    i++;
    rl.question(`In[${i}]:= `, async (line) => {
      const input = line.trim();
      if (!input) {
        i--;
        next();
        return;
      }
      if (input === "exit" || input === "quit" || input === ".q") {
        log.level = prevLevel;
        rl.close();
        return;
      }
      if (input.startsWith("/")) {
        if (runCommand(input)) {
          i--;
        }
        next();
        return;
      }
      try {
        const output = await ask(input);
        console.log(`\nOut[${i}]= ${output}\n`);
        appendToSession(i, input, output);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`\nOut[${i}]= [error] ${msg}\n`);
        appendToSession(i, input, `[error] ${msg}`);
      }
      next();
    });
  };

  console.log("Roy chat (In[i]/Out[i]). Commands: /clear /info. Type exit to quit.\n");
  prompt();
}
