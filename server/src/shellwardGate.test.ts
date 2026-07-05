/**
 * shellwardGate.test.ts — integration tests for server/hooks/shellward-gate.mjs
 *
 * Spawns the script as a real child process (testing it in full isolation),
 * uses a lightweight in-process HTTP server as the mock guard endpoint.
 *
 * All non-allow paths must produce a deny JSON on stdout (fail-closed).
 */
import { describe, it, expect } from "vitest";
import { spawn }                 from "node:child_process";
import * as http                 from "node:http";
import * as path                 from "node:path";
import { fileURLToPath }         from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT    = path.resolve(__dirname, "../hooks/shellward-gate.mjs");
const TOKEN     = "test-token";

const SAMPLE_HOOK_JSON = JSON.stringify({
  tool_name:       "Bash",
  tool_input:      { command: "ls -la" },
  session_id:      "sess-test",
  hook_event_name: "PreToolUse",
  cwd:             "/tmp",
});

// ── Helpers ──────────────────────────────────────────────────────────────────

interface RunResult {
  stdout:   string;
  exitCode: number;
}

/** Spawn the hook script, write stdinData, collect stdout + exit code. */
function runScript(
  args:      string[],
  stdinData: string,
  env?:      Record<string, string>,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const proc = spawn("node", [SCRIPT, ...args], {
      env: { ...process.env, ...env },
    });

    let stdout = "";
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });

    proc.on("close", (code: number | null) => {
      resolve({ stdout, exitCode: code ?? 0 });
    });

    proc.stdin.write(stdinData);
    proc.stdin.end();
  });
}

/** Start a mock guard HTTP server on a random OS-assigned port. */
function startMockGuard(
  handler: (body: unknown) => { decision: string; reason?: string },
  opts: { statusCode?: number } = {},
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let data = "";
      req.on("data",  (chunk) => { data += chunk; });
      req.on("end", () => {
        let body: unknown = null;
        try { body = JSON.parse(data); } catch { /* ignore */ }

        const statusCode = opts.statusCode ?? 200;
        if (statusCode !== 200) {
          res.writeHead(statusCode).end("error");
          return;
        }
        const result = handler(body);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
      });
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      const url  = `http://127.0.0.1:${addr.port}/check`;
      resolve({
        url,
        close: () =>
          new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("shellward-gate.mjs — fail-closed PreToolUse hook", () => {

  // ── allow path ───────────────────────────────────────────────────────────

  it("guard returns allow → no stdout output, exit 0", async () => {
    const guard = await startMockGuard(() => ({ decision: "allow" }));
    try {
      const { stdout, exitCode } = await runScript([guard.url, TOKEN], SAMPLE_HOOK_JSON);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe(""); // silence = allowed
    } finally {
      await guard.close();
    }
  });

  // ── deny path ────────────────────────────────────────────────────────────

  it("guard returns deny → deny JSON on stdout with reason, exit 0", async () => {
    const guard = await startMockGuard(() => ({
      decision: "deny",
      reason:   "dangerous command rm -rf /",
    }));
    try {
      const { stdout, exitCode } = await runScript([guard.url, TOKEN], SAMPLE_HOOK_JSON);
      expect(exitCode).toBe(0);

      const parsed = JSON.parse(stdout.trim());
      expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
      expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain(
        "dangerous command rm -rf /",
      );
    } finally {
      await guard.close();
    }
  });

  it("guard returns unknown decision value → deny (fail-closed), exit 0", async () => {
    const guard = await startMockGuard(() => ({ decision: "unknown_value" as any }));
    try {
      const { stdout, exitCode } = await runScript([guard.url, TOKEN], SAMPLE_HOOK_JSON);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
    } finally {
      await guard.close();
    }
  });

  // ── fail-closed: unreachable ──────────────────────────────────────────────

  it("guard unreachable (port closed) → deny, exit 0 (fail-closed)", async () => {
    // Start a server, note the URL, immediately close it → ECONNREFUSED
    const guard = await startMockGuard(() => ({ decision: "allow" }));
    const deadUrl = guard.url;
    await guard.close();

    const { stdout, exitCode } = await runScript([deadUrl, TOKEN], SAMPLE_HOOK_JSON);
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("shellward-gate:");
  }, 10_000); // 3 s fetch timeout + margin

  // ── fail-closed: bad stdin ────────────────────────────────────────────────

  it("stdin is not valid JSON → deny, exit 0 (fail-closed)", async () => {
    const guard = await startMockGuard(() => ({ decision: "allow" }));
    try {
      const { stdout, exitCode } = await runScript(
        [guard.url, TOKEN],
        "this is NOT valid JSON !!!",
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
    } finally {
      await guard.close();
    }
  });

  // ── fail-closed: non-2xx ──────────────────────────────────────────────────

  it("guard returns 403 → deny, exit 0 (fail-closed)", async () => {
    const guard = await startMockGuard(
      () => ({ decision: "allow" }), // handler unused (statusCode overrides)
      { statusCode: 403 },
    );
    try {
      const { stdout, exitCode } = await runScript([guard.url, TOKEN], SAMPLE_HOOK_JSON);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("403");
    } finally {
      await guard.close();
    }
  });

  // ── escape hatch ──────────────────────────────────────────────────────────

  it("SHELLWARD_GATE=off → allow (no output), exit 0, no network call made", async () => {
    // Point at a non-existent server — if env var works, no connection attempted
    const { stdout, exitCode } = await runScript(
      ["http://127.0.0.1:59997/nope", TOKEN],
      SAMPLE_HOOK_JSON,
      { SHELLWARD_GATE: "off" },
    );
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(""); // silence = allowed
  });

  // ── fail-closed: missing config ───────────────────────────────────────────

  it("missing guardUrl (no argv[2]) → deny, exit 0 (fail-closed)", async () => {
    const { stdout, exitCode } = await runScript([], SAMPLE_HOOK_JSON);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
  });

});
