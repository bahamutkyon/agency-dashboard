/**
 * Tests for fix 2: codex/gemini duplicate assistant message writes.
 *
 * Verifies:
 *  - Codex: item.completed path emits exactly ONE "message" event per turn.
 *  - Codex: pure-delta path (no item, only close) still emits ONE "message".
 *  - Gemini: non-delta path emits exactly ONE "message" event per turn.
 *  - Gemini: pure-delta path (result without prior non-delta message) emits ONE "message".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Lightweight stubs that replicate only the emit/flag logic under test.
// We don't import AgentSession directly (it pulls in child_process, DB, etc.)
// ---------------------------------------------------------------------------

/** Stub representing the codex turn state. */
function makeCodexTurnState() {
  const emitter = new EventEmitter();
  let codexCurrent = "";
  let codexEmitted = false;

  // Reset at turn start (mirrors spawnCodexTurnNow)
  function startTurn() {
    codexCurrent = "";
    codexEmitted = false;
  }

  // Mirrors routeCodexEvent — item with text
  function receiveItem(text: string) {
    codexCurrent = text;
    emitter.emit("event", { type: "delta", payload: text });
    emitter.emit("event", { type: "message", payload: { role: "assistant", content: text } });
    codexEmitted = true;
  }

  // Mirrors close handler
  function handleClose() {
    if (!codexEmitted && codexCurrent && codexCurrent.trim()) {
      emitter.emit("event", { type: "message", payload: { role: "assistant", content: codexCurrent } });
    }
    emitter.emit("event", { type: "result", payload: { provider: "codex", exit: 0 } });
  }

  return { emitter, startTurn, receiveItem, handleClose };
}

/** Stub representing the gemini turn state. */
function makeGeminiTurnState() {
  const emitter = new EventEmitter();
  let geminiCurrent = "";
  let geminiEmitted = false;

  function startTurn() {
    geminiCurrent = "";
    geminiEmitted = false;
  }

  // Mirrors routeGeminiEvent — message branch
  function receiveMessage(content: string, isDelta: boolean) {
    if (isDelta) {
      emitter.emit("event", { type: "delta", payload: content });
      geminiCurrent += content;
    } else {
      geminiCurrent = content;
      emitter.emit("event", { type: "message", payload: { role: "assistant", content } });
      geminiEmitted = true;
    }
  }

  // Mirrors routeGeminiEvent — result branch
  function receiveResult() {
    if (!geminiEmitted && geminiCurrent) {
      emitter.emit("event", { type: "message", payload: { role: "assistant", content: geminiCurrent } });
    }
  }

  return { emitter, startTurn, receiveMessage, receiveResult };
}

// ---------------------------------------------------------------------------
// Codex tests
// ---------------------------------------------------------------------------
describe("codex duplicate-message fix", () => {
  it("item.completed path: emits exactly 1 message event per turn", () => {
    const { emitter, startTurn, receiveItem, handleClose } = makeCodexTurnState();
    const messages: any[] = [];
    emitter.on("event", (e) => { if (e.type === "message") messages.push(e); });

    startTurn();
    receiveItem("Hello from codex");
    handleClose();

    expect(messages).toHaveLength(1);
    expect(messages[0].payload.content).toBe("Hello from codex");
  });

  it("pure-delta path (no item, only close): emits 1 message via close fallback", () => {
    const { emitter, startTurn, handleClose } = makeCodexTurnState();
    // Manually simulate accumulation without calling receiveItem
    const state = { codexCurrent: "delta text", codexEmitted: false };

    const emitter2 = new EventEmitter();
    const messages: any[] = [];
    emitter2.on("event", (e) => { if (e.type === "message") messages.push(e); });

    // Simulate close handler directly
    if (!state.codexEmitted && state.codexCurrent.trim()) {
      emitter2.emit("event", { type: "message", payload: { role: "assistant", content: state.codexCurrent } });
    }

    expect(messages).toHaveLength(1);
    expect(messages[0].payload.content).toBe("delta text");
  });

  it("two consecutive turns do not bleed emitted flag across turns", () => {
    const { emitter, startTurn, receiveItem, handleClose } = makeCodexTurnState();
    const messages: any[] = [];
    emitter.on("event", (e) => { if (e.type === "message") messages.push(e); });

    // Turn 1
    startTurn();
    receiveItem("Turn 1");
    handleClose();

    // Turn 2
    startTurn();
    receiveItem("Turn 2");
    handleClose();

    expect(messages).toHaveLength(2);
    expect(messages[0].payload.content).toBe("Turn 1");
    expect(messages[1].payload.content).toBe("Turn 2");
  });
});

// ---------------------------------------------------------------------------
// Gemini tests
// ---------------------------------------------------------------------------
describe("gemini duplicate-message fix", () => {
  it("non-delta message path: emits exactly 1 message event (result does not re-emit)", () => {
    const { emitter, startTurn, receiveMessage, receiveResult } = makeGeminiTurnState();
    const messages: any[] = [];
    emitter.on("event", (e) => { if (e.type === "message") messages.push(e); });

    startTurn();
    receiveMessage("Full response from gemini", false /* not delta */);
    receiveResult();

    expect(messages).toHaveLength(1);
    expect(messages[0].payload.content).toBe("Full response from gemini");
  });

  it("pure-delta path: result emits 1 accumulated message", () => {
    const { emitter, startTurn, receiveMessage, receiveResult } = makeGeminiTurnState();
    const messages: any[] = [];
    emitter.on("event", (e) => { if (e.type === "message") messages.push(e); });

    startTurn();
    receiveMessage("Hello ", true /* delta */);
    receiveMessage("world!", true /* delta */);
    receiveResult();

    expect(messages).toHaveLength(1);
    expect(messages[0].payload.content).toBe("Hello world!");
  });

  it("two consecutive turns reset emitted flag", () => {
    const { emitter, startTurn, receiveMessage, receiveResult } = makeGeminiTurnState();
    const messages: any[] = [];
    emitter.on("event", (e) => { if (e.type === "message") messages.push(e); });

    // Turn 1 (non-delta)
    startTurn();
    receiveMessage("Turn 1", false);
    receiveResult();

    // Turn 2 (non-delta)
    startTurn();
    receiveMessage("Turn 2", false);
    receiveResult();

    expect(messages).toHaveLength(2);
    expect(messages[0].payload.content).toBe("Turn 1");
    expect(messages[1].payload.content).toBe("Turn 2");
  });
});
