import { createHash } from "crypto";
import { execSync } from "child_process";
import pkg from "~/package.json" with { type: "json" };

const master = pkg.version;

let sha256: string;
try {
  sha256 = execSync("git rev-parse HEAD", {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
} catch {
  sha256 = createHash("sha256").update(pkg.version).digest("hex");
}

export const version = { master, sha256 };
export const GENERATION = master.split(".")[0];
export const BUILD = sha256.slice(0, 4).toUpperCase();
