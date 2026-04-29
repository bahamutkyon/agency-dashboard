/**
 * Claude CLI process helper.
 *
 * Why this exists: previously we spawned `claude` with `shell: true` so the
 * OS would resolve PATH. Problem: cmd.exe on Windows mangles multi-line
 * arguments — long --append-system-prompt strings (with \n / quotes / code
 * blocks) get truncated, producing
 *
 *     error: option '--append-system-prompt <prompt>' argument missing
 *
 * Fix: resolve `claude.exe` full path once via `where`, then spawn with
 * `shell: false` so args go directly to the binary without a shell parsing
 * pass. Multi-line / quoted prompts pass through cleanly.
 */
import { spawn, execSync, SpawnOptions, ChildProcess } from "node:child_process";

let CLAUDE_PATH: string | null = null;

function resolveClaudePath(): string {
  if (CLAUDE_PATH) return CLAUDE_PATH;
  try {
    const cmd = process.platform === "win32" ? "where claude.exe" : "which claude";
    const out = execSync(cmd, { encoding: "utf8" });
    const first = out.split(/\r?\n/)[0].trim();
    if (first) {
      CLAUDE_PATH = first;
      console.log(`[claudeProcess] resolved claude → ${CLAUDE_PATH}`);
      return CLAUDE_PATH;
    }
  } catch (e: any) {
    console.warn("[claudeProcess] could not resolve claude path:", e.message);
  }
  CLAUDE_PATH = "claude"; // last-resort fallback
  return CLAUDE_PATH;
}

export function spawnClaude(args: string[], options: Partial<SpawnOptions> = {}): ChildProcess {
  const fullPath = resolveClaudePath();
  return spawn(fullPath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: false,
    ...options,
  });
}
