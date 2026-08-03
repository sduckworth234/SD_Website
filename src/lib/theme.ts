// Light/dark theme. The value lives on <html data-theme> so every token in
// styles.css resolves against it; nothing else in the app needs to know.
//
// The *first* application happens in a tiny inline script in index.html, before
// the bundle loads, so the page never paints light and then flip to dark. This
// module has to agree with that script — keep STORAGE_KEY in sync with it.

export type Theme = "light" | "dark";

export const STORAGE_KEY = "sd-theme";

export function systemTheme(): Theme {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

// A stored choice always wins; otherwise follow the OS.
export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Safari private mode throws on localStorage — fall through to the OS.
  }
  return systemTheme();
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  // Keep the browser UI (form controls, scrollbars, the address bar on mobile)
  // in step with the page.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#0b0b0c" : "#f3eee5");
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not being able to persist is not a reason to refuse to switch.
  }
}
