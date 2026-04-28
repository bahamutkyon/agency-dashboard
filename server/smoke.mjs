// Smoke test — connects to the running server via socket.io and drives a session
// end-to-end. Bypasses the browser to isolate backend issues.

import { io } from "socket.io-client";

const SESSION_ID = process.argv[2];
if (!SESSION_ID) {
  console.error("usage: node smoke.mjs <sessionId>");
  process.exit(1);
}

const socket = io("http://localhost:4000", { transports: ["websocket"] });

let buffer = "";
let started = Date.now();
const TIMEOUT_MS = 60000;

socket.on("connect", () => {
  console.log("[smoke] connected, joining session", SESSION_ID);
  socket.emit("session:join", SESSION_ID);
  setTimeout(() => {
    console.log("[smoke] sending message");
    socket.emit("session:send", { sessionId: SESSION_ID, text: "Reply with exactly: SMOKE_OK" });
  }, 500);
});

socket.on("session:event", (evt) => {
  if (evt.type === "delta") {
    buffer += evt.payload;
    process.stdout.write(evt.payload);
  } else {
    console.log("\n[smoke] event:", evt.type, JSON.stringify(evt.payload).slice(0, 200));
  }
  if (evt.type === "result") {
    console.log("\n[smoke] DONE in", Date.now() - started, "ms — buffer:", buffer);
    socket.disconnect();
    process.exit(0);
  }
});

socket.on("session:error", (e) => {
  console.error("[smoke] session:error", e);
});

setTimeout(() => {
  console.error("[smoke] TIMEOUT after", TIMEOUT_MS, "ms");
  socket.disconnect();
  process.exit(2);
}, TIMEOUT_MS);
