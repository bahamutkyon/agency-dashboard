import { spawn, ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { v4 as uuid } from "uuid";

export type SessionStatus = "idle" | "starting" | "busy" | "error" | "closed";

export interface SessionEvent {
  type: "delta" | "message" | "status" | "error" | "result";
  payload: any;
}

interface SpawnOpts {
  agentId: string;
  initialPrompt?: string;
  resumeClaudeSessionId?: string;
  cwd?: string;
  effort?: "low" | "medium" | "high";
}

/**
 * One AgentSession = one persistent `claude` child process running with
 * --input-format stream-json --output-format stream-json, so we can write
 * messages and stream the assistant's output back in real time without
 * starting a new process per turn (preserves prompt cache).
 *
 * We start the child only when the user sends the first message — otherwise
 * we are paying the system-prompt cache creation cost up front for every
 * agent the user clicks on.
 */
export class AgentSession extends EventEmitter {
  readonly id: string;
  readonly agentId: string;
  readonly extraSystemPrompt?: string;
  readonly mcpConfigJson?: string;
  status: SessionStatus = "idle";
  claudeSessionId?: string;
  private child?: ChildProcess;
  private buf = "";
  private currentAssistant = "";

  constructor(agentId: string, sessionId?: string, extraSystemPrompt?: string, mcpConfigJson?: string) {
    super();
    this.id = sessionId || uuid();
    this.agentId = agentId;
    this.extraSystemPrompt = extraSystemPrompt;
    this.mcpConfigJson = mcpConfigJson;
  }

  send(text: string): void {
    console.log(`[AgentSession ${this.id.slice(0,8)}] send (status=${this.status})`);
    if (this.status === "busy") {
      this.emit("event", { type: "error", payload: "Session is busy" });
      return;
    }
    if (!this.child) this.spawnChild();
    this.writeUserMessage(text);
    this.setStatus("busy");
  }

  stop(): void {
    if (this.child) {
      try { this.child.kill(); } catch {}
      this.child = undefined;
    }
    this.setStatus("closed");
  }

  private setStatus(s: SessionStatus) {
    this.status = s;
    this.emit("event", { type: "status", payload: s });
  }

  private spawnChild(opts?: Partial<SpawnOpts>) {
    const args = [
      "-p",
      "--agent", this.agentId,
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--permission-mode", "acceptEdits",
      "--session-id", this.id,
    ];
    if (this.extraSystemPrompt) {
      args.push("--append-system-prompt", this.extraSystemPrompt);
    }
    if (this.mcpConfigJson) {
      args.push("--mcp-config", this.mcpConfigJson);
    }
    if (this.claudeSessionId) {
      // resume an existing claude session
      args.push("--resume", this.claudeSessionId);
    }

    this.setStatus("starting");

    console.log(`[AgentSession ${this.id.slice(0,8)}] spawn claude ${args.join(" ")}`);

    // On Windows the binary is `claude.exe`; on macOS/Linux it's `claude`.
    // We spawn directly (shell: false) to avoid cmd.exe quoting issues with the
    // JSON we pipe to stdin.
    const cmd = "claude";
    const child = spawn(cmd, args, {
      cwd: opts?.cwd || process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
      windowsHide: true,
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      console.log(`[AgentSession ${this.id.slice(0,8)}] stdout: ${String(chunk).slice(0,120).replace(/\n/g," ")}`);
      this.handleStdout(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      console.warn(`[AgentSession ${this.id.slice(0,8)}] stderr: ${String(chunk).trim()}`);
      this.emit("event", { type: "error", payload: String(chunk).trim() });
    });
    child.on("error", (err) => {
      console.error(`[AgentSession ${this.id.slice(0,8)}] spawn error:`, err);
      this.emit("event", { type: "error", payload: `spawn error: ${err.message}` });
    });
    child.on("close", (code) => {
      console.log(`[AgentSession ${this.id.slice(0,8)}] close code=${code}`);
      this.emit("event", { type: "status", payload: code === 0 ? "closed" : "error" });
      this.status = code === 0 ? "closed" : "error";
      this.child = undefined;
    });

    this.child = child;
  }

  private writeUserMessage(text: string) {
    if (!this.child || !this.child.stdin) return;
    // stream-json input format: each line is a JSON object representing
    // one user message. Shape mirrors the SDK contract.
    const obj = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text }],
      },
    };
    this.child.stdin.write(JSON.stringify(obj) + "\n");
  }

  private handleStdout(chunk: string) {
    this.buf += chunk;
    const lines = this.buf.split("\n");
    this.buf = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed);
        this.routeEvent(evt);
      } catch (e) {
        // not JSON — skip
      }
    }
  }

  private routeEvent(evt: any) {
    // capture session_id from any event that carries it
    if (evt.session_id && !this.claudeSessionId) {
      this.claudeSessionId = evt.session_id;
    }

    // forward rate-limit info to anyone interested (usage tracker)
    if (evt.type === "rate_limit_event") {
      this.emit("event", { type: "rate_limit", payload: evt });
      return;
    }

    // partial assistant text
    if (evt.type === "stream_event" && evt.event?.type === "content_block_delta") {
      const d = evt.event.delta;
      if (d?.type === "text_delta" && d.text) {
        this.currentAssistant += d.text;
        this.emit("event", { type: "delta", payload: d.text });
      }
      return;
    }

    // a complete assistant message
    if (evt.type === "assistant" && evt.message?.content) {
      const text = evt.message.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("");
      if (text) {
        this.emit("event", { type: "message", payload: { role: "assistant", content: text } });
      }
      this.currentAssistant = "";
      return;
    }

    // user echo (re-emitted) — ignore
    if (evt.type === "user") return;

    // final result for this turn
    if (evt.type === "result") {
      this.emit("event", { type: "result", payload: evt });
      this.setStatus("idle");
      return;
    }

    // system events (init, etc.) — pass through silently or log if needed
  }
}
