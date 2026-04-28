// First-run tour state — localStorage flag so we don't keep nagging users.

const KEY = "agency:tour-done";

export function isTourDone(): boolean {
  return localStorage.getItem(KEY) === "1";
}

export function markTourDone() {
  localStorage.setItem(KEY, "1");
}

export function resetTour() {
  localStorage.removeItem(KEY);
}
