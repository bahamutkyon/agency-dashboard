import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

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
    socket = io({ transports: ["websocket", "polling"], autoConnect: true });

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
