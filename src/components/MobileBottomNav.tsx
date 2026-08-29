import { useEffect } from "react";
import { Home, Images, Map, Mail, ShoppingBag } from "lucide-react";
import { SHOP_FEATURE_ENABLED } from "../lib/features";

// App-style bottom tab bar, mobile only. Self-contained like Header: reads
// window.location itself, so every caller just wires onNavigate (+ the same
// onOpenContact/showShop props Header already takes). Rendered inside Header
// so Home/Gallery/Map/WorkPage/NotFound get it for free; ShopPage renders it
// directly since it has its own nav rather than <Header>.
export function MobileBottomNav({
  onNavigate,
  onOpenContact,
  showShop = false,
}: {
  onNavigate: (route: string) => void;
  onOpenContact?: () => void;
  showShop?: boolean;
}) {
  const path = typeof window !== "undefined" ? window.location.pathname : "/";

  // CSS elsewhere (body-bottom padding, the map's control offset, the home
  // hero's scroll cue) needs to know whether a tab bar is actually occupying
  // the bottom of the viewport on this page — checkout/configurator/admin
  // don't render this component at all, so they don't get the class.
  useEffect(() => {
    document.body.classList.add("has-mobile-tabbar");
    return () => { document.body.classList.remove("has-mobile-tabbar"); };
  }, []);

  // Tapping the tab you're already on scrolls to top instead of pushing a
  // no-op history entry — the familiar "tap again to jump to top" app pattern.
  function go(event: React.MouseEvent, route: string) {
    event.preventDefault();
    if (route === path) {
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      return;
    }
    window.history.pushState({}, "", route);
    onNavigate(route);
  }

  function contact(event: React.MouseEvent) {
    event.preventDefault();
    if (onOpenContact) { onOpenContact(); return; }
    go(event, "/?panel=contact");
  }

  const isHome = path === "/";
  const isGallery = path.startsWith("/galleries");
  const isMap = path.startsWith("/map");
  const isShop = path.startsWith("/shop");

  return (
    <nav className="mobile-tab-bar" aria-label="Primary">
      <a
        href="/"
        className={`mtb-item${isHome ? " is-active" : ""}`}
        aria-current={isHome ? "page" : undefined}
        onClick={(event) => go(event, "/")}
      >
        <Home size={19} strokeWidth={isHome ? 2.25 : 1.75} aria-hidden="true" />
        <span>Home</span>
      </a>
      <a
        href="/galleries"
        className={`mtb-item${isGallery ? " is-active" : ""}`}
        aria-current={isGallery ? "page" : undefined}
        onClick={(event) => go(event, "/galleries")}
      >
        <Images size={19} strokeWidth={isGallery ? 2.25 : 1.75} aria-hidden="true" />
        <span>Gallery</span>
      </a>
      <a
        href="/map"
        className={`mtb-item${isMap ? " is-active" : ""}`}
        aria-current={isMap ? "page" : undefined}
        onClick={(event) => go(event, "/map")}
      >
        <Map size={19} strokeWidth={isMap ? 2.25 : 1.75} aria-hidden="true" />
        <span>Map</span>
      </a>
      {SHOP_FEATURE_ENABLED || showShop ? (
        <a
          href="/shop"
          className={`mtb-item${isShop ? " is-active" : ""}`}
          aria-current={isShop ? "page" : undefined}
          onClick={(event) => go(event, "/shop")}
        >
          <ShoppingBag size={19} strokeWidth={isShop ? 2.25 : 1.75} aria-hidden="true" />
          <span>Shop</span>
        </a>
      ) : null}
      <button className="mtb-item" type="button" onClick={contact}>
        <Mail size={19} strokeWidth={1.75} aria-hidden="true" />
        <span>Contact</span>
      </button>
    </nav>
  );
}
