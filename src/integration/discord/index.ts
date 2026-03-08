import { Client, GatewayIntentBits, Partials } from "discord.js";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { ask } from "@/provider/ask";
import { forget, recallScored, remember } from "@/rag";

const MAX_MSG = 1800;

type StartDiscordOptions = {
  token?: string;
  prefix?: string;
};

let proxyConfigured = false;

async function configureProxyFromEnv(): Promise<void> {
  if (proxyConfigured) return;
  const proxyUrl = (process.env.DISCORD_PROXY_URL ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? process.env.ALL_PROXY ?? "").trim();
  if (!proxyUrl) {
    proxyConfigured = true;
    return;
  }

  // Ensure websocket/http requests in discord.js can use proxy.
  // global-agent patches Node http/https global agents.
  process.env.GLOBAL_AGENT_HTTP_PROXY = proxyUrl;
  const ga = await import("global-agent");
  ga.bootstrap();

  // Ensure undici-based requests also use the same proxy.
  setGlobalDispatcher(new ProxyAgent(proxyUrl));

  if (!process.env.HTTPS_PROXY) process.env.HTTPS_PROXY = proxyUrl;
  if (!process.env.HTTP_PROXY) process.env.HTTP_PROXY = proxyUrl;
  if (!process.env.ALL_PROXY) process.env.ALL_PROXY = proxyUrl;

  proxyConfigured = true;
  console.log(`Discord proxy enabled: ${proxyUrl}`);
}

function splitText(text: string, chunkSize = MAX_MSG): string[] {
  if (!text) return ["(empty)"];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    out.push(text.slice(i, i + chunkSize));
  }
  return out;
}

async function replyLong(reply: (content: string) => Promise<unknown>, text: string): Promise<void> {
  for (const chunk of splitText(text)) {
    await reply(chunk);
  }
}

function formatRecall(items: Awaited<ReturnType<typeof recallScored>>): string {
  if (items.length === 0) return "No memories found.";
  return items
    .map((m, i) => `${i + 1}. [${m.kind}/${m.scope}] ${m.content}\n   score=${m.score.toFixed(3)} id=${m.id}`)
    .join("\n");
}

function parseForgetArgs(rest: string): { id: string; force: boolean } {
  const tokens = rest.split(/\s+/).filter(Boolean);
  const force = tokens.includes("--force");
  const id = tokens.filter((t) => t !== "--force").join(" ").trim();
  return { id, force };
}

export async function startDiscordBot(options?: StartDiscordOptions): Promise<void> {
  await configureProxyFromEnv();
  const token = (options?.token ?? process.env.DISCORD_BOT_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("missing_discord_bot_token");
  }

  const prefix = (options?.prefix ?? "!").trim() || "!";

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  client.once("ready", () => {
    const tag = client.user?.tag ?? "unknown";
    console.log(`Discord bot online: ${tag} (prefix=${prefix})`);
  });

  const shutdown = async () => {
    console.log("\nShutting down Discord bot...");
    try {
      if (client.isReady()) {
        await client.destroy();
        console.log("Discord client destroyed.");
      }
    } catch (err) {
      console.error("Error during Discord logout:", err);
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    const content = msg.content.trim();
    if (!content.startsWith(prefix)) return;

    const reply = async (text: string) => {
      await msg.reply(text);
    };

    const input = content.slice(prefix.length).trim();
    const [cmdRaw, ...rest] = input.split(/\s+/);
    const cmd = (cmdRaw ?? "").toLowerCase();
    const restText = rest.join(" ").trim();

    try {
      if (!cmd || cmd === "help") {
        await reply([
          `Commands (${prefix}):`,
          `${prefix}ask <question>`,
          `${prefix}remember <content>`,
          `${prefix}recall <query>`,
          `${prefix}forget <id> --force`,
        ].join("\n"));
        return;
      }

      if (cmd === "ask") {
        if (!restText) {
          await reply("Usage: !ask <question>");
          return;
        }
        await reply("Thinking...");
        const answer = await ask(restText);
        await replyLong(reply, answer);
        return;
      }

      if (cmd === "remember") {
        if (!restText) {
          await reply("Usage: !remember <content>");
          return;
        }
        const row = await remember(restText, { kind: "auto", scope: "global" });
        await reply(`Saved memory: ${row.id} [${row.kind}/${row.scope}]`);
        return;
      }

      if (cmd === "recall") {
        if (!restText) {
          await reply("Usage: !recall <query>");
          return;
        }
        const items = await recallScored(restText, { limit: 8 });
        await replyLong(reply, formatRecall(items));
        return;
      }

      if (cmd === "forget") {
        const { id, force } = parseForgetArgs(restText);
        if (!id) {
          await reply("Usage: !forget <id> --force");
          return;
        }
        if (!force) {
          await reply("Blocked. Please use: !forget <id> --force");
          return;
        }
        await forget(id);
        await reply(`Deleted memory: ${id}`);
        return;
      }

      await reply(`Unknown command: ${cmd}. Try ${prefix}help`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "discord_command_failed";
      await reply(`Error: ${message}`);
    }
  });

  client.on("error", (error) => {
    const message = error instanceof Error ? error.message : "discord_client_error";
    console.error(`discord error: ${message}`);
  });

  try {
    await client.login(token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "discord_login_failed";
    if (/timeout/i.test(message)) {
      throw new Error(`${message} (network blocked? set DISCORD_PROXY_URL or HTTPS_PROXY in .home/.env)`);
    }
    if (/disallowed intents/i.test(message)) {
      throw new Error("Used disallowed intents (enable MESSAGE CONTENT INTENT in Discord Developer Portal > Bot)");
    }
    throw error;
  }
}
