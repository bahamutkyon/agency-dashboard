import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Read .env.local from project root (one level up from client/) so the
// same toggle controls both server and Vite. We use a tiny inline parser
// to avoid pulling dotenv into the client toolchain.
function readProjectEnv(): Record<string, string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, "..");
  const out: Record<string, string> = {};
  for (const file of [".env", ".env.local"]) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    for (const raw of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[k] = v;
    }
  }
  return out;
}

export default defineConfig(() => {
  const env = readProjectEnv();
  const remoteOn = (env.ENABLE_REMOTE_ACCESS || "").toLowerCase() === "true";

  if (remoteOn) {
    console.log("[vite] 🌐 ENABLE_REMOTE_ACCESS=true → binding 0.0.0.0 (LAN/Tailscale accessible)");
  }

  return {
    plugins: [react()],
    server: {
      port: 5190,
      strictPort: false,
      host: remoteOn ? "0.0.0.0" : "localhost",
      proxy: {
        "/api": {
          target: "http://localhost:5191",
          changeOrigin: true,
        },
        "/socket.io": {
          target: "http://localhost:5191",
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});
