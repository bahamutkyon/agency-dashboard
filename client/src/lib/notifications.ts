// Thin wrapper around the Web Notification API. We only fire notifications
// when the document is hidden (or window unfocused) — no point pinging the
// user about the chat they're already staring at.

const PREF_KEY = "agency:notifications:enabled";

export function notifSupported(): boolean {
  return typeof Notification !== "undefined";
}

export function notifPref(): boolean {
  if (!notifSupported()) return false;
  return localStorage.getItem(PREF_KEY) !== "off";
}

export function setNotifPref(on: boolean) {
  localStorage.setItem(PREF_KEY, on ? "on" : "off");
}

export async function ensureNotifPermission(): Promise<NotificationPermission> {
  if (!notifSupported()) return "denied";
  if (Notification.permission === "default") {
    return await Notification.requestPermission();
  }
  return Notification.permission;
}

export function notify(title: string, body?: string, opts?: { tag?: string; onClick?: () => void }) {
  if (!notifSupported() || !notifPref()) return;
  if (Notification.permission !== "granted") return;
  // Only ping when user can't see the page already.
  if (document.visibilityState === "visible" && document.hasFocus()) return;

  const n = new Notification(title, {
    body,
    icon: "/favicon.ico",
    tag: opts?.tag,
  });
  if (opts?.onClick) {
    n.onclick = () => {
      window.focus();
      opts.onClick?.();
      n.close();
    };
  }
  setTimeout(() => n.close(), 8000);
}
