/**
 * Gemini CLI process helper. Tested against `@google/gemini-cli` 0.40.0.
 *
 * Real CLI interface (verified):
 *   gemini -p "<prompt>" -o stream-json --skip-trust [-m model] [-r <session>]
 *
 * Stream-json output format (one JSON object per line):
 *   {"type":"init", "session_id":"<uuid>", "model":"..."}
 *   {"type":"message", "role":"user", "content":"<echo>"}
 *   {"type":"message", "role":"assistant", "content":"<text>", "delta":true}
 *   {"type":"result", "status":"success", "stats":{...}}
 *
 * Auth: works with Google AI Pro / Plus OAuth (`gemini auth login`) or
 * GEMINI_API_KEY env var. Free tier available.
 *
 * Multi-turn: gemini-cli has session persistence via --resume <index|"latest">,
 * but it's per-cwd-project and indexes can shift. We track session_id from
 * the init event and could pass it back, but for now we manage history
 * ourselves to avoid project-coupling weirdness.
 */
import { spawn, execSync, ChildProcess } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

let GEMINI_JS: string | null = null;     // path to the actual gemini.js bundle
let GEMINI_PATH: string | null = null;    // path to the .cmd / shell wrapper
let GEMINI_AVAILABLE: boolean | null = null;

/**
 * On Windows, gemini is installed as `gemini.cmd` which wraps
 * `node node_modules/@google/gemini-cli/bundle/gemini.js`. cmd.exe under
 * shell:true mangles empty / quoted args; we invoke node + the JS file
 * directly to bypass that layer.
 */
function resolveGeminiJs(): string | null {
  if (GEMINI_JS !== null) return GEMINI_JS;
  if (process.platform !== "win32") return null;
  try {
    const cmdPath = resolveGeminiPath();
    if (!cmdPath || !cmdPath.endsWith(".cmd")) return null;
    // .cmd is typically at <npm-prefix>/gemini.cmd, JS bundle at
    // <npm-prefix>/node_modules/@google/gemini-cli/bundle/gemini.js
    const dir = path.dirname(cmdPath);
    const jsPath = path.join(dir, "node_modules", "@google", "gemini-cli", "bundle", "gemini.js");
    if (fs.existsSync(jsPath)) {
      GEMINI_JS = jsPath;
      console.log(`[geminiProcess] resolved gemini.js → ${GEMINI_JS}`);
      return GEMINI_JS;
    }
  } catch { /* fall through */ }
  GEMINI_JS = null;
  return null;
}

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
  conversationHistory?: { role: "user" | "model"; text: string }[];
  cwd?: string;
  model?: string;
  yolo?: boolean;  // auto-approve all tools (use sparingly)
}

export function spawnGeminiTurn(opts: GeminiTurnOptions): ChildProcess {
  const fullPath = resolveGeminiPath();

  // Build the full prompt with history baked in
  let fullPrompt = opts.prompt;
  if (opts.conversationHistory && opts.conversationHistory.length > 0) {
    const transcript = opts.conversationHistory
      .map((m) => `[${m.role === "user" ? "USER" : "ASSISTANT"}]\n${m.text}`)
      .join("\n\n");
    fullPrompt = `對話歷史:\n${transcript}\n\n[NEW USER]\n${opts.prompt}`;
  }

  // gemini-cli docs: "-p ... Appended to input on stdin (if any)"
  // Pass a single space as `-p` value (empty string gets eaten by cmd.exe
  // on Windows under shell:true). The real prompt goes via stdin.
  const args = [
    "-p", " ",
    "-o", "stream-json",
    "--skip-trust",
    // Default to "plan" mode = model just thinks/responds, doesn't run tools.
    // This avoids gemini-cli's aggressive workspace scanning that would
    // otherwise waste tokens (it tries to list files / read package.json
    // before answering even simple questions).
    "--approval-mode", opts.yolo ? "yolo" : "plan",
  ];
  if (opts.model) args.push("-m", opts.model);

  const cleanCwd = opts.cwd || (() => {
    const dir = path.join(os.tmpdir(), "agency-dashboard-gemini");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  })();

  // Prefer invoking node + gemini.js directly on Windows to avoid cmd.exe
  // mangling args (empty strings, quotes, multi-line). Fall back to .cmd
  // through shell on non-Windows or when JS bundle not found.
  const jsPath = resolveGeminiJs();
  let child: ChildProcess;
  if (jsPath) {
    child = spawn(process.execPath, [jsPath, ...args], {
      cwd: cleanCwd,
      env: { ...process.env, GEMINI_CLI_TRUST_WORKSPACE: "true" },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
  } else {
    child = spawn(fullPath, args, {
      cwd: cleanCwd,
      env: { ...process.env, GEMINI_CLI_TRUST_WORKSPACE: "true" },
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
      windowsHide: true,
    });
  }

  if (child.stdin) {
    child.stdin.write(Buffer.from(fullPrompt, "utf8"));
    child.stdin.end();
  }

  return child;
}

export interface GeminiEvent {
  type: "init" | "message" | "result" | "error" | "unknown";
  sessionId?: string;
  role?: "user" | "assistant";
  content?: string;
  isDelta?: boolean;
  status?: string;
  raw?: any;
}

export function parseGeminiLine(line: string): GeminiEvent | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (obj.type === "init") {
      return { type: "init", sessionId: obj.session_id, raw: obj };
    }
    if (obj.type === "message") {
      return {
        type: "message",
        role: obj.role,
        content: obj.content || "",
        isDelta: !!obj.delta,
        raw: obj,
      };
    }
    if (obj.type === "result") {
      return { type: "result", status: obj.status, raw: obj };
    }
    if (obj.type === "error") {
      return { type: "error", content: obj.message || obj.error || "", raw: obj };
    }
    return { type: "unknown", raw: obj };
  } catch {
    return null;
  }
}
