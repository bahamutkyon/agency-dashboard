/**
 * Codex CLI process helper.
 *
 * Codex (OpenAI) works very differently from Claude:
 *   - Each turn = a fresh `codex exec` process (no persistent stdin streaming)
 *   - Output is JSONL via --json:
 *       {"type":"thread.started","thread_id":"<uuid>"}
 *       {"type":"turn.started"}
 *       {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}
 *       {"type":"turn.completed","usage":{...}}
 *   - Subsequent turns: `codex exec resume <thread_id> "<prompt>"`
 *   - No `--append-system-prompt` flag — we prepend system prompt to the user message
 *
 * Auth: works with ChatGPT Plus / Pro OAuth (`codex login`) — same OAuth model
 * as Claude Code. No API key needed for our user (Plus subscription).
 */
import { spawn, execSync, ChildProcess } from "node:child_process";

let CODEX_PATH: string | null = null;
let CODEX_AVAILABLE: boolean | null = null;

export function resolveCodexPath(): string {
  if (CODEX_PATH) return CODEX_PATH;
  try {
    // npm-installed codex on Windows is `codex.cmd` (no .exe). Use `where codex`
    // (no extension) so Windows finds whichever variant exists.
    const cmd = process.platform === "win32" ? "where codex" : "which codex";
    const out = execSync(cmd, { encoding: "utf8" });
    // Prefer .cmd on Windows since that's the canonical npm wrapper
    const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const preferred = process.platform === "win32"
      ? (lines.find((l) => l.toLowerCase().endsWith(".cmd")) || lines[0])
      : lines[0];
    if (preferred) {
      CODEX_PATH = preferred;
      console.log(`[codexProcess] resolved codex → ${CODEX_PATH}`);
      return CODEX_PATH;
    }
  } catch (e: any) {
    console.warn("[codexProcess] could not resolve codex path:", e.message);
  }
  CODEX_PATH = "codex";
  return CODEX_PATH;
}

export function isCodexAvailable(): boolean {
  if (CODEX_AVAILABLE !== null) return CODEX_AVAILABLE;
  try {
    execSync(process.platform === "win32" ? "where codex" : "which codex", {
      stdio: "ignore",
    });
    CODEX_AVAILABLE = true;
  } catch {
    CODEX_AVAILABLE = false;
  }
  return CODEX_AVAILABLE;
}

export interface CodexTurnOptions {
  prompt: string;
  threadId?: string;          // resume an existing thread
  cwd?: string;
  model?: string;             // optional model override (e.g. "o3", "gpt-5")
  sandbox?: "read-only" | "workspace-write";  // default read-only
}

/**
 * Spawn a single Codex turn. The prompt is fed via stdin (codex reads stdin
 * when no PROMPT positional arg is provided), avoiding shell quoting issues
 * with multi-line / unicode prompts.
 *
 * On Windows we need shell:true to resolve `codex.cmd` (the npm wrapper).
 * That's safe here because all flag args are simple short strings — the
 * potentially-large prompt body goes through stdin, not argv.
 */
export function spawnCodexTurn(opts: CodexTurnOptions): ChildProcess {
  const fullPath = resolveCodexPath();
  const args = ["exec"];
  if (opts.threadId) {
    args.push("resume", opts.threadId);
  }
  args.push(
    "--json",
    "--skip-git-repo-check",
    "--sandbox", opts.sandbox || "read-only",
  );
  if (opts.model) args.push("-m", opts.model);
  // No PROMPT arg — codex reads instructions from stdin

  const child = spawn(fullPath, args, {
    cwd: opts.cwd || process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    // shell:true needed on Windows to find/run codex.cmd through PATHEXT
    shell: process.platform === "win32",
    windowsHide: true,
  });

  // pipe prompt via stdin (UTF-8 explicit) and close
  if (child.stdin) {
    child.stdin.write(Buffer.from(opts.prompt, "utf8"));
    child.stdin.end();
  }

  return child;
}

/**
 * Codex JSONL event types we care about. Returned by parseCodexLine().
 */
export interface CodexEvent {
  type: "thread_started" | "turn_started" | "item" | "turn_completed" | "error" | "unknown";
  threadId?: string;
  text?: string;
  itemType?: string;
  usage?: { input?: number; output?: number; cached?: number };
  raw?: any;
}

export function parseCodexLine(line: string): CodexEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (obj.type === "thread.started") {
      return { type: "thread_started", threadId: obj.thread_id };
    }
    if (obj.type === "turn.started") {
      return { type: "turn_started" };
    }
    if (obj.type === "item.completed") {
      return {
        type: "item",
        text: obj.item?.text || "",
        itemType: obj.item?.type || "",
        raw: obj.item,
      };
    }
    if (obj.type === "turn.completed") {
      return {
        type: "turn_completed",
        usage: {
          input: obj.usage?.input_tokens,
          output: obj.usage?.output_tokens,
          cached: obj.usage?.cached_input_tokens,
        },
      };
    }
    if (obj.type === "error" || obj.type === "turn.error") {
      return { type: "error", text: obj.message || JSON.stringify(obj), raw: obj };
    }
    return { type: "unknown", raw: obj };
  } catch {
    return null;
  }
}
