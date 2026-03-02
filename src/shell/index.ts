import { Command } from "commander";
import { METADATA } from "@/meta";
import { start } from "@/node/main";
import { wakeup } from "@/wizard/wakeup";
import { getLlmStatus } from "@/provider";
import { getEmbeddingStatus } from "@/rag/embedding";
import { ask } from "@/provider/ask";
import { forget, getMemoryKindCounts, getRagStatus, listMemories, recallScored, remember } from "@/rag";
import { runMemoryExplorer } from "@/shell/memory-explorer";
import { startGuiServer } from "@/gui/index";
import { runTui } from "@/shell/tui";
import { startDiscordBot } from "@/discord/index";
import type { MemoryKind, MemoryScope } from "@/rag/types";

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
  .option("-k, --kind <kind>", "Memory kind: auto|identity|task|knowledge|reference|note|unclassified")
  .option("--classify <kind>", "Force classify this memory as a specific kind")
  .option("--clasiify <kind>", "Alias typo for --classify")
  .action(async (content: string, opts: { kind?: string; classify?: string; clasiify?: string }) => {
    try {
      const forcedKind = opts.classify ?? opts.clasiify;
      const record = await remember(content, { kind: forcedKind ?? opts.kind ?? "auto" });
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
  .command("memory")
  .description("Explore memory (scroll/search/open/delete/filter)")
  .option("-q, --query <query>", "Search text")
  .option("-s, --scope <scope>", "Scope filter: session|project|global")
  .option("-k, --kind <kind>", "Kind filter: identity|task|knowledge|reference|note|unclassified")
  .option("-l, --limit <limit>", "Page size", "15")
  .option("-o, --offset <offset>", "Offset", "0")
  .option("--plain", "Non-interactive list output")
  .action(async (opts: {
    query?: string;
    scope?: string;
    kind?: string;
    limit?: string;
    offset?: string;
    plain?: boolean;
  }) => {
    try {
      const scope = opts.scope as MemoryScope | undefined;
      const kind = opts.kind as MemoryKind | undefined;
      const limit = Number(opts.limit) || 15;
      const offset = Number(opts.offset) || 0;

      if (!opts.plain) {
        await runMemoryExplorer({ query: opts.query, scope, kind, limit });
        return;
      }

      const rows = await listMemories({ query: opts.query, scope, kind, limit, offset });
      if (rows.length === 0) {
        console.log("No memories found.");
        const counts = await getMemoryKindCounts({ query: opts.query, scope });
        console.log(
          `Kind stats: identity=${counts.identity}, task=${counts.task}, knowledge=${counts.knowledge}, reference=${counts.reference}, note=${counts.note}, unclassified=${counts.unclassified}`,
        );
        return;
      }
      const counts = await getMemoryKindCounts({ query: opts.query, scope });
      console.log(`Found ${rows.length} memory result(s):\n`);
      console.log(
        `Kind stats: identity=${counts.identity}, task=${counts.task}, knowledge=${counts.knowledge}, reference=${counts.reference}, note=${counts.note}, unclassified=${counts.unclassified}\n`,
      );
      for (const [index, row] of rows.entries()) {
        console.log(`${index + 1}. [${row.kind}/${row.scope}] ${row.content}`);
        console.log(`   id=${row.id}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "memory_list_failed";
      console.error(`memory list failed: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command("forget")
  .description("Delete a memory by id (requires --force)")
  .argument("<id>", "Memory id")
  .option("-f, --force", "Actually delete the memory")
  .option("--forece", "Alias typo for --force")
  .action(async (id: string, opts: { force?: boolean; forece?: boolean }) => {
    const forced = Boolean(opts.force || opts.forece);
    if (!forced) {
      console.error("forget blocked: pass --force to delete this memory");
      process.exitCode = 1;
      return;
    }
    try {
      await forget(id);
      console.log(`Deleted memory: ${id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "forget_failed";
      console.error(`forget failed: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command("recall")
  .description("Recall memory (auto-sized result set)")
  .argument("<query>", "Query text")
  .option("--accurate", "Stricter threshold (fewer, higher-confidence results)")
  .option("--reelated", "Looser threshold (more exploratory results)")
  .option("-d, --debug", "Show score breakdown")
  .action(async (query: string, opts: { debug?: boolean; accurate?: boolean; reelated?: boolean }) => {
    try {
      if (opts.accurate && opts.reelated) {
        console.error("recall failed: --accurate and --reelated cannot be used together");
        process.exitCode = 1;
        return;
      }

      const mode = opts.reelated ? "reelated" : "accurate";
      const scored = await recallScored(query, {
        limit: mode === "reelated" ? 16 : 8,
      });
      if (scored.length === 0) {
        console.log("No memories found.");
        return;
      }

      const best = scored[0]?.score ?? 0;
      const settings = mode === "accurate"
        ? { minAbs: 0.2, ratio: 0.58, max: 8 }
        : { minAbs: 0.12, ratio: 0.35, max: 12 };
      const minScore = Math.max(settings.minAbs, best * settings.ratio);
      const auto = scored.filter((m, i) => i === 0 || m.score >= minScore).slice(0, settings.max);

      console.log(`Found ${auto.length} memory result(s):\n`);
      for (const [index, m] of auto.entries()) {
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

program
  .command("gui")
  .description("Start local web GUI for memory/RAG")
  .option("-p, --port <port>", "Port number", "50777")
  .option("--open", "Open browser automatically")
  .action((opts: { port?: string; open?: boolean }) => {
    const port = Number(opts.port) || 50777;
    startGuiServer({ port, open: Boolean(opts.open) });
  });

program
  .command("tui")
  .description("Start basic multi-screen TUI")
  .action(async () => {
    await runTui();
  });

program
  .command("discord")
  .description("Start Discord bot gateway adapter")
  .option("--prefix <prefix>", "Command prefix", "!")
  .action(async (opts: { prefix?: string }) => {
    try {
      await startDiscordBot({ prefix: opts.prefix });
    } catch (error) {
      const message = error instanceof Error ? error.message : "discord_start_failed";
      console.error(`discord failed: ${message}`);
      process.exitCode = 1;
    }
  });

program.parse();
