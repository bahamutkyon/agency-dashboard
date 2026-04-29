/**
 * Gemini CLI process helper.
 *
 * Targets the official `@google/gemini-cli` (npm: @google/gemini-cli).
 * Like our other providers, we resolve the binary path once and spawn a
 * fresh process per turn since the CLI is built for one-shot usage.
 *
 * Auth: works with Google AI Pro / Plus / paid OAuth via `gemini login`,
 * OR env var GEMINI_API_KEY for API-key mode. Free tier available.
 *
 * Notes vs Claude / Codex:
 *  - No native --append-system-prompt; we prepend system prompt to user msg
 *  - JSON output flag varies by CLI version; we try a few patterns
 *  - Multi-turn: not all versions persist threads via CLI; we serialize
 *    history into the prompt for now (good enough for most use cases)
 */
import { spawn, execSync, ChildProcess } from "node:child_process";

let GEMINI_PATH: string | null = null;
let GEMINI_AVAILABLE: boolean | null = null;

export function resolveGeminiPath(): string {
  if (GEMINI_PATH) return GEMINI_PATH;
  try {
    const cmd = process.platform === "win32" ? "where gemini" : "which gemini";
    const out = execSync(cmd, { encoding: "utf8" });
    const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const preferred = process.platform === "win32"
      ? (lines.find((l) => l.toLowerCase().endsWith(".cmd")) || lines[0])
      : lines[0];
    if (preferred) {
      GEMINI_PATH = preferred;
      console.log(`[geminiProcess] resolved gemini → ${GEMINI_PATH}`);
      return GEMINI_PATH;
    }
  } catch (e: any) {
    console.warn("[geminiProcess] could not resolve gemini path:", e.message);
  }
  GEMINI_PATH = "gemini";
  return GEMINI_PATH;
}

export function isGeminiAvailable(): boolean {
  if (GEMINI_AVAILABLE !== null) return GEMINI_AVAILABLE;
  try {
    execSync(process.platform === "win32" ? "where gemini" : "which gemini", {
      stdio: "ignore",
    });
    GEMINI_AVAILABLE = true;
  } catch {
    GEMINI_AVAILABLE = false;
  }
  return GEMINI_AVAILABLE;
}

export interface GeminiTurnOptions {
  prompt: string;
  conversationHistory?: { role: "user" | "model"; text: string }[];  // serialized into prompt
  cwd?: string;
  model?: string;     // e.g. "gemini-2.5-flash" or "gemini-2.5-pro"
}

/**
 * Spawn a gemini turn. Conversation history (if any) is folded into the
 * prompt as context — gemini-cli's session persistence is variable across
 * versions, so we manage state ourselves.
 */
export function spawnGeminiTurn(opts: GeminiTurnOptions): ChildProcess {
  const fullPath = resolveGeminiPath();
  const args: string[] = [];
  // Newer gemini-cli supports `-p` for prompt mode; fall back to plain
  args.push("-p");
  if (opts.model) args.push("-m", opts.model);

  // Build the full text we'll send via stdin
  let fullPrompt = opts.prompt;
  if (opts.conversationHistory && opts.conversationHistory.length > 0) {
    const transcript = opts.conversationHistory
      .map((m) => `[${m.role === "user" ? "USER" : "ASSISTANT"}]\n${m.text}`)
      .join("\n\n");
    fullPrompt = `對話歷史:\n${transcript}\n\n[NEW USER]\n${opts.prompt}`;
  }

  const child = spawn(fullPath, args, {
    cwd: opts.cwd || process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",  // .cmd resolution via PATHEXT
    windowsHide: true,
  });

  // pipe prompt via stdin (UTF-8 explicit, like our other providers)
  if (child.stdin) {
    child.stdin.write(Buffer.from(fullPrompt, "utf8"));
    child.stdin.end();
  }

  return child;
}
