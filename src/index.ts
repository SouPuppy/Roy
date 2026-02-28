import { config } from "dotenv";
import { join } from "path";
import { getHomeDir } from "@/home";
import { getLogLevel } from "@/config";

const homeDir = getHomeDir();
config({ path: join(homeDir, ".env"), quiet: true });
process.env.LOG_LEVEL = getLogLevel();

export { METADATA } from "@/meta";
await import("@/shell");
