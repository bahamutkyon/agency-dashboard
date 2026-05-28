import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server as SocketServer } from "socket.io";
import { loadAgents } from "./agentLoader.js";
import { agentManager } from "./agentManager.js";
import { scheduler } from "./scheduler.js";
import { workflowRunner } from "./workflowRunner.js";
import { loadRemoteConfig, buildRemoteAccessMiddleware } from "./remoteAccess.js";
import { resumeUnfinishedRuns, runLearningTarget } from "./capabilityLearning.js";
import { learningScheduler } from "./learningScheduler.js";
import { getRun } from "./store.js";
import path from "node:path";
import fs from "node:fs";

// --- Route modules ---
import { buildMiscRouter } from "./routes/misc.js";
import { agentsRouter } from "./routes/agents.js";
import { sessionsRouter } from "./routes/sessions.js";
import { workspacesRouter, onboardingRouter, workflowDraftRouter } from "./routes/workspaces.js";
import { schedulesRouter } from "./routes/schedules.js";
import { templatesRouter } from "./routes/templates.js";
import { notesRouter } from "./routes/notes.js";
import { workflowsRouter, runsRouter } from "./routes/workflows.js";
import { learningRouter } from "./routes/learning.js";

const PORT = Number(process.env.PORT || 5191);
const REMOTE_CFG = loadRemoteConfig();

const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.set("trust proxy", "loopback");  // for accurate req.ip behind localhost
app.use(cors());
app.use(express.json({ limit: "20mb" })); // bumped for base64 file uploads
app.use(buildRemoteAccessMiddleware(REMOTE_CFG));

// 服務 server/data/uploads/ 下的檔案(使用者拖曳上傳的 + agent 截圖)
// 讓 <img src="/api/uploads/xxx.png"> 在對話內 inline 顯示
app.use("/api/uploads", express.static(UPLOAD_DIR));

// --- Mount routers ---
// Misc: /api/health, /api/usage, /api/upload, /api/capabilities, /api/security/*, /api/remote-access/*, /api/mcp/*, /api/providers, /api/route
app.use("/api", buildMiscRouter(REMOTE_CFG));

// Agents catalog: /api/agents
app.use("/api/agents", agentsRouter);

// Sessions, agent-memory, search, tags, batch, orchestrator:
// /api/sessions/*, /api/agent-memory/*, /api/search, /api/tags, /api/batch/*, /api/orchestrator, /api/agents/:id/sessions
app.use("/api", sessionsRouter);

// Workspaces CRUD: /api/workspaces/*
app.use("/api/workspaces", workspacesRouter);

// Onboarding wizard: /api/onboarding, /api/onboarding/apply
app.use("/api/onboarding", onboardingRouter);

// Workflow draft assistant: /api/workflow/draft, /api/workflow/draft/apply
app.use("/api/workflow", workflowDraftRouter);

// Agent schedules CRUD: /api/schedules/*
app.use("/api/schedules", schedulesRouter);

// Prompt templates CRUD: /api/templates/*
app.use("/api/templates", templatesRouter);

// Notes CRUD: /api/notes/*
app.use("/api/notes", notesRouter);

// Workflow CRUD + run/validate/yaml/import-yaml: /api/workflows/*
app.use("/api/workflows", workflowsRouter);

// Workflow run operations: /api/runs/*
app.use("/api/runs", runsRouter);

// Capability learning: /api/learning/*
app.use("/api/learning", learningRouter);

// --- HTTP server + Socket.IO ---

const server = createServer(app);
const io = new SocketServer(server, { cors: { origin: "*" } });

// Make io accessible to routers via req.app.get("io")
app.set("io", io);

// sessionObservers: sessionId → Set of socketIds currently observing that session.
// sessionForwards: sessionId → the "event" listener attached to the AgentSession.
// This allows proper cleanup when a socket disconnects or the last observer leaves.
const sessionObservers = new Map<string, Set<string>>();
const sessionForwards = new Map<string, (evt: any) => void>();

function leaveSession(socketId: string, sessionId: string) {
  const observers = sessionObservers.get(sessionId);
  if (!observers) return;
  observers.delete(socketId);
  if (observers.size === 0) {
    // Last observer gone — detach the event listener from the AgentSession.
    const forward = sessionForwards.get(sessionId);
    if (forward) {
      const session = agentManager.get(sessionId);
      if (session) session.off("event", forward);
      sessionForwards.delete(sessionId);
    }
    sessionObservers.delete(sessionId);
    console.log(`[ws] unwired session ${sessionId} (no more observers)`);
  }
}

io.on("connection", (socket) => {
  console.log(`[ws] client connected ${socket.id}`);

  socket.on("disconnect", (r) => {
    console.log(`[ws] client disconnected ${socket.id} (${r})`);
    // Clean up all sessions this socket was observing.
    for (const [sessionId] of sessionObservers) {
      leaveSession(socket.id, sessionId);
    }
  });

  socket.on("session:join", (sessionId: string) => {
    console.log(`[ws] session:join ${sessionId}`);
    const session = agentManager.get(sessionId) || agentManager.reattach(sessionId);
    if (!session) {
      console.warn(`[ws] session not found: ${sessionId}`);
      socket.emit("session:error", { sessionId, error: "session not found" });
      return;
    }
    socket.join(`session:${sessionId}`);

    // Register this socket as an observer.
    if (!sessionObservers.has(sessionId)) {
      sessionObservers.set(sessionId, new Set());
    }
    const observers = sessionObservers.get(sessionId)!;
    observers.add(socket.id);

    // Attach the shared forward listener only once per session.
    if (!sessionForwards.has(sessionId)) {
      const forward = (evt: any) => {
        io.to(`session:${sessionId}`).emit("session:event", { sessionId, ...evt });
      };
      session.on("event", forward);
      sessionForwards.set(sessionId, forward);
      console.log(`[ws] wired session ${sessionId}`);
    }
  });

  socket.on("session:send", ({ sessionId, text }: { sessionId: string; text: string }) => {
    console.log(`[ws] session:send ${sessionId} text=${text?.slice(0, 60)}`);
    if (!sessionId || !text) return;
    const result = agentManager.send(sessionId, text);
    if (!result.ok) {
      console.warn(`[ws] send failed ${sessionId}`);
      socket.emit("session:error", { sessionId, error: "send failed" });
      return;
    }
    if (result.injectedNotes && result.injectedNotes.length > 0) {
      io.to(`session:${sessionId}`).emit("session:event", {
        sessionId,
        type: "notes-injected",
        payload: result.injectedNotes,
      });
    }
  });

  socket.on("session:stop", (sessionId: string) => {
    console.log(`[ws] session:stop ${sessionId}`);
    agentManager.stop(sessionId);
  });
});

// 友善處理埠占用：別讓 EADDRINUSE 變成 unhandled 'error' 事件直接 crash。
server.on("error", (err: any) => {
  if (err?.code === "EADDRINUSE") {
    console.error(`[agency-dashboard] ❌ 埠 ${PORT} 已被占用 —— dashboard 可能已在別處執行，或上次未關乾淨。`);
    console.error(`[agency-dashboard]    解法：關掉占用該埠的程序，或用環境變數 PORT=其他埠 重新啟動。`);
  } else {
    console.error(`[agency-dashboard] server error:`, err);
  }
  process.exit(1);
});

server.listen(PORT, REMOTE_CFG.bindHost, () => {
  if (REMOTE_CFG.enabled) {
    console.log(`[agency-dashboard] 🌐 listening on http://${REMOTE_CFG.bindHost}:${PORT} (REMOTE ACCESS ENABLED)`);
    console.log(`[agency-dashboard]    allowed ranges: ${REMOTE_CFG.allowRanges.join(", ")}`);
    console.log(`[agency-dashboard]    token auth: ${REMOTE_CFG.hasToken ? "ON" : "off"}`);
  } else {
    console.log(`[agency-dashboard] listening on http://127.0.0.1:${PORT} (local-only, default)`);
  }
  console.log(`[agency-dashboard] agents loaded: ${loadAgents().length}`);
  scheduler.init();
  scheduler.onFire((s) => io.emit("schedule:fired", { id: s.id, lastRunAt: s.lastRunAt }));
  learningScheduler.init((payload) => io.emit("learning:progress", payload));
  resumeUnfinishedRuns(runLearningTarget, (r) => {
    io.emit("learning:progress", {
      runId: r.id, status: r.status, total: r.total, done: r.done,
      current: r.current, failed: r.failed, createdProposals: r.createdProposals,
    });
  });
  workflowRunner.on("update", (runId: string) => {
    const r = getRun(runId);
    if (r) io.emit("workflow:update", r);
  });
});
