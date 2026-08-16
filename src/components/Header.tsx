import { useEffect, useState } from "react";
import { Moon, Sun, UserRound } from "lucide-react";
import { SHOP_FEATURE_ENABLED } from "../lib/features";
import { applyTheme, readTheme, type Theme } from "../lib/theme";

// Light/dark switch. index.html has already set <html data-theme> before first
// paint, so this only mirrors that value into React state and writes changes
// back — it deliberately does not apply a theme on mount, which would undo the
// pre-paint choice on every navigation.
function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document !== "undefined" &&
    document.documentElement.dataset.theme === "dark"
      ? "dark"
      : "light",
  );

  // Follow the OS while the visitor hasn't expressed a preference of their own.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (localStorage.getItem("sd-theme")) return;
      const next = readTheme();
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }

  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      className="nav-icon theme-toggle"
      onClick={toggle}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={theme === "dark"}
    >
      {theme === "dark" ? (
        <Sun size={16} aria-hidden="true" />
      ) : (
        <Moon size={16} aria-hidden="true" />
      )}
    </button>
  );
}

// Shared site header / primary nav. "Gallery" → the full /galleries page, "Map" →
// /map, About opens the overlay when a handler is supplied (home) else returns
// home. "Shop" is public (the shop page itself shows "Opening soon" to non-admins).
export function Header({
  isScrolled,
  onNavigate,
  onOpenAbout,
}: {
  isScrolled: boolean;
  onNavigate: (route: string) => void;
  onOpenAbout?: () => void;
}) {
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  const isHome = path === "/";

  function navTo(event: React.MouseEvent, route: string) {
    event.preventDefault();
    window.history.pushState({}, "", route);
    onNavigate(route);
  }

  function handleAbout(event: React.MouseEvent) {
    if (onOpenAbout) { onOpenAbout(); return; }
    navTo(event, "/");
  }

  return (
    <header className={`site-header${isScrolled ? " is-visible" : ""}`}>
      {isHome ? (
        <a className="brand" href="#top" aria-label="SD Gallery home">SD</a>
      ) : (
        <a className="brand" href="/" onClick={(event) => navTo(event, "/")} aria-label="SD Gallery home">SD</a>
      )}
      <nav aria-label="Primary navigation">
        <a
          className={`nav-link${path.startsWith("/galleries") ? " is-active" : ""}`}
          href="/galleries"
          onClick={(event) => navTo(event, "/galleries")}
        >
          Gallery
        </a>
        <a
          className={`nav-link${path.startsWith("/map") ? " is-active" : ""}`}
          href="/map"
          onClick={(event) => navTo(event, "/map")}
        >
          Map
        </a>
        <button className="nav-button" onClick={handleAbout} type="button">About Me</button>
        {SHOP_FEATURE_ENABLED ? (
          <a
            className={`nav-link${path.startsWith("/shop") ? " is-active" : ""}`}
            href="/shop"
            onClick={(event) => navTo(event, "/shop")}
          >
            Shop
          </a>
        ) : null}
        <ThemeToggle />
        <a
          className="nav-icon"
          href="/admin"
          onClick={(event) => navTo(event, "/admin")}
          aria-label="Admin sign in"
          title="Admin"
        >
          <UserRound size={18} aria-hidden="true" />
        </a>
      </nav>
    </header>
  );
}
