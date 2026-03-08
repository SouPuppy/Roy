import { execSync } from "child_process";
import { getWorkspaceDir } from "@/config";

export type ExecArgs = {
  cmd: string;
};

export type ExecResult = {
  stdout: string;
  stderr: string;
  code: number;
};

export function exec(args: ExecArgs): ExecResult {
  const { cmd } = args;
  if (!cmd || typeof cmd !== "string") {
    throw new Error("bultin.exec: cmd is required");
  }
  const cwd = getWorkspaceDir();
  try {
    const out = execSync(cmd.trim(), {
      cwd,
      encoding: "utf-8",
      timeout: 60_000,
    });
    return { stdout: out ?? "", stderr: "", code: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (err.stdout as string) ?? "",
      stderr: (err.stderr as string) ?? String(e),
      code: err.status ?? 1,
    };
  }
}
