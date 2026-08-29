import { useEffect, useState } from "react";
import { Menu, Moon, Sun, X } from "lucide-react";
import { SHOP_FEATURE_ENABLED } from "../lib/features";
import { applyTheme, readTheme, type Theme } from "../lib/theme";
import { MobileBottomNav } from "./MobileBottomNav";

// Light/dark switch. index.html has already set <html data-theme> before first
// paint, so this only mirrors that value into React state and writes changes
// back — it deliberately does not apply a theme on mount, which would undo the
// pre-paint choice on every navigation.
export function ThemeToggle() {
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

// Mobile-only auto-hide toolbar behaviour (Safari/Instagram-style): hides on
// scroll-down, reveals on scroll-up or near the top. The floating bottom tab
// bar carries primary navigation full-time now, so the top bar's remaining
// job (brand, theme toggle, the hamburger's About Me / cart) doesn't need to
// stay pinned while reading. The CSS that actually hides anything only
// applies at ≤640px (see .is-auto-hidden in styles.css) — this hook runs on
// every viewport but is a no-op in paint terms on desktop. Shared with
// ShopPage's own ShopNav, which doesn't render <Header>.
export function useAutoHideOnScroll() {
  const [autoHidden, setAutoHidden] = useState(false);

  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    function update() {
      const y = window.scrollY;
      const delta = y - lastY;
      if (y < 60) setAutoHidden(false);
      else if (Math.abs(delta) > 6) setAutoHidden(delta > 0);
      lastY = y;
      ticking = false;
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return autoHidden;
}

// Shared site header / primary nav. "Gallery" → the full /galleries page, "Map" →
// /map, About opens the overlay when a handler is supplied (home) else returns
// home. The Shop link follows the public build gate, with an explicit override
// for a signed-in admin viewing the public site.
export function Header({
  isScrolled,
  onNavigate,
  onOpenAbout,
  onOpenContact,
  showShop = false,
}: {
  isScrolled: boolean;
  onNavigate: (route: string) => void;
  onOpenAbout?: () => void;
  onOpenContact?: () => void;
  showShop?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const autoHidden = useAutoHideOnScroll();
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  const isHome = path === "/";

  function navTo(event: React.MouseEvent, route: string) {
    event.preventDefault();
    setMenuOpen(false);
    window.history.pushState({}, "", route);
    onNavigate(route);
  }

  function handleAbout(event: React.MouseEvent) {
    setMenuOpen(false);
    if (onOpenAbout) { onOpenAbout(); return; }
    navTo(event, "/?panel=about");
  }

  function handleContact(event: React.MouseEvent) {
    setMenuOpen(false);
    if (onOpenContact) { onOpenContact(); return; }
    navTo(event, "/?panel=contact");
  }

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <>
    <header className={`site-header${isScrolled ? " is-visible" : ""}${autoHidden ? " is-auto-hidden" : ""}`}>
      {isHome ? (
        <a className="brand" href="#top" aria-label="SD Gallery home">SD</a>
      ) : (
        <a className="brand" href="/" onClick={(event) => navTo(event, "/")} aria-label="SD Gallery home">SD</a>
      )}
      <nav aria-label="Primary navigation">
        {!isHome ? (
          <a className="nav-link" href="/" onClick={(event) => navTo(event, "/")}>
            Home
          </a>
        ) : null}
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
        {SHOP_FEATURE_ENABLED || showShop ? (
          <a
            className={`nav-link${path.startsWith("/shop") ? " is-active" : ""}`}
            href="/shop"
            onClick={(event) => navTo(event, "/shop")}
          >
            Shop
          </a>
        ) : null}
        <ThemeToggle />
        <button
          className="nav-icon mobile-menu-toggle"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="mobile-primary-navigation"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
        </button>
      </nav>
      {menuOpen ? <button className="mobile-nav-dismiss" onClick={() => setMenuOpen(false)} type="button" aria-label="Close navigation" /> : null}
      <nav
        id="mobile-primary-navigation"
        className={`mobile-nav-panel${menuOpen ? " is-open" : ""}`}
        aria-label="Mobile navigation"
        aria-hidden={!menuOpen}
        inert={!menuOpen}
      >
        <a href="/" aria-current={isHome ? "page" : undefined} onClick={(event) => navTo(event, "/")}>Home</a>
        <a href="/galleries" aria-current={path.startsWith("/galleries") ? "page" : undefined} onClick={(event) => navTo(event, "/galleries")}>Gallery</a>
        <a href="/map" aria-current={path.startsWith("/map") ? "page" : undefined} onClick={(event) => navTo(event, "/map")}>Map</a>
        <button onClick={handleAbout} type="button">About Me</button>
        {SHOP_FEATURE_ENABLED || showShop ? (
          <a href="/shop" aria-current={path.startsWith("/shop") ? "page" : undefined} onClick={(event) => navTo(event, "/shop")}>Shop</a>
        ) : null}
        <button onClick={handleContact} type="button">Contact</button>
      </nav>
    </header>
    <MobileBottomNav onNavigate={onNavigate} onOpenContact={onOpenContact} showShop={showShop} />
    </>
  );
}
