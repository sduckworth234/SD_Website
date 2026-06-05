import { UserRound } from "lucide-react";

// Shared site header / primary nav. Works from any page: on the home page
// "Galleries" is an in-page anchor scroll; elsewhere it client-navigates to "/".
// "Map" navigates to /map. About opens the overlay when a handler is supplied
// (home page), otherwise it returns home where the overlay lives.
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
  const isMap = path.startsWith("/map");

  function navTo(event: React.MouseEvent, route: string) {
    event.preventDefault();
    window.history.pushState({}, "", route);
    onNavigate(route);
  }

  function handleAbout(event: React.MouseEvent) {
    if (onOpenAbout) {
      onOpenAbout();
      return;
    }
    navTo(event, "/");
  }

  return (
    <header className={`site-header${isScrolled ? " is-visible" : ""}`}>
      {isHome ? (
        <a className="brand" href="#top" aria-label="SD Gallery home">
          SD
        </a>
      ) : (
        <a className="brand" href="/" onClick={(event) => navTo(event, "/")} aria-label="SD Gallery home">
          SD
        </a>
      )}
      <nav aria-label="Primary navigation">
        {isHome ? (
          <a href="#galleries">Galleries</a>
        ) : (
          <a href="/" onClick={(event) => navTo(event, "/")}>
            Galleries
          </a>
        )}
        <a
          className={`nav-link${isMap ? " is-active" : ""}`}
          href="/map"
          onClick={(event) => navTo(event, "/map")}
        >
          Map
        </a>
        <button className="nav-button" onClick={handleAbout} type="button">
          About Me
        </button>
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
