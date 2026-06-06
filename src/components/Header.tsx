import { UserRound } from "lucide-react";

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
        <a
          className={`nav-link${path.startsWith("/shop") ? " is-active" : ""}`}
          href="/shop"
          onClick={(event) => navTo(event, "/shop")}
        >
          Shop
        </a>
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
