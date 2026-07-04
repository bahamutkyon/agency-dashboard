import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

/**
 * Reads agency_token for WebSocket auth in remote-access mode.
 *
 * Priority: URL ?token= query param (first-time bookmark) → agency_token cookie
 * (set by server after first auth). Returns empty string in local/Tailscale
 * mode where no token is configured — no friction for the common case.
 */
function getAgencyToken(): string {
  if (typeof document === "undefined") return "";
  // Query param takes priority — server will set the cookie on the HTTP side,
  // but the WS handshake fires at the same time so we need the raw value here.
  try {
    const fromQuery = new URL(window.location.href).searchParams.get("token");
    if (fromQuery) return fromQuery;
  } catch { /* non-browser or invalid URL */ }
  // Cookie path — normal case after first visit
  const match = document.cookie
    .split(";")
    .map((s) => s.trim())
    .find((c) => c.startsWith("agency_token="));
  return match ? decodeURIComponent(match.slice("agency_token=".length)) : "";
}

/** Sessions currently joined. Re-emitted automatically on reconnect. */
const joined = new Set<string>();

/**
 * Join a session room and register it for automatic rejoin after reconnect.
 * Use this instead of socket.emit("session:join", ...) directly.
 */
export function joinSession(id: string): void {
  joined.add(id);
  getSocket().emit("session:join", id);
}

/**
 * Leave a session room and remove it from the automatic rejoin set.
 * Call this when a component that joined the session unmounts.
 */
export function leaveSession(id: string): void {
  joined.delete(id);
  getSocket().emit("session:leave", id);
}

export function getSocket(): Socket {
  if (!socket) {
    // Include "polling" as fallback so mobile networks with WebSocket issues
    // can fall back gracefully instead of failing outright.
    // Pass auth token so remote-access mode (ACCESS_TOKEN set) can authenticate
    // the WS handshake. Empty string when no token configured → no-op.
    const token = getAgencyToken();
    socket = io({
      transports: ["websocket", "polling"],
      autoConnect: true,
      ...(token ? { auth: { token } } : {}),
    });

    // On every reconnect (new socket.id), re-join all registered sessions so
    // the server observer is restored. Without this, mobile lock-screen / app
    // switch / Tailscale glitch leaves the client deaf to stream events.
    socket.on("connect", () => {
      for (const id of joined) {
        socket!.emit("session:join", id);
      }
    });
  }
  return socket;
}
