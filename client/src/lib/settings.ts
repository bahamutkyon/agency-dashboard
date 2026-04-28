// Local-storage backed user settings. Read at app boot, applied to <html>
// via data attributes that Tailwind reads.

export type Theme = "dark" | "light";
export type FontSize = "sm" | "md" | "lg";

const KEYS = {
  theme: "agency:theme",
  font: "agency:font",
};

export function getTheme(): Theme {
  return (localStorage.getItem(KEYS.theme) as Theme) || "dark";
}

export function setTheme(t: Theme) {
  localStorage.setItem(KEYS.theme, t);
  applyTheme(t);
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "light") root.classList.add("theme-light");
  else root.classList.remove("theme-light");
}

export function getFont(): FontSize {
  return (localStorage.getItem(KEYS.font) as FontSize) || "md";
}

export function setFont(f: FontSize) {
  localStorage.setItem(KEYS.font, f);
  applyFont(f);
}

export function applyFont(f: FontSize) {
  const root = document.documentElement;
  root.classList.remove("font-scale-sm", "font-scale-md", "font-scale-lg");
  root.classList.add(`font-scale-${f}`);
}

export function applyAll() {
  applyTheme(getTheme());
  applyFont(getFont());
}
