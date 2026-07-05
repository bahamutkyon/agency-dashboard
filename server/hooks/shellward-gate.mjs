#!/usr/bin/env node
/**
 * shellward-gate.mjs  —  Claude PreToolUse hook  (fail-closed)
 *
 * Usage:  node shellward-gate.mjs <guardUrl> <token>
 *   argv[2] = full guard URL, e.g. http://127.0.0.1:5191/api/guard/check
 *   argv[3] = x-guard-token value
 *
 * stdin  : Claude PreToolUse hook JSON
 * stdout : deny JSON (only when denying; silence = allow)
 * exit   : always 0
 *
 * Fail-closed: any error path → deny.
 * Never allows execution when the guard is broken / unreachable.
 */

// ── Re-entry guard (prevents infinite loop if denyExit itself throws) ─────────
let _exiting = false;

function denyExit(reason) {
  if (_exiting) return;
  _exiting = true;
  try {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "shellward-gate: " + String(reason),
        },
      }),
    );
  } catch {
    // stdout write failed — nothing we can do; still exit
  }
  process.exit(0);
}

// ── Global fail-closed handlers ───────────────────────────────────────────────
process.on("uncaughtException", (err) => {
  denyExit("uncaughtException: " + (err?.message ?? String(err)));
});

process.on("unhandledRejection", (reason) => {
  denyExit("unhandledRejection: " + String(reason));
});

// ── Escape hatch  (SHELLWARD_GATE=off → skip guard, allow) ───────────────────
if (process.env.SHELLWARD_GATE === "off") {
  process.exit(0);
}

// ── Args ──────────────────────────────────────────────────────────────────────
const guardUrl = process.argv[2];
const token    = process.argv[3] ?? "";

if (!guardUrl) {
  denyExit("missing guardUrl (argv[2]) — check hook configuration");
}

// ── Read stdin with 3 s timeout ───────────────────────────────────────────────
let _stdinTimeoutId;

const stdinPromise = new Promise((resolve, reject) => {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data",  (chunk) => { buf += chunk; });
  process.stdin.on("end",   ()      => resolve(buf));
  process.stdin.on("error", (err)   => reject(err));
});

const stdinTimeoutPromise = new Promise((_resolve, reject) => {
  _stdinTimeoutId = setTimeout(
    () => reject(new Error("stdin timeout")),
    3_000,
  );
});

let stdinRaw;
try {
  stdinRaw = await Promise.race([stdinPromise, stdinTimeoutPromise]);
  clearTimeout(_stdinTimeoutId);
} catch (err) {
  clearTimeout(_stdinTimeoutId);
  denyExit(err?.message ?? String(err));
}

// ── Parse JSON (validate; raw string forwarded to guard) ──────────────────────
try {
  JSON.parse(stdinRaw);
} catch {
  denyExit("stdin JSON parse failed");
}

// ── POST to guard endpoint ────────────────────────────────────────────────────
let res;
try {
  res = await fetch(guardUrl, {
    method:  "POST",
    headers: {
      "content-type":  "application/json",
      "x-guard-token": token,
    },
    body:   stdinRaw,
    signal: AbortSignal.timeout(3_000),
  });
} catch (err) {
  denyExit("guard unreachable: " + (err?.message ?? String(err)));
}

if (!res.ok) {
  denyExit("guard " + res.status);
}

// ── Parse guard response ──────────────────────────────────────────────────────
let verdict;
try {
  verdict = await res.json();
} catch {
  denyExit("guard response not JSON");
}

// ── Decision ──────────────────────────────────────────────────────────────────
if (verdict?.decision === "allow") {
  process.exit(0); // allow: no stdout output
}

denyExit(verdict?.reason ?? "denied");
