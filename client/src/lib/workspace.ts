// Lightweight workspace context — just a single id stored in localStorage and
// in a module-level variable that the API client reads on each request.

const KEY = "agency:workspace";
let active: string = localStorage.getItem(KEY) || "default";
const listeners = new Set<(id: string) => void>();

export function getActiveWorkspace(): string {
  return active;
}

export function setActiveWorkspace(id: string) {
  active = id;
  localStorage.setItem(KEY, id);
  listeners.forEach((cb) => cb(id));
}

export function onWorkspaceChange(cb: (id: string) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Append ?workspace=<active> to a URL — same logic as api.ts's private helper. */
export function withWorkspace(url: string): string {
  const ws = getActiveWorkspace();
  if (!ws) return url;
  return url + (url.includes("?") ? "&" : "?") + "workspace=" + encodeURIComponent(ws);
}
