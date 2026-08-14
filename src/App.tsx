import type { Session } from "@supabase/supabase-js";
import {
  ArrowUpDown,
  ArrowUpFromLine,
  ArrowUpToLine,
  Check,
  Copy,
  Crosshair,
  Eye,
  EyeOff,
  Frame,
  Globe,
  Images,
  Instagram,
  LayoutDashboard,
  LayoutGrid,
  Lock,
  LogOut,
  Heart,
  MapPin,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Pencil,
  Plane,
  Plus,
  RotateCw,
  Search,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import type { CSSProperties, DependencyList, ReactNode } from "react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  assignRecentSlot,
  bulkEditPhotos,
  createCollection,
  createLocation,
  setLocationOrder,
  createPhotoRecord,
  deleteCollection,
  deletePhoto,
  ensureLocation,
  getAdminCollections,
  getAdminPhotos,
  getCollectionMembership,
  getGalleryData,
  getInstagramPosts,
  getRecentPhotos,
  getSiteSettings,
  getTransformedPublicUrl,
  hasSupabaseEnv,
  photoBucket,
  isCurrentUserAdmin,
  sendPhotoToTop,
  setCollectionPhotos,
  setCollectionPicks,
  setLocationFeedOrder,
  setMapFeature,
  setPhotoShop,
  removeUploadedAsset,
  setSiteFlag,
  setSiteSetting,
  supabase,
  updateCollection,
  updatePhotoDetails,
  updatePhotoCuration,
  updatePhotoVisibility,
  uploadPhotoAsset,
} from "./lib/supabase";
import type { Collection, GalleryLocation, InstagramPost, LocationBucket, Photo, SiteSetting } from "./types";
import { collectionTitle } from "./types";
import { compressToWebp, extractPhotoMetadata } from "./lib/ingest";
import { prewarmPhoto } from "./lib/viewTransition";

// Shared so the pre-warm resolves the SAME srcset candidate the lightbox <img>
// will request — warming a different variant would help nothing.
const LIGHTBOX_SIZES = "(max-width: 920px) 92vw, 60vw";
// Keep in step with the .lightbox.is-closing animation in styles.css.
const LIGHTBOX_EXIT_MS = 190;
import type { ExtractedPhotoMeta } from "./lib/ingest";
import { reverseGeocode } from "./lib/geocode";
import type { Placement } from "./lib/geocode";
import { useSeo } from "./lib/seo";
import { Header } from "./components/Header";
import { OakFrame } from "./components/OakFrame";
import { SmartImage } from "./components/SmartImage";
import { PrintConfigurator } from "./components/PrintConfigurator";
import { useCart } from "./lib/cart";
import { money, priceFor } from "./lib/printCatalogue";

// Lazy-loaded so MapLibre + the basemap stay out of the main gallery bundle.
const MapPage = lazy(() => import("./MapPage"));

const allLocations = "All work";
type ActiveLocation = LocationBucket | typeof allLocations;

type GalleryView = "flow" | "box";

// Pick a pseudo-random landing category, avoiding the one shown last time so
// reloads cycle through the locations rather than repeating.
function pickLandingLocation(names: string[]): string {
  if (names.length <= 1) return names[0] ?? allLocations;
  let last = "";
  try { last = window.localStorage.getItem("sd_last_location") ?? ""; } catch { /* ignore */ }
  const pool = names.filter((name) => name !== last);
  const choice = pool[Math.floor(Math.random() * pool.length)] ?? names[0];
  try { window.localStorage.setItem("sd_last_location", choice); } catch { /* ignore */ }
  return choice;
}

// Deep link the map's markers use: /?location=Name opens the gallery on that
// category. Falls back to the random landing when absent or invalid.
function readLocationParam(): string | null {
  try { return new URLSearchParams(window.location.search).get("location"); } catch { return null; }
}

// /galleries?collection=europe-2024 — how the 2026 hero and any shared link
// open the gallery scoped to one collection.
function readCollectionParam(): string | null {
  try { return new URLSearchParams(window.location.search).get("collection"); } catch { return null; }
}

// Tracks a media query. Drives the galleries filter's one real breakpoint:
// desktop shows both rails at once, phones switch between them (two sticky
// rails would eat most of a phone screen before a single photo appeared).
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => {
    try { return window.matchMedia(query).matches; } catch { return false; }
  });
  useEffect(() => {
    let mq: MediaQueryList;
    try { mq = window.matchMedia(query); } catch { return; }
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

// A right-sized image variant (the gallery imageUrl is 1800px — too big for small
// collection/shop thumbnails).
function thumbUrl(photo: Photo, width: number): string {
  return photo.storagePath ? getTransformedPublicUrl(photoBucket, photo.storagePath, width) : photo.imageUrl;
}

// Nominal width/height per aspect bucket — the tile-shape fallback for photos
// whose exact `ratio` hasn't been backfilled. Close enough that the cover-crop
// is a few percent at most.
const BUCKET_RATIO: Record<Photo["aspect"], number> = { portrait: 0.75, landscape: 1.45, square: 1, wide: 2 };
const tileRatio = (photo: Photo) => photo.ratio ?? BUCKET_RATIO[photo.aspect] ?? 1.45;

// The grid's rendered-width hint, shared by the tiles and the preloaders so
// they all resolve to the same srcset variant.
const GRID_SIZES = "(max-width: 620px) 50vw, (max-width: 1024px) 33vw, 25vw";

// Responsive srcset across a range of widths so phones don't download the full
// 1800px image. Falls back to the single imageUrl when there's no storage path.
const SRCSET_WIDTHS = [400, 700, 1000, 1400, 1800];

// How many tiles load eagerly / get pre-warmed before reveal. Phones show ~2
// columns, so 15 would pull several off-screen rows before first paint — scale
// it down on small screens so phones paint sooner on a slow network.
const EAGER_TILE_COUNT =
  typeof window !== "undefined" && window.matchMedia?.("(max-width: 620px)").matches ? 6 : 15;
function srcSetFor(photo: Photo): string | undefined {
  if (!photo.storagePath) return undefined;
  return SRCSET_WIDTHS.map((w) => `${getTransformedPublicUrl(photoBucket, photo.storagePath as string, w)} ${w}w`).join(", ");
}

// Surface inline admin mutation failures (RLS/network) instead of silently
// swallowing them — these fire from the public pages, which have no message
// banner, so a plain alert is the honest fallback.
async function reportAdminError(action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "The change could not be saved.");
  }
}

function useScrollReveal(dependencies: DependencyList) {
  useEffect(() => {
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(".scroll-reveal:not(.is-visible)"),
    );

    if (!elements.length) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      elements.forEach((element) => element.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      {
        rootMargin: "0px 0px -12% 0px",
        threshold: 0.12,
      },
    );

    elements.forEach((element) => observer.observe(element));

    // Fail-safe. Content must never be permanently invisible because an
    // animation trigger didn't fire — a missed callback shouldn't be able to
    // hide a whole section. This sweeps anything already within the viewport
    // and reveals it, covering restores from bfcache, a tab that was
    // backgrounded during load, and observer callbacks that never arrive.
    const sweep = () => {
      for (const element of elements) {
        if (element.classList.contains("is-visible")) continue;
        const box = element.getBoundingClientRect();
        if (box.top < window.innerHeight && box.bottom > 0) {
          element.classList.add("is-visible");
          observer.unobserve(element);
        }
      }
    };
    const sweepTimer = window.setTimeout(sweep, 1200);
    window.addEventListener("pageshow", sweep);
    document.addEventListener("visibilitychange", sweep);

    return () => {
      observer.disconnect();
      window.clearTimeout(sweepTimer);
      window.removeEventListener("pageshow", sweep);
      document.removeEventListener("visibilitychange", sweep);
    };
  }, dependencies);
}

// Drone flight height for the corner badge: rounded to whole metres, and only
// when the reading is a meaningful positive height. This hides non-drone photos
// (no altitude), negatives / ~0m "flown below launch" frames, and any single
// out-of-range barometric fault that slipped through the backfill.
function altitudeMeters(photo: Photo): number | null {
  const a = photo.relativeAltitude;
  if (a == null) return null;
  const m = Math.round(a);
  return m >= 1 && m <= 1000 ? m : null;
}

// Small "203 m" altitude badge pinned to the bottom-right of a drone photo.
// Renders nothing when the photo has no usable height.
function AltitudeBadge({ photo }: { photo: Photo }) {
  const m = altitudeMeters(photo);
  if (m === null) return null;
  return (
    <span
      className="alt-badge"
      title={`Flown at ${m} m above launch`}
      aria-label={`Altitude ${m} metres`}
    >
      <ArrowUpFromLine size={11} aria-hidden="true" />
      {m} m
    </span>
  );
}

function App() {
  // Route state carries path + query so history moves between e.g.
  // /galleries?location=A and /galleries?location=B re-render the page (the
  // query is read in component initializers; the key below remounts on change).
  const currentHref = () => window.location.pathname + window.location.search;
  const [route, setRoute] = useState(currentHref);

  // Programmatic navigation: switch page AND jump to the top, so clicking a
  // collection card (etc.) lands at the top of the destination rather than
  // keeping the previous page's scroll offset. Callers pushState before calling
  // this, so the source of truth is window.location. The Back button (popstate)
  // keeps its own scroll restoration — it doesn't go through here.
  const navigate = useCallback((_next: string) => {
    setRoute(currentHref());
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }, []);

  useEffect(() => {
    const onPopState = () => setRoute(currentHref());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Light deterrent: block right-click "Save image" on photos. The full-res file
  // is never served (only ≤2400px WebP), so this just discourages casual saving.
  useEffect(() => {
    const block = (event: MouseEvent) => {
      if (event.target instanceof HTMLImageElement) event.preventDefault();
    };
    document.addEventListener("contextmenu", block);
    return () => document.removeEventListener("contextmenu", block);
  }, []);

  // Exact-or-subpath match (plain startsWith would let /mapping render the map).
  const path = route.split("?")[0];
  const matches = (base: string) => path === base || path === `${base}/`;

  if (matches("/admin")) {
    return <AdminApp onNavigate={navigate} />;
  }

  if (matches("/map")) {
    return (
      <Suspense fallback={<div className="map-shell map-loading" aria-label="Loading map" />}>
        <MapPage key={route} onNavigate={navigate} />
      </Suspense>
    );
  }

  if (matches("/shop")) {
    return <ShopPage onNavigate={navigate} />;
  }

  if (path.startsWith("/shop/")) {
    const slug = path.slice("/shop/".length).replace(/\/$/, "");
    return <ShopProductRoute slug={slug} onNavigate={navigate} />;
  }

  if (matches("/galleries")) {
    return <GalleriesPage key={route} onNavigate={navigate} />;
  }

  if (path === "/" || path === "") {
    return <Home onNavigate={navigate} />;
  }

  return <NotFound onNavigate={navigate} />;
}

// Rebuild the Recent Work mosaic from photos already in memory. Mirrors the
// server-side pick: admin-pinned photos (featured, sort_order 1..limit) sit in
// their chosen slot, and the remaining slots fill in gallery order.
function deriveRecentWork(all: Photo[], limit: number): Photo[] {
  const usable = all.filter((p) => p.published !== false && p.location && p.location !== "Unsorted");
  const slots: (Photo | null)[] = Array.from({ length: limit }, () => null);
  const placed = new Set<string>();
  for (const p of usable) {
    const slot = (p.sortOrder ?? 0) - 1;
    if (p.featured && slot >= 0 && slot < limit && !slots[slot]) {
      slots[slot] = p;
      placed.add(p.id);
    }
  }
  const fill = usable.filter((p) => !placed.has(p.id));
  let f = 0;
  for (let i = 0; i < limit; i += 1) {
    if (!slots[i] && f < fill.length) slots[i] = fill[f++];
  }
  return slots.filter(Boolean) as Photo[];
}

// Shared data (photos, locations, recent), admin detection, scroll state and the
// derived public/location lists — used by both the Home page and Galleries page.
function useSiteData() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [recentPhotos, setRecentPhotos] = useState<Photo[]>([]);
  const [locations, setLocations] = useState<GalleryLocation[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [instagramPosts, setInstagramPosts] = useState<InstagramPost[]>([]);
  const [settings, setSettings] = useState<SiteSetting[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadGallery = useCallback(async () => {
    const [data, recent, siteSettings, igPosts] = await Promise.all([
      getGalleryData(),
      getRecentPhotos(9),
      getSiteSettings(),
      getInstagramPosts(),
    ]);
    setPhotos(data.photos);
    // Recent Work is its own request, and it used to return [] on ANY failure —
    // no retry, no fallback — so a single flaky call on mobile data made the
    // section vanish while the rest of the page loaded fine. Everything it
    // needs is already in the gallery payload, so fall back to deriving it
    // rather than showing nothing.
    setRecentPhotos(recent.length >= 5 ? recent : deriveRecentWork(data.photos, 9));
    setLocations(data.locations);
    setCollections(data.collections ?? []);
    setSettings(siteSettings);
    setInstagramPosts(igPosts);
  }, []);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Initial load. The safety timeout guarantees the skeleton clears even if a
  // fetch never settles (e.g. a request left in-flight when the tab was
  // suspended for hours) — so the page can't get stuck on the loader.
  const lastLoadRef = useRef(Date.now());
  useEffect(() => {
    let done = false;
    loadGallery().finally(() => { done = true; lastLoadRef.current = Date.now(); setIsLoading(false); });
    const timer = window.setTimeout(() => { if (!done) setIsLoading(false); }, 15000);
    return () => window.clearTimeout(timer);
  }, [loadGallery]);

  // Reopened-tab freshness: when the page returns to the foreground after being
  // away for a while (or is restored from the back/forward cache), silently
  // re-fetch so stale or half-loaded content lands — no visible page reload.
  useEffect(() => {
    const STALE_MS = 60_000;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastLoadRef.current < STALE_MS) return;
      lastLoadRef.current = Date.now();
      loadGallery().finally(() => setIsLoading(false));
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) { lastLoadRef.current = 0; refresh(); }
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [loadGallery]);

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setAdminChecked(true); return; }
    let active = true;
    const check = async () => {
      const { data } = await sb.auth.getSession();
      if (!data.session) { if (active) { setIsAdmin(false); setAdminChecked(true); } return; }
      const ok = await isCurrentUserAdmin();
      if (active) { setIsAdmin(ok); setAdminChecked(true); }
    };
    check();
    const { data } = sb.auth.onAuthStateChange(() => check());
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  const publicPhotos = useMemo(
    () => photos.filter((photo) => photo.location !== "Unsorted"),
    [photos],
  );
  const locationNames = useMemo(() => {
    const present = new Set(publicPhotos.map((photo) => photo.location));
    const ordered = locations
      .map((location) => location.name)
      .filter((name) => present.has(name) && name !== "Unsorted");
    const extra = [...present].filter(
      (name) => name && name !== "Unsorted" && !locations.some((l) => l.name === name),
    );
    return [...ordered, ...extra];
  }, [publicPhotos, locations]);

  // Visibility flags (key→enabled) and small key/value settings (key→value),
  // e.g. the chosen Framed Editions banner photos. A missing flag defaults to
  // visible so the site never hides itself if a row is absent.
  const flags = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const s of settings) map[s.key] = s.enabled;
    return map;
  }, [settings]);
  const settingValue = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const s of settings) map[s.key] = s.value;
    return map;
  }, [settings]);

  // Only collections that still have a published photo reach the public rail —
  // a trip created before its upload (2026 Europe) stays invisible until it has
  // something to show. Admins see every collection so they can curate it.
  const visibleCollections = useMemo(() => {
    const populated = new Set<string>();
    for (const photo of publicPhotos) {
      for (const id of photo.collectionIds ?? []) populated.add(id);
    }
    return collections.filter((c) => (isAdmin ? true : c.isVisible && populated.has(c.id)));
  }, [collections, publicPhotos, isAdmin]);

  return { photos, recentPhotos, locations, collections, visibleCollections, instagramPosts, settings, flags, settingValue, publicPhotos, locationNames, isAdmin, adminChecked, isScrolled, isLoading, loadGallery };
}

// A flag is "on" unless explicitly set to false (absent row = visible).
function flagOn(flags: Record<string, boolean>, key: string) {
  return flags[key] !== false;
}

// Wraps a home section governed by a visibility flag. Public visitors see
// nothing when it's hidden; the admin still sees it (to preview/curate) with a
// small "hidden from public" tag so it's obvious the public can't.
function AdminHideable({ visible, isAdmin, label, children }: { visible: boolean; isAdmin: boolean; label: string; children: ReactNode }) {
  if (visible) return <>{children}</>;
  if (!isAdmin) return null;
  return (
    <div className="admin-hidden">
      <span className="admin-hidden-tag"><EyeOff size={13} aria-hidden="true" /> {label} · hidden from public</span>
      {children}
    </div>
  );
}

// The landing page: hero, recent work, the map teaser, location collection cards,
// and (admin-only for now) the Framed Editions shop banner.
function Home({ onNavigate }: { onNavigate: (route: string) => void }) {
  const { photos, recentPhotos, publicPhotos, locations, locationNames, collections, instagramPosts, flags, settingValue, isAdmin, isScrolled, isLoading, loadGallery } = useSiteData();
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  // Shared shape for the lightbox pre-warm — see lib/viewTransition.ts.
  const morphTarget = (photo: Photo) => ({
    id: photo.id,
    src: photo.imageUrl,
    srcSet: srcSetFor(photo),
    sizes: LIGHTBOX_SIZES,
  });
  const openPhoto = (photo: Photo, from?: HTMLElement) => {
    // Remember where the tap came from so the panel can grow out of that tile
    // rather than out of the middle of the screen (apple-design §7: anchor
    // interactions to their source).
    const box = from?.getBoundingClientRect();
    setOrigin(box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null);
    setSelectedPhoto(photo);
  };
  // Start the lightbox image downloading on finger-down, so the photo is
  // already decoded when the panel opens rather than popping in after it.
  const warmPhoto = (photo: Photo) => prewarmPhoto(morphTarget(photo));
  const closePhoto = () => setSelectedPhoto(null);

  const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null);
  const [recentSlot, setRecentSlot] = useState<number | null>(null);
  const [editingCollection, setEditingCollection] = useState<GalleryLocation | null>(null);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [heroPicking, setHeroPicking] = useState(false);

  function goToMap() { window.history.pushState({}, "", "/map"); onNavigate("/map"); }
  function goToShop() { window.history.pushState({}, "", "/shop"); onNavigate("/shop"); }
  function goToGalleries(collectionSlug?: string | null) {
    const query = collectionSlug ? `?collection=${encodeURIComponent(collectionSlug)}` : "";
    window.history.pushState({}, "", `/galleries${query}`);
    onNavigate("/galleries");
  }
  function viewPhotoOnMap(photo: Photo) {
    if (photo.latitude == null || photo.longitude == null) return;
    window.history.pushState({}, "", `/map?lat=${photo.latitude}&lng=${photo.longitude}`);
    onNavigate("/map");
  }
  function openLocation(name: string) {
    window.history.pushState({}, "", `/galleries?location=${encodeURIComponent(name)}`);
    onNavigate("/galleries");
  }

  // Banner frames: admin-chosen photos (site_settings) win; otherwise auto-pick
  // a portrait + a landscape so the banner always has something to show.
  const heroPortrait = useMemo(() => {
    const pick = settingValue.banner_portrait
      ? publicPhotos.find((p) => p.id === settingValue.banner_portrait)
      : undefined;
    return pick ?? publicPhotos.find((p) => p.aspect === "portrait") ?? publicPhotos[0];
  }, [publicPhotos, settingValue.banner_portrait]);
  const heroLandscape = useMemo(() => {
    const pick = settingValue.banner_landscape
      ? publicPhotos.find((p) => p.id === settingValue.banner_landscape)
      : undefined;
    return pick ?? publicPhotos.find((p) => p.aspect === "landscape" || p.aspect === "wide") ?? publicPhotos[1];
  }, [publicPhotos, settingValue.banner_landscape]);

  // The cinematic landing photo: an admin-chosen one (site_settings) wins, else
  // fall back to a featured wide/landscape so the hero is always filled.
  const heroPhoto = useMemo(() => {
    const chosen = settingValue.hero_photo
      ? publicPhotos.find((p) => p.id === settingValue.hero_photo)
      : undefined;
    return (
      chosen ??
      publicPhotos.find((p) => p.featured && (p.aspect === "landscape" || p.aspect === "wide")) ??
      publicPhotos.find((p) => p.aspect === "wide") ??
      publicPhotos.find((p) => p.aspect === "landscape") ??
      publicPhotos[0]
    );
  }, [publicPhotos, settingValue.hero_photo]);
  // Optional mobile rotation for the hero: "90" or "270" rotates a landscape
  // birds-eye upright to fill the portrait phone area with the whole image (no
  // crop). "0" = no rotation (covers/centre-crops as usual).
  const heroRotate = settingValue.hero_mobile_rotate ?? "0";

  // The 2026 Europe hero: an admin-curated, ordered photo list stored as a
  // JSON id array in site_settings (same pattern as the shop's "wall" preview).
  // Empty/unset = the section doesn't render at all (see Hero2026).
  const hero2026Photos = useMemo(() => {
    let ids: string[] = [];
    try {
      ids = settingValue.hero_2026_photos ? (JSON.parse(settingValue.hero_2026_photos) as string[]) : [];
    } catch {
      ids = [];
    }
    const byId = new Map(publicPhotos.map((p) => [p.id, p]));
    return ids.map((id) => byId.get(id)).filter((p): p is Photo => Boolean(p));
  }, [publicPhotos, settingValue.hero_2026_photos]);

  // Where the banner clicks through to. Defaults to whichever collection its own
  // curated photos mostly belong to — so it lands on the trip it depicts without
  // anything to configure — and `hero_2026_collection` overrides that by slug.
  const hero2026Target = useMemo(() => {
    const explicit = settingValue.hero_2026_collection;
    // Sentinel from the admin dropdown: deliberately open the whole gallery.
    if (explicit === "__none__") return null;
    if (explicit) return explicit;
    const tally = new Map<string, number>();
    for (const photo of hero2026Photos) {
      for (const id of photo.collectionIds ?? []) tally.set(id, (tally.get(id) ?? 0) + 1);
    }
    let bestId: string | null = null;
    let best = 0;
    for (const [id, count] of tally) {
      if (count > best) { best = count; bestId = id; }
    }
    return bestId ? collections.find((c) => c.id === bestId)?.slug ?? null : null;
  }, [settingValue.hero_2026_collection, hero2026Photos, collections]);

  useSeo("Sam Duckworth Photography — Aerial & Landscape, Northern Beaches", { path: "/" });
  useScrollReveal([isLoading, recentPhotos.length, locationNames.length]);

  return (
    <main>
      <Header isScrolled={isScrolled} onNavigate={onNavigate} onOpenAbout={() => setIsAboutOpen(true)} />
      <Hero photo={heroPhoto} locations={locationNames} isAdmin={isAdmin} rotate={heroRotate} onPickHero={() => setHeroPicking(true)} />
      <div id="galleries" className="section-anchor" aria-hidden="true" />
      {isLoading ? (
        <>
          <RecentWorkSkeleton />
          <CollectionsSkeleton />
        </>
      ) : (
        <>
          {hero2026Photos.length ? (
            <AdminHideable isAdmin={isAdmin} visible={flagOn(flags, "hero_2026")} label="2026 Europe hero">
              <Hero2026
                heading={settingValue.hero_2026_title || "Europe 2026"}
                onOpen={() => goToGalleries(hero2026Target)}
                photos={hero2026Photos}
              />
            </AdminHideable>
          ) : null}
          {recentPhotos.length >= 5 ? (
            <AdminHideable isAdmin={isAdmin} visible={flagOn(flags, "recent_work")} label="Recent Work">
              <RecentWork
                isAdmin={isAdmin}
                onChangePhoto={setRecentSlot}
                onEditPhoto={setEditingPhoto}
                onSelect={openPhoto}
                onWarm={warmPhoto}
                photos={recentPhotos}
              />
            </AdminHideable>
          ) : null}
          <AdminHideable isAdmin={isAdmin} visible={flagOn(flags, "map_promo")} label="Map promo">
            <MapPromo photos={publicPhotos} locations={locations} onOpen={goToMap} />
          </AdminHideable>
          <AdminHideable isAdmin={isAdmin} visible={flagOn(flags, "collection_cards")} label="Collections">
            <CollectionCards photos={publicPhotos} locations={locations} onOpen={openLocation} onOpenAll={() => goToGalleries()} isAdmin={isAdmin} onEdit={setEditingCollection} />
          </AdminHideable>
          {heroPortrait ? (
            <AdminHideable isAdmin={isAdmin} visible={flagOn(flags, "framed_banner")} label="Framed Editions banner">
              <FramedHero portrait={heroPortrait} landscape={heroLandscape} onShop={goToShop} />
            </AdminHideable>
          ) : null}
          <AdminHideable isAdmin={isAdmin} visible={flagOn(flags, "contact_prompt")} label="Contact">
            <ContactPrompt onOpen={() => setIsContactOpen(true)} />
          </AdminHideable>
          {instagramPosts.length ? (
            <AdminHideable isAdmin={isAdmin} visible={flagOn(flags, "instagram_feed")} label="Instagram feed">
              <InstagramFeed posts={instagramPosts} />
            </AdminHideable>
          ) : null}
        </>
      )}
      <Footer />
      {selectedPhoto ? (
        <Lightbox
          photo={selectedPhoto}
          onClose={closePhoto}
          origin={origin}
          onViewOnMap={viewPhotoOnMap}
          onViewGallery={(p) => openLocation(p.location)}
          onOrderPrint={flags.print_configurator === true ? (p) => { window.history.pushState({}, "", `/shop/${p.slug}`); onNavigate(`/shop/${p.slug}`); } : undefined}
        />
      ) : null}
      {editingPhoto ? (
        <PhotoEditOverlay locations={locations} onClose={() => setEditingPhoto(null)} onSaved={loadGallery} photo={editingPhoto} />
      ) : null}
      {isAboutOpen ? <AboutOverlay onClose={() => setIsAboutOpen(false)} /> : null}
      {isContactOpen ? <ContactOverlay onClose={() => setIsContactOpen(false)} /> : null}
      {recentSlot !== null ? (
        <RecentPicker
          onClose={() => setRecentSlot(null)}
          onPick={async (photo) => {
            await reportAdminError(async () => {
              await assignRecentSlot(recentSlot, photo.id);
              await loadGallery();
              setRecentSlot(null);
            });
          }}
          photos={photos}
        />
      ) : null}
      {heroPicking ? (
        <HeroPicker
          photos={publicPhotos}
          currentId={heroPhoto?.id}
          currentRotate={heroRotate}
          onClose={() => setHeroPicking(false)}
          onSave={async (photoId, rotate) => {
            await setSiteSetting("hero_photo", photoId);
            await setSiteSetting("hero_mobile_rotate", rotate === "0" ? null : rotate);
            await loadGallery();
            setHeroPicking(false);
          }}
        />
      ) : null}
      {editingCollection ? (
        <OrderedPhotoPicker
          title={`Featured in the ${editingCollection.name} card`}
          hint="Pick up to 5 photos to slowly cycle on the home page — the number shows the order. Leave empty to auto-fill with the latest."
          max={5}
          photos={publicPhotos.filter((p) => p.location === editingCollection.name)}
          initialIds={publicPhotos
            .filter((p) => p.location === editingCollection.name && p.collectionOrder != null)
            .sort((a, b) => (a.collectionOrder ?? 0) - (b.collectionOrder ?? 0))
            .map((p) => p.id)}
          onClose={() => setEditingCollection(null)}
          onSave={async (ids) => { await setCollectionPicks(editingCollection.id, ids); await loadGallery(); setEditingCollection(null); }}
        />
      ) : null}
      <InstagramRail />
    </main>
  );
}

// The full photo gallery (moved off the home page): filter rail + masonry/box
// grid + lightbox, with inline admin tools and ?location= deep-linking.
function GalleriesPage({ onNavigate }: { onNavigate: (route: string) => void }) {
  const { publicPhotos, locations, visibleCollections, flags, isAdmin, isLoading, loadGallery } = useSiteData();
  const [activeLocation, setActiveLocation] = useState<ActiveLocation>(() => readLocationParam() ?? allLocations);
  const [activeCollectionId, setActiveCollectionId] = useState<string>(ALL_COLLECTIONS);
  // Phones can't afford two sticky rails, so they switch between them instead.
  const isPhone = useMediaQuery("(max-width: 760px)");
  const [mobileAxis, setMobileAxis] = useState<"collections" | "places">("collections");
  const [view, setView] = useState<GalleryView>("flow");
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  // Shared shape for the lightbox pre-warm — see lib/viewTransition.ts.
  const morphTarget = (photo: Photo) => ({
    id: photo.id,
    src: photo.imageUrl,
    srcSet: srcSetFor(photo),
    sizes: LIGHTBOX_SIZES,
  });
  const openPhoto = (photo: Photo, from?: HTMLElement) => {
    // Remember where the tap came from so the panel can grow out of that tile
    // rather than out of the middle of the screen (apple-design §7: anchor
    // interactions to their source).
    const box = from?.getBoundingClientRect();
    setOrigin(box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null);
    setSelectedPhoto(photo);
  };
  // Start the lightbox image downloading on finger-down, so the photo is
  // already decoded when the panel opens rather than popping in after it.
  const warmPhoto = (photo: Photo) => prewarmPhoto(morphTarget(photo));
  const closePhoto = () => setSelectedPhoto(null);

  const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null);
  const [imagesReady, setImagesReady] = useState(false);

  const activeCollection = activeCollectionId === ALL_COLLECTIONS
    ? null
    : visibleCollections.find((c) => c.id === activeCollectionId) ?? null;

  // Resolve ?collection=slug once the collections have loaded.
  const collectionParamApplied = useRef(false);
  useEffect(() => {
    if (collectionParamApplied.current || !visibleCollections.length) return;
    collectionParamApplied.current = true;
    const slug = readCollectionParam();
    if (!slug) return;
    const match = visibleCollections.find((c) => c.slug === slug);
    if (match) setActiveCollectionId(match.id);
  }, [visibleCollections]);

  // Photos inside the active collection — the pool everything else derives from.
  const scopedPhotos = useMemo(() => {
    if (!activeCollection) return publicPhotos;
    return publicPhotos.filter((p) => (p.collectionIds ?? []).includes(activeCollection.id));
  }, [publicPhotos, activeCollection]);

  // The places rail is rebuilt from the scoped pool, so choosing "2022 Europe"
  // leaves only Italy/Monaco/Greece — the whole point of the collections axis.
  const scopedLocationNames = useMemo(() => {
    const seen = new Set<string>();
    for (const photo of scopedPhotos) {
      if (photo.location && photo.location !== "Unsorted") seen.add(photo.location);
    }
    return [...seen];
  }, [scopedPhotos]);

  const collectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const photo of publicPhotos) {
      for (const id of photo.collectionIds ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [publicPhotos]);

  async function unpublishPhoto(photo: Photo) {
    if (!window.confirm(`Unpublish "${photo.title}"? It will disappear from the public gallery.`)) return;
    await reportAdminError(async () => {
      await updatePhotoVisibility(photo.id, { featured: Boolean(photo.featured), published: false });
      await loadGallery();
    });
  }
  async function sendToTop(photo: Photo) {
    await reportAdminError(async () => { await sendPhotoToTop(photo.id); await loadGallery(); });
  }
  async function toggleMapFeature(photo: Photo) {
    await reportAdminError(async () => { await setMapFeature(photo.id, !photo.mapFeature); await loadGallery(); });
  }
  function viewOnMap() {
    const query = activeLocation !== allLocations ? `?focus=${encodeURIComponent(activeLocation)}` : "";
    window.history.pushState({}, "", `/map${query}`);
    onNavigate("/map");
  }
  function viewPhotoOnMap(photo: Photo) {
    if (photo.latitude == null || photo.longitude == null) return;
    window.history.pushState({}, "", `/map?lat=${photo.latitude}&lng=${photo.longitude}`);
    onNavigate("/map");
  }

  useEffect(() => {
    // "All work" is always valid; a specific place is only valid while it still
    // has photos WITHIN THE ACTIVE COLLECTION. Switching to a collection that
    // lacks your current place (Albania is 2024-only) drops back to "All work"
    // rather than stranding you on an empty grid you never asked for.
    if (activeLocation === allLocations) return;
    // Nothing has loaded yet, so nothing can be judged invalid. Without this a
    // deep-linked ?location= is wiped on first render (before the photos that
    // would validate it arrive) and the URL-sync effect then scrubs the param —
    // which silently broke every map-pin link into the gallery.
    if (!scopedLocationNames.length) return;
    if (scopedLocationNames.includes(activeLocation)) return;
    // Outside a collection, keep the old behaviour: a dead deep link lands
    // somewhere real instead of showing nothing.
    if (!activeCollection) {
      setActiveLocation(pickLandingLocation(scopedLocationNames));
      return;
    }
    setActiveLocation(allLocations);
  }, [activeLocation, activeCollection, scopedLocationNames]);

  const filteredPhotos = useMemo(() => {
    if (activeLocation === allLocations) return scopedPhotos;
    return scopedPhotos.filter((p) => p.location === activeLocation);
  }, [activeLocation, scopedPhotos]);

  // Keep the URL shareable: ?collection=slug&location=Name, both optional.
  useEffect(() => {
    if (isLoading) return;
    const params = new URLSearchParams();
    if (activeCollection) params.set("collection", activeCollection.slug);
    if (activeLocation !== allLocations) params.set("location", activeLocation);
    const query = params.toString();
    const next = `/galleries${query ? `?${query}` : ""}`;
    if (window.location.pathname + window.location.search !== next) {
      window.history.replaceState({}, "", next);
    }
  }, [activeCollection, activeLocation, isLoading]);

  function changeCollection(id: string) {
    setActiveCollectionId(id);
    // Drilling into a trip on a phone should land you on its places, not leave
    // you staring at the rail you just used.
    if (isPhone && id !== ALL_COLLECTIONS) setMobileAxis("places");
  }

  useEffect(() => {
    if (isLoading) return;
    // NB: "All work" is a real, persistent state now that collections exist (it
    // used to be transient, auto-replaced by a random landing category). So it
    // gets warmed like any other filter — an early return here would leave the
    // skeleton shimmering forever on the default view.
    //
    // Warm only the first screenful, and with the SAME srcset/sizes the grid
    // tiles use — the browser then resolves to the identical (small) variant
    // instead of pulling the full 1800px image for every photo in the category.
    const batch = filteredPhotos.filter((p) => p.imageUrl).slice(0, EAGER_TILE_COUNT);
    if (!batch.length) { setImagesReady(true); return; }
    let cancelled = false; setImagesReady(false); let done = 0;
    const tick = () => { done += 1; if (!cancelled && done >= batch.length) setImagesReady(true); };
    const imgs = batch.map((photo) => {
      const im = new Image();
      im.onload = tick;
      im.onerror = tick;
      const srcset = srcSetFor(photo);
      if (srcset) {
        im.sizes = GRID_SIZES;
        im.srcset = srcset;
      }
      im.src = photo.imageUrl;
      return im;
    });
    const timer = window.setTimeout(() => { if (!cancelled) setImagesReady(true); }, 5000);
    return () => { cancelled = true; window.clearTimeout(timer); imgs.forEach((im) => { im.onload = null; im.onerror = null; }); };
  }, [filteredPhotos, isLoading, activeLocation]);

  // Once the current category is up, quietly warm the first few images of the
  // OTHER categories during idle time — switching tabs then opens on cached
  // images (and the CDN's cold transform cost is paid invisibly).
  useEffect(() => {
    if (isLoading || !imagesReady) return;
    const idle: (cb: () => void) => number =
      "requestIdleCallback" in window
        ? (cb) => window.requestIdleCallback(cb, { timeout: 4000 })
        : (cb) => window.setTimeout(cb, 1500);
    const cancelIdle: (handle: number) => void =
      "cancelIdleCallback" in window ? (h) => window.cancelIdleCallback(h) : (h) => window.clearTimeout(h);
    const handle = idle(() => {
      const perLocation = new Map<string, number>();
      for (const p of publicPhotos) {
        if (p.location === activeLocation || !p.imageUrl) continue;
        const seen = perLocation.get(p.location) ?? 0;
        if (seen >= 4) continue;
        perLocation.set(p.location, seen + 1);
        const im = new Image();
        const srcset = srcSetFor(p);
        if (srcset) {
          im.sizes = GRID_SIZES;
          im.srcset = srcset;
        }
        im.src = p.imageUrl;
      }
    });
    return () => cancelIdle(handle);
  }, [imagesReady, isLoading, activeLocation, publicPhotos]);

  // Switching location should land you back at the top of the gallery, even if
  // you'd scrolled down (changing the filter isn't a route change, so the
  // navigate() scroll-reset doesn't fire here). Skip the very first run — that's
  // the automatic landing-category pick, and a smooth/animated scroll there
  // would hijack a phone user who's already started scrolling.
  const skipLandScroll = useRef(true);
  useEffect(() => {
    if (skipLandScroll.current) { skipLandScroll.current = false; return; }
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [activeLocation]);

  const seoLoc = activeLocation === allLocations ? null : activeLocation;
  const collectionLabel = activeCollection ? collectionTitle(activeCollection) : null;
  // "Italy · 2024 Europe" beats a bare "Italy" now that Italy spans three trips.
  const pageHeading = seoLoc ?? collectionLabel ?? "All work";
  const seoTitle = [seoLoc, collectionLabel].filter(Boolean).join(" · ");
  useSeo(
    seoTitle ? `${seoTitle} — Sam Duckworth Photography` : "Gallery — Sam Duckworth Photography",
    seoTitle
      ? {
          description: `Aerial and landscape photography${seoLoc ? ` from ${seoLoc}` : ""}${collectionLabel ? ` — ${collectionLabel}` : ""}, by Sam Duckworth.`,
          path: `/galleries?${new URLSearchParams({
            ...(activeCollection ? { collection: activeCollection.slug } : {}),
            ...(seoLoc ? { location: seoLoc } : {}),
          }).toString()}`,
        }
      : { path: "/galleries" },
  );

  useScrollReveal([isLoading, imagesReady, activeLocation, filteredPhotos.length, view]);

  const showCollections = visibleCollections.length > 0;
  // Desktop shows both rails; a phone shows one at a time behind the switch.
  const showCollectionRail = showCollections && (!isPhone || mobileAxis === "collections");
  // A one-place collection has nothing left to filter, so its rail is noise.
  const showPlaceRail = scopedLocationNames.length > 1 && (!isPhone || !showCollections || mobileAxis === "places");

  return (
    <main className="gallery-page">
      <Header isScrolled onNavigate={onNavigate} />
      <section className="gallery-page-head">
        <h1 className="gallery-page-title">
          {pageHeading}
          {seoLoc && collectionLabel ? <span className="title-qual"> · {collectionLabel}</span> : null}
        </h1>
      </section>
      {showCollections && isPhone ? (
        <div className="axis-switch">
          <div className="axis-seg" role="tablist" aria-label="Browse by">
            <button
              aria-selected={mobileAxis === "collections"}
              className={mobileAxis === "collections" ? "on" : ""}
              onClick={() => setMobileAxis("collections")}
              role="tab"
              type="button"
            >
              Collections
            </button>
            <button
              aria-selected={mobileAxis === "places"}
              className={mobileAxis === "places" ? "on" : ""}
              onClick={() => setMobileAxis("places")}
              role="tab"
              type="button"
            >
              Places
            </button>
          </div>
          <span className="axis-note">
            {mobileAxis === "collections"
              ? "Every trip"
              : activeCollection
                ? `Places in ${collectionLabel}`
                : "Places across all work"}
          </span>
        </div>
      ) : null}
      {showCollectionRail ? (
        <CollectionRail
          activeId={activeCollectionId}
          collections={visibleCollections}
          counts={collectionCounts}
          onChange={changeCollection}
        />
      ) : null}
      {activeCollection && !isPhone ? (
        <CollectionScope
          collection={activeCollection}
          count={filteredPhotos.length}
          onClear={() => { setActiveCollectionId(ALL_COLLECTIONS); setActiveLocation(allLocations); }}
          place={activeLocation === allLocations ? null : activeLocation}
        />
      ) : null}
      {showPlaceRail ? (
        <LocationRail
          activeLocation={activeLocation}
          allLabel="All places"
          excludeUnsorted
          locations={locations}
          photos={scopedPhotos}
          onChange={setActiveLocation}
        />
      ) : null}
      <GalleryControls onChange={setView} onViewOnMap={viewOnMap} view={view} />
      {isLoading || !imagesReady ? (
        <GallerySkeleton view={view} />
      ) : (
        <Gallery
          isAdmin={isAdmin}
          onEditPhoto={setEditingPhoto}
          onSelectPhoto={openPhoto}
          onWarm={warmPhoto}
          onSendToTop={sendToTop}
          onToggleMapFeature={toggleMapFeature}
          onUnpublish={unpublishPhoto}
          photos={filteredPhotos}
          view={view}
        />
      )}
      <Footer />
      {selectedPhoto ? (
        <Lightbox
          photo={selectedPhoto}
          origin={origin}
          onClose={closePhoto}
          onViewOnMap={viewPhotoOnMap}
          onOrderPrint={flags.print_configurator === true ? (p) => { window.history.pushState({}, "", `/shop/${p.slug}`); onNavigate(`/shop/${p.slug}`); } : undefined}
        />
      ) : null}
      {editingPhoto ? (
        <PhotoEditOverlay locations={locations} onClose={() => setEditingPhoto(null)} onSaved={loadGallery} photo={editingPhoto} />
      ) : null}
      <InstagramRail />
    </main>
  );
}

// One location tile that slowly cross-fades through a handful of its photos.
// `featured` tiles are the big editorial-mosaic heroes. Admins get a pencil to
// choose which photos cycle. Bigger tiles pull a higher-res image variant.
function CollectionCard({ name, photos, onOpen, delay, onEdit, featured = false }: { name: string; photos: Photo[]; onOpen: (name: string) => void; delay: number; onEdit?: () => void; featured?: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (photos.length <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer: { id?: number } = {};
    const start = window.setTimeout(() => {
      setI((v) => (v + 1) % photos.length);
      timer.id = window.setInterval(() => setI((v) => (v + 1) % photos.length), 4600);
    }, delay);
    return () => { window.clearTimeout(start); if (timer.id) window.clearInterval(timer.id); };
  }, [photos.length, delay]);

  return (
    <div className={`cc-wrap${featured ? " cc-feat" : ""}`}>
      <button className="collection-card" type="button" onClick={() => onOpen(name)} aria-label={`View the ${name} gallery`}>
        {photos.map((p, idx) => (
          <img key={p.id} className={`cc-img${idx === i ? " is-on" : ""}`} src={thumbUrl(p, featured ? 1100 : 700)} alt="" loading="lazy" decoding="async" />
        ))}
        <span className="cc-label">{name}</span>
      </button>
      {onEdit ? (
        <button className="cc-edit" type="button" onClick={onEdit} aria-label={`Choose featured photos for ${name}`} title="Choose featured photos">
          <Pencil size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

// The home page's location collections — one cross-fading card per location.
// Each card cycles its admin-pinned photos (collectionOrder), else the first
// few in gallery order.
const CURTAIN_LIMIT = 10;

function CollectionCards({ photos, locations, onOpen, onOpenAll, isAdmin = false, onEdit }: { photos: Photo[]; locations: GalleryLocation[]; onOpen: (name: string) => void; onOpenAll?: () => void; isAdmin?: boolean; onEdit?: (location: GalleryLocation) => void }) {
  const cards = useMemo(() => {
    const byLoc = new Map<string, Photo[]>();
    for (const p of photos) {
      if (!p.location || p.location === "Unsorted") continue;
      const list = byLoc.get(p.location);
      if (list) list.push(p);
      else byLoc.set(p.location, [p]);
    }
    const order = new Map(locations.map((l, i) => [l.name, i]));
    const locByName = new Map(locations.map((l) => [l.name, l]));
    return [...byLoc.entries()]
      .map(([name, ps]) => {
        const pinned = ps
          .filter((p) => p.collectionOrder != null)
          .sort((a, b) => (a.collectionOrder ?? 0) - (b.collectionOrder ?? 0));
        // photo.year is a string on the row type, and is "" when unknown.
        const years = ps.map((p) => Number(p.year)).filter((y) => Number.isFinite(y) && y > 0);
        return {
          name,
          photos: (pinned.length ? pinned : ps).slice(0, 5),
          loc: locByName.get(name),
          count: ps.length,
          years: years.length ? ([Math.min(...years), Math.max(...years)] as const) : null,
        };
      })
      .sort((a, b) => (order.get(a.name) ?? 999) - (order.get(b.name) ?? 999) || a.name.localeCompare(b.name));
  }, [photos, locations]);

  // The phone list is capped at the ten most recent places — all 26 is a long
  // scroll past a lot of thin galleries. Newest first, photo count breaking
  // ties within a year; places with no year at all sort last.
  //
  // "Recent" here means the latest year_taken in the place, because that is the
  // only date the PUBLIC query returns — captured_at is admin-only, so it is
  // always null out here and cannot be used for ordering.
  const recent = useMemo(
    () =>
      [...cards]
        .sort(
          (a, b) => (b.years?.[1] ?? -1) - (a.years?.[1] ?? -1) || b.count - a.count,
        )
        .slice(0, CURTAIN_LIMIT),
    [cards],
  );

  // Phones get the curtain instead of the tile grid — see CollectionCurtain.
  // Chosen in JS rather than CSS so only one of the two sets of images is ever
  // requested; a display:none grid would still download every tile.
  const narrow = useIsNarrow();

  if (!cards.length) return null;

  if (narrow) {
    return (
      <CollectionCurtain
        rows={recent}
        // Capping the list orphans the remaining places on mobile, so the list
        // ends with a way through to all of them.
        remaining={cards.length - recent.length}
        onOpen={onOpen}
        onOpenAll={onOpenAll}
        onEdit={isAdmin && onEdit ? onEdit : undefined}
      />
    );
  }

  return (
    <section className="collection-cards scroll-reveal" aria-label="Browse by location">
      {cards.map((c, i) => (
        <CollectionCard
          key={c.name}
          name={c.name}
          photos={c.photos}
          onOpen={onOpen}
          delay={i * 650}
          featured={i % 6 === 0}
          onEdit={isAdmin && c.loc && onEdit ? () => onEdit(c.loc as GalleryLocation) : undefined}
        />
      ))}
    </section>
  );
}

// True on phones. Kept as a hook so the collections block can pick a layout in
// JS instead of rendering both and hiding one.
function useIsNarrow(query = "(max-width: 760px)") {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    onChange();
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return narrow;
}

type CurtainRow = {
  name: string;
  photos: Photo[];
  loc?: GalleryLocation;
  count: number;
  years: readonly [number, number] | null;
};

// The mobile index of places. On a phone the tile grid becomes a tall wall of
// near-identical thumbnails you scroll past; this reads as a contents page, and
// the "live" row — expanded, in colour — follows SCROLL POSITION rather than
// hover, because hover doesn't exist on touch and the list would otherwise sit
// grey forever.
function CollectionCurtain({
  rows,
  remaining = 0,
  onOpen,
  onOpenAll,
  onEdit,
}: {
  rows: CurtainRow[];
  remaining?: number;
  onOpen: (name: string) => void;
  onOpenAll?: () => void;
  onEdit?: (location: GalleryLocation) => void;
}) {
  const listRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(".curtain-row"));
    if (!items.length) return;

    // With motion off, don't hide anything behind a scroll effect — show the
    // whole list in colour.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      items.forEach((el) => el.classList.add("is-live"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          items.forEach((el) => el.classList.remove("is-live"));
          entry.target.classList.add("is-live");
        }
      },
      // The band has to be THINNER than one row. A generous band puts two or
      // three rows inside it at once and the highlight flickers between
      // neighbours depending on callback order; ~1% of the viewport is a line.
      { rootMargin: "-49.4% 0px -49.4% 0px", threshold: 0 },
    );
    items.forEach((el) => io.observe(el));
    // Nothing is in the band until you scroll into the list, and the class only
    // moves on a new intersection — so seed the first row or it looks dead.
    items[0].classList.add("is-live");
    return () => io.disconnect();
  }, [rows]);

  return (
    <section className="collection-curtain scroll-reveal" aria-label="Browse by location" ref={listRef}>
      {rows.map((r) => (
        <div className="curtain-row" key={r.name}>
          <button className="curtain-hit" type="button" onClick={() => onOpen(r.name)} aria-label={`View the ${r.name} gallery`}>
            <span className="curtain-txt">
              <span className="curtain-nm">{r.name}</span>
              <span className="curtain-meta">
                {r.count} {r.count === 1 ? "frame" : "frames"}
                {r.years ? ` · ${r.years[0] === r.years[1] ? r.years[0] : `${r.years[0]}–${r.years[1]}`}` : ""}
              </span>
            </span>
            <span className="curtain-peek">
              {r.photos[0] ? (
                <img src={thumbUrl(r.photos[0], 560)} alt="" loading="lazy" decoding="async" />
              ) : null}
            </span>
          </button>
          {onEdit && r.loc ? (
            <button
              className="curtain-edit"
              type="button"
              onClick={() => onEdit(r.loc as GalleryLocation)}
              aria-label={`Choose featured photos for ${r.name}`}
              title="Choose featured photos"
            >
              <Pencil size={13} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ))}
      {remaining > 0 && onOpenAll ? (
        <div className="curtain-row curtain-all">
          <button className="curtain-hit" type="button" onClick={onOpenAll}>
            <span className="curtain-txt">
              <span className="curtain-nm">All places</span>
              <span className="curtain-meta">{remaining} more · view the full archive</span>
            </span>
            <span className="curtain-arrow" aria-hidden="true">
              <ChevronRight size={20} />
            </span>
          </button>
        </div>
      ) : null}
    </section>
  );
}

function CollectionsSkeleton() {
  return (
    <section className="collection-cards" aria-hidden="true">
      {Array.from({ length: 7 }, (_, i) => (
        <div className={`cc-wrap${i % 6 === 0 ? " cc-feat" : ""}`} key={i}>
          <div className="skeleton-tile cc-skel" />
        </div>
      ))}
    </section>
  );
}

// Framed Editions shop banner — two oak-framed prints + a call to the shop.
function FramedHero({ portrait, landscape, onShop }: { portrait?: Photo; landscape?: Photo; onShop: () => void }) {
  return (
    <section className="framed-hero scroll-reveal" aria-label="Framed prints">
      <div className="fh-copy">
        <p className="eyebrow">Framed Editions</p>
        <h2>Take the view home.</h2>
        <p className="fh-lead">Fine-art prints, framed in solid oak — ready to hang.</p>
        <button className="solid-button" type="button" onClick={onShop}>Shop the collection</button>
        <p className="fh-flag"><span className="fh-flag-dot" aria-hidden="true" />Coming soon</p>
      </div>
      <div className="fh-stage">
        {landscape ? <OakFrame className="fh-back" src={thumbUrl(landscape, 1000)} orientation="landscape" alt={landscape.title} /> : null}
        {portrait ? <OakFrame className="fh-main" src={thumbUrl(portrait, 900)} orientation="portrait" alt={portrait.title} /> : null}
      </div>
    </section>
  );
}

const SHOP_SIZES = [
  { id: "A3", cm: "30×42 cm", price: 160 },
  { id: "A2", cm: "42×59 cm", price: 260 },
  { id: "A1", cm: "59×84 cm", price: 390 },
];
// `productHref` is only passed when the print_configurator flag is on — the
// card then opens the real product page (true-to-size room, real sizes/colours,
// real cart) instead of the old inline size-picker. Flag off = old behaviour,
// byte-for-byte, so this ships safely disabled until the configurator is ready.
function ShopProduct({ photo, onAdd, productHref, onOpen }: { photo: Photo; onAdd: () => void; productHref?: string; onOpen?: () => void }) {
  const [size, setSize] = useState(1);
  const orient = photo.aspect === "portrait" || photo.aspect === "square" ? "portrait" : "landscape";
  if (productHref) {
    return (
      <a
        className={`shop-card ${orient}`}
        href={productHref}
        onClick={(e) => { e.preventDefault(); onOpen?.(); }}
      >
        <div className="shop-card-frame">
          <OakFrame src={thumbUrl(photo, 820)} orientation={orient} alt={`${photo.title}, ${photo.location}`} />
        </div>
        <div className="shop-card-info">
          <div className="sc-ttl">{photo.title}</div>
          <div className="sc-loc">{photo.location}</div>
          <div className="sc-buy"><span className="sc-price">From {money(priceFor("A5", false))}</span></div>
        </div>
      </a>
    );
  }
  return (
    <article className={`shop-card ${orient}`}>
      <div className="shop-card-frame">
        <OakFrame src={thumbUrl(photo, 820)} orientation={orient} alt={`${photo.title}, ${photo.location}`} />
      </div>
      <div className="shop-card-info">
        <div className="sc-ttl">{photo.title}</div>
        <div className="sc-loc">{photo.location}</div>
        <div className="sc-sizes">
          {SHOP_SIZES.map((s, i) => (
            <button key={s.id} className={`sc-size${i === size ? " on" : ""}`} onClick={() => setSize(i)} type="button" title={s.cm}>{s.id}</button>
          ))}
        </div>
        <div className="sc-buy">
          <span className="sc-price">${SHOP_SIZES[size].price}</span>
          <button className="add-btn" onClick={onAdd} type="button">Add to cart</button>
        </div>
      </div>
    </article>
  );
}

// The Framed Editions shop. The grid is admin-curated (in_shop); access is
// gated by the `shop_public` flag — public sees "Opening soon" until it's on,
// while the admin always sees the full shop and can curate it.
const orientOf = (p: Photo) => (p.aspect === "portrait" || p.aspect === "square" ? "portrait" : "landscape");

// Live mini-mockup of the glimpse wall: each picked photo in its actual frame,
// numbered to match the picker — so there's no guessing which goes where.
function WallPreview({ ids, photos }: { ids: string[]; photos: Photo[] }) {
  const byId = new Map(photos.map((p) => [p.id, p]));
  const chosen = ids.map((id) => byId.get(id)).filter((p): p is Photo => Boolean(p));
  if (!chosen.length) {
    return <p className="picker-preview-empty">Pick photos below — they’ll appear here in their frames, in order (1–5).</p>;
  }
  return (
    <div className="shop-wall picker-wall">
      {chosen.map((p, i) => (
        <div className={`sw-frame ${orientOf(p)}`} key={p.id}>
          <OakFrame src={thumbUrl(p, 500)} orientation={orientOf(p)} alt={p.title} />
          <span className="picker-badge">{i + 1}</span>
        </div>
      ))}
    </div>
  );
}

function ShopPage({ onNavigate }: { onNavigate: (route: string) => void }) {
  const { publicPhotos, locations, flags, isAdmin, settingValue, loadGallery } = useSiteData();
  const [cart, setCart] = useState(0);
  const realCart = useCart();
  const [filter, setFilter] = useState("All");
  // Two independent curations: "shop" = the products for sale (in_shop), "wall" =
  // the coming-soon collection glimpse (its own ordered list in shop_preview).
  const [curating, setCurating] = useState<null | "shop" | "wall">(null);

  useSeo("Framed Editions — Sam Duckworth Photography", {
    description: "Fine-art aerial and coastal prints, framed in solid oak — by Sam Duckworth. Launching soon.",
    path: "/shop",
  });

  function goHome() { window.history.pushState({}, "", "/"); onNavigate("/"); }
  function goGalleries() { window.history.pushState({}, "", "/galleries"); onNavigate("/galleries"); }
  // Classify by the location's DB region (no hardcoded place list — a newly
  // created Australian location should never file under Europe).
  const regionByLocation = useMemo(() => new Map(locations.map((l) => [l.name, l.region])), [locations]);
  const region = (p: Photo) => (regionByLocation.get(p.location) === "Europe" ? "Europe" : "Australia");

  // Explicit true — so before settings load (flags empty) we default to the
  // safe "not live" preview, never a flash of the transactional shop.
  const shopLive = flags.shop_public === true;
  // Same pattern as shop_public: defaults OFF with no row required, so the
  // true-to-size configurator ships disabled until Admin → Visibility flips it.
  const configuratorOn = flags.print_configurator === true;
  const cartCount = configuratorOn ? realCart.items.length : cart;

  const shopPhotos = useMemo(
    () => publicPhotos.filter((p) => p.inShop).sort((a, b) => (a.shopOrder ?? 1e9) - (b.shopOrder ?? 1e9)),
    [publicPhotos],
  );
  const filtered = filter === "All" ? shopPhotos : shopPhotos.filter((p) => region(p) === filter);
  const heroP = shopPhotos.find((p) => p.aspect === "portrait") ?? shopPhotos[0]
    ?? publicPhotos.find((p) => p.aspect === "portrait") ?? publicPhotos[0];
  const heroL = shopPhotos.find((p) => p.aspect === "landscape" || p.aspect === "wide") ?? shopPhotos[1]
    ?? publicPhotos.find((p) => p.aspect === "landscape" || p.aspect === "wide") ?? publicPhotos[1];

  // The "collection glimpse" wall is curated SEPARATELY from the shop products —
  // its ordered photo ids live in the shop_preview site setting. If unset, fall
  // back to a pleasing landscape/portrait mix from the gallery.
  const previewIds = useMemo(() => {
    try {
      const v = settingValue.shop_preview;
      return v ? (JSON.parse(v) as string[]) : [];
    } catch {
      return [];
    }
  }, [settingValue.shop_preview]);
  const wall = useMemo(() => {
    if (previewIds.length) {
      const byId = new Map(publicPhotos.map((p) => [p.id, p]));
      const chosen = previewIds.map((id) => byId.get(id)).filter((p): p is Photo => Boolean(p));
      if (chosen.length) return chosen.slice(0, 5);
    }
    const land = publicPhotos.filter((p) => p.aspect === "landscape" || p.aspect === "wide");
    const port = publicPhotos.filter((p) => p.aspect === "portrait" || p.aspect === "square");
    const mixed = [land[0], port[0], land[1], port[1], land[2]];
    const base = mixed.filter(Boolean).length >= 3 ? mixed : publicPhotos.slice(0, 5);
    const seen = new Set<string>();
    return base.filter((p): p is Photo => Boolean(p) && !seen.has(p.id) && Boolean(seen.add(p.id))).slice(0, 5);
  }, [previewIds, publicPhotos]);

  async function saveShop(orderedIds: string[]) {
    const chosen = new Set(orderedIds);
    for (const p of shopPhotos) {
      if (!chosen.has(p.id)) await setPhotoShop(p.id, { inShop: false, shopOrder: null });
    }
    for (let i = 0; i < orderedIds.length; i += 1) {
      await setPhotoShop(orderedIds[i], { inShop: true, shopOrder: i + 1 });
    }
    await loadGallery();
    setCurating(null);
  }

  async function saveWall(orderedIds: string[]) {
    await setSiteSetting("shop_preview", JSON.stringify(orderedIds));
    await loadGallery();
    setCurating(null);
  }

  const ShopNav = (
    <div className="shop-nav">
      <button className="shop-logo" onClick={goHome} type="button">FRAMED EDITIONS</button>
      <div className="shop-nav-links">
        <a href="/" onClick={(e) => { e.preventDefault(); goHome(); }}>← samduckworth.com</a>
        {shopLive ? <span className="shop-cart">Cart · {cartCount}</span> : null}
      </div>
    </div>
  );

  return (
    <main className="shop">
      {ShopNav}
      {isAdmin && !shopLive ? (
        <div className="shop-admin-note"><EyeOff size={13} aria-hidden="true" /> Preview mode — this is what the public sees. Toggle “Shop page” in Admin → Visibility to open the real shop (prices + cart).</div>
      ) : null}
      <section className="shop-hero">
        <div className="sh-copy">
          <p className="eyebrow">Sam Duckworth Photography</p>
          <h1>Framed<br />Editions</h1>
          <p className="sh-lead">Fine-art aerial &amp; coastal prints, framed in solid oak. From the Northern Beaches to the Mediterranean.</p>
          {/* While the shop is still in development there's nothing to buy, so
              the call to action sends people to the galleries rather than to
              the glimpse wall further down this page. Flipping "Shop page" on
              in Admin → Visibility restores the real shop link on its own. */}
          {shopLive ? (
            <a className="solid-button" href="#shop-grid">Shop the collection</a>
          ) : (
            <a
              className="solid-button"
              href="/galleries"
              onClick={(event) => { event.preventDefault(); goGalleries(); }}
            >
              See the collection
            </a>
          )}
        </div>
        <div className="fh-stage">
          {heroL ? <OakFrame className="fh-back" src={thumbUrl(heroL, 1000)} orientation="landscape" alt={heroL.title} /> : null}
          {heroP ? <OakFrame className="fh-main" src={thumbUrl(heroP, 900)} orientation="portrait" alt={heroP.title} /> : null}
        </div>
      </section>
      <div className="shop-strip">
        <span><b>Solid oak</b> frame</span><span><b>Archival</b> matte</span>
        <span><b>Ready</b> to hang</span><span><b>Ships</b> worldwide</span>
      </div>

      {shopLive ? (
        <section className="shop-section" id="shop-grid">
          <div className="shop-sec-head">
            <div><p className="eyebrow">Every edition</p><h2>Shop all prints</h2></div>
            {isAdmin ? (
              <button className="sec-edit" type="button" onClick={() => setCurating("shop")} aria-label="Choose the prints for sale" title="Choose the prints for sale">
                <Pencil size={15} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div className="shop-filters">
            {["All", "Europe", "Australia"].map((f) => (
              <button key={f} className={`chip${filter === f ? " active" : ""}`} onClick={() => setFilter(f)} type="button">{f}</button>
            ))}
          </div>
          {filtered.length ? (
            <div className="shop-grid">
              {filtered.map((p) => (
                <ShopProduct
                  key={p.id}
                  photo={p}
                  onAdd={() => setCart((c) => c + 1)}
                  productHref={configuratorOn ? `/shop/${p.slug}` : undefined}
                  onOpen={configuratorOn ? () => { window.history.pushState({}, "", `/shop/${p.slug}`); onNavigate(`/shop/${p.slug}`); } : undefined}
                />
              ))}
            </div>
          ) : (
            <p className="shop-empty">
              {isAdmin ? "No prints for sale yet — use the pencil above to choose which photos to sell." : "New editions coming soon."}
            </p>
          )}
        </section>
      ) : (
        <>
          <section className="shop-section" id="shop-wall">
            <div className="shop-sec-head">
              <div><p className="eyebrow">A first look</p><h2>The collection</h2></div>
              {isAdmin ? (
                <button className="sec-edit" type="button" onClick={() => setCurating("wall")} aria-label="Choose the glimpse photos" title="Choose the glimpse photos">
                  <Pencil size={15} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <p className="shop-wall-lead">A glimpse of the prints. The full shop opens soon.</p>
            <div className="shop-wall">
              {wall.map((p) => (
                <div className={`sw-frame ${orientOf(p)}`} key={p.id}>
                  <OakFrame src={thumbUrl(p, 820)} orientation={orientOf(p)} alt={`${p.title}, ${p.location}`} />
                </div>
              ))}
            </div>
          </section>
          <section className="shop-coming">
            <p className="eyebrow">Framed Editions</p>
            <h2>Coming soon.</h2>
            <p className="sh-lead">Prints, sizes and pricing are on the way.</p>
          </section>
        </>
      )}

      <Footer />
      {curating === "shop" ? (
        <OrderedPhotoPicker
          title="Prints for sale"
          hint="Pick the photos sold in the shop — they appear in this order. (Separate from the coming-soon glimpse.)"
          photos={publicPhotos}
          initialIds={shopPhotos.map((p) => p.id)}
          onClose={() => setCurating(null)}
          onSave={saveShop}
        />
      ) : null}
      {curating === "wall" ? (
        <OrderedPhotoPicker
          title="Collection glimpse"
          hint="Pick up to 5 photos for the coming-soon wall — the mockup above shows exactly which frame each one lands in. Click again to remove; pick order = frame order."
          max={5}
          photos={publicPhotos}
          initialIds={previewIds.filter((id) => publicPhotos.some((p) => p.id === id))}
          preview={(ids) => <WallPreview ids={ids} photos={publicPhotos} />}
          onClose={() => setCurating(null)}
          onSave={saveWall}
        />
      ) : null}
    </main>
  );
}

// The real per-photo print product page (/shop/<slug>) — gated on the same
// print_configurator flag as the ShopProduct card link and the Lightbox's
// "Order a print" button. Every published photo is orderable this way, not
// just the curated /shop grid (in_shop only controls what appears in that
// grid). Bookmarking or sharing this URL while the flag is off (or for a
// photo that's unpublished) bounces back to /shop rather than rendering a
// half-built page.
function ShopProductRoute({ slug, onNavigate }: { slug: string; onNavigate: (route: string) => void }) {
  const { publicPhotos, flags, isLoading } = useSiteData();
  const configuratorOn = flags.print_configurator === true;
  const photo = publicPhotos.find((p) => p.slug === slug);
  const shouldRedirect = !isLoading && (!configuratorOn || !photo);

  useEffect(() => {
    if (shouldRedirect) {
      window.history.replaceState({}, "", "/shop");
      onNavigate("/shop");
    }
  }, [shouldRedirect, onNavigate]);

  if (!photo || shouldRedirect) return null;
  return <PrintConfigurator photo={photo} otherShopPhotos={publicPhotos} onNavigate={onNavigate} />;
}

function InstagramRail() {
  return (
    <a
      className="ig-rail"
      href="https://instagram.com/sam.duckworth"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Instagram: sam.duckworth"
    >
      <Instagram size={16} aria-hidden="true" />
      <span>sam.duckworth</span>
    </a>
  );
}

// The live Instagram strip that closes the home page. Reads the cached posts
// from Supabase (filled by the api/instagram-sync cron) — the browser never
// touches Instagram, so the site's CSP stays as tight as it is.
//
// Light to match the rest of the page, with the caption always readable under
// each post rather than on hover — so it behaves identically on a phone.
function InstagramFeed({ posts }: { posts: InstagramPost[] }) {
  const isPhone = useMediaQuery("(max-width: 760px)");
  const trackRef = useRef<HTMLDivElement | null>(null);

  if (!posts.length) return null;

  function nudge(direction: -1 | 1) {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * Math.round(track.clientWidth * 0.8), behavior: "smooth" });
  }

  return (
    <section className="ig-feed scroll-reveal" aria-label="Latest on Instagram">
      <div className="ig-feed-head">
        <div className="ig-feed-id">
          <span className="ig-feed-handle">
            <Instagram size={14} aria-hidden="true" /> @sam.duckworth
          </span>
          <h2 className="ig-feed-title">Latest on Instagram</h2>
        </div>
        <div className="ig-feed-actions">
          {!isPhone ? (
            <div className="ig-feed-nav">
              <button aria-label="Scroll back" onClick={() => nudge(-1)} type="button">
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <button aria-label="Scroll forward" onClick={() => nudge(1)} type="button">
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <a
            className="ig-feed-follow"
            href="https://instagram.com/sam.duckworth"
            rel="noopener noreferrer"
            target="_blank"
          >
            Follow
          </a>
        </div>
      </div>

      <div className="ig-feed-track" ref={trackRef}>
        {posts.map((post) => {
          const src = post.storagePath
            ? getTransformedPublicUrl(photoBucket, post.storagePath, 620)
            : "";
          return (
            <a
              className="ig-tile"
              href={post.permalink}
              key={post.id}
              rel="noopener noreferrer"
              target="_blank"
            >
              <div className="ig-tile-img">
                {src ? <SmartImage alt={post.caption ?? "Instagram post"} src={src} /> : null}
              </div>
              <div className="ig-tile-body">
                {post.likeCount != null || post.commentsCount != null ? (
                  <div className="ig-tile-meta">
                    {post.likeCount != null ? (
                      <span><Heart size={12} aria-hidden="true" />{post.likeCount.toLocaleString()}</span>
                    ) : null}
                    {post.commentsCount != null ? (
                      <span><MessageCircle size={12} aria-hidden="true" />{post.commentsCount.toLocaleString()}</span>
                    ) : null}
                  </div>
                ) : null}
                {post.caption ? <p className="ig-tile-cap">{post.caption}</p> : null}
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function RecentWork({
  isAdmin,
  onChangePhoto,
  onEditPhoto,
  onSelect,
  onWarm,
  photos,
}: {
  isAdmin: boolean;
  onChangePhoto: (slot: number) => void;
  onEditPhoto: (photo: Photo) => void;
  onSelect: (photo: Photo, from?: HTMLElement) => void;
  onWarm?: (photo: Photo) => void;
  photos: Photo[];
}) {
  const tiles = photos.slice(0, 9);

  return (
    <section className="recent-work scroll-reveal" aria-label="Recent work">
      <h2 className="recent-heading">Recent Work</h2>
      <div className="recent-mosaic">
        {tiles.map((photo, index) => (
          <div
            className={`recent-tile recent-tile-${index + 1} scroll-reveal${isAdmin ? " is-admin" : ""}`}
            key={photo.id}
            onClick={(event) => onSelect(photo, event.currentTarget)}
            onPointerDown={() => onWarm?.(photo)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(photo);
              }
            }}
            role="button"
            tabIndex={0}
            style={{ "--reveal-delay": `${index * 45}ms` } as CSSProperties}
          >
            <SmartImage
              src={photo.imageUrl}
              srcSet={srcSetFor(photo)}
              sizes="(max-width: 900px) 50vw, 33vw"
              alt={`${photo.title}, ${photo.location}`}
              vtId={photo.id}
            />
            <div className="photo-meta">
              <span>
                <MapPin size={13} aria-hidden="true" />
                {photo.location}
              </span>
              <strong>{photo.title}</strong>
              {photo.year ? <small>{photo.year}</small> : null}
            </div>
            <AltitudeBadge photo={photo} />
            {isAdmin ? (
              <div className="tile-admin-actions">
                <button
                  aria-label="Edit photo details"
                  onClick={(event) => {
                    event.stopPropagation();
                    onEditPhoto(photo);
                  }}
                  title="Edit details"
                  type="button"
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                <button
                  aria-label="Change photo"
                  onClick={(event) => {
                    event.stopPropagation();
                    onChangePhoto(index + 1);
                  }}
                  title="Change photo"
                  type="button"
                >
                  <Images size={14} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentPicker({
  onClose,
  onPick,
  photos,
  label = "Choose a photo for Recent Work",
}: {
  onClose: () => void;
  onPick: (photo: Photo) => void;
  photos: Photo[];
  label?: string;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={label}>
      <button className="lightbox-backdrop" onClick={onClose} type="button" aria-label="Close" />
      <section className="picker-panel">
        <button className="icon-button close-button" onClick={onClose} type="button" aria-label="Close">
          <X size={18} aria-hidden="true" />
        </button>
        <p className="eyebrow">{label}</p>
        <div className="picker-grid">
          {photos.map((photo) => (
            <button className="picker-tile" key={photo.id} onClick={() => onPick(photo)} type="button">
              <SmartImage src={photo.imageUrl} alt={`${photo.title}, ${photo.location}`} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

// Multi-select, ordered photo picker. Click to add (numbered in pick order),
// click again to remove; the saved order is the displayed order. Used for the
// home collection cards (max 5) and shop curation (no max).
function OrderedPhotoPicker({
  title,
  hint,
  photos,
  initialIds,
  max,
  preview,
  onClose,
  onSave,
}: {
  title: string;
  hint: string;
  photos: Photo[];
  initialIds: string[];
  max?: number;
  // Optional live preview shown above the grid, given the current ordered picks
  // (e.g. a mini mockup so you see which photo lands in which frame).
  preview?: (orderedIds: string[]) => ReactNode;
  onClose: () => void;
  onSave: (orderedIds: string[]) => void | Promise<void>;
}) {
  const [picks, setPicks] = useState<string[]>(initialIds);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function toggle(id: string) {
    setPicks((cur) =>
      cur.includes(id)
        ? cur.filter((x) => x !== id)
        : max != null && cur.length >= max
          ? cur
          : [...cur, id],
    );
  }

  async function save() {
    setSaving(true);
    try {
      await onSave(picks);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "The picks could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={title}>
      <button className="lightbox-backdrop" onClick={onClose} type="button" aria-label="Close" />
      <section className="picker-panel">
        <button className="icon-button close-button" onClick={onClose} type="button" aria-label="Close">
          <X size={18} aria-hidden="true" />
        </button>
        <p className="eyebrow">{title}</p>
        <p className="picker-hint">{hint}</p>
        {preview ? <div className="picker-preview">{preview(picks)}</div> : null}
        <div className="picker-grid">
          {photos.map((photo) => {
            const idx = picks.indexOf(photo.id);
            return (
              <button
                className={`picker-tile${idx >= 0 ? " is-picked" : ""}`}
                key={photo.id}
                onClick={() => toggle(photo.id)}
                type="button"
                aria-pressed={idx >= 0}
              >
                <SmartImage src={photo.imageUrl} alt={`${photo.title}, ${photo.location}`} />
                {idx >= 0 ? <span className="picker-badge">{idx + 1}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="picker-actions">
          <span className="picker-count">{picks.length}{max != null ? ` / ${max}` : ""} selected</span>
          <span className="picker-actions-spacer" />
          <button className="ghost-button" type="button" onClick={() => setPicks([])} disabled={!picks.length || saving}>
            Clear
          </button>
          <button className="solid-button" type="button" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </section>
    </div>
  );
}

// Hero picker: choose the landing photo AND confirm it crops cleanly to portrait
// for mobile. Live desktop + phone crop previews let you check before saving; the
// portrait toggle, when on, fills the phone screen (off = letterboxed on the dark
// stage), so birds-eye shots can safely go full-bleed on mobile.
function HeroPicker({
  photos,
  currentId,
  currentRotate,
  onClose,
  onSave,
}: {
  photos: Photo[];
  currentId?: string;
  currentRotate: string;
  onClose: () => void;
  onSave: (photoId: string, rotate: string) => void | Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string | undefined>(currentId ?? photos[0]?.id);
  const [rotate, setRotate] = useState(currentRotate);
  const [saving, setSaving] = useState(false);
  const selected = photos.find((p) => p.id === selectedId) ?? photos[0];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function save() {
    if (!selected) return;
    setSaving(true);
    try {
      await onSave(selected.id, rotate);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "The hero pick could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Choose the landing hero photo">
      <button className="lightbox-backdrop" onClick={onClose} type="button" aria-label="Close" />
      <section className="picker-panel">
        <button className="icon-button close-button" onClick={onClose} type="button" aria-label="Close">
          <X size={18} aria-hidden="true" />
        </button>
        <p className="eyebrow">Choose the landing hero photo</p>
        <p className="picker-hint">Pick a frame, then choose how it sits on a portrait phone — rotate a landscape birds-eye 90° or 270° to stand it up and fill the screen with the whole image. The phone preview updates live.</p>
        {selected ? (
          <div className="hero-pick-previews">
            <div className="hpv desktop">
              <span className="lbl">Desktop</span>
              <div className="hpv-frame"><img src={selected.imageUrl} alt="" /></div>
            </div>
            <div className={`hpv mobile rot${rotate}`}>
              <span className="lbl">Mobile {rotate === "0" ? "· cropped" : `· rotated ${rotate}°`}</span>
              <div className="hpv-frame"><img src={selected.imageUrl} alt="" /></div>
            </div>
            <div className="hero-rotate">
              <span className="lbl">Mobile fit</span>
              <div className="hero-rotate-opts">
                <button className={rotate === "0" ? "on" : ""} onClick={() => setRotate("0")} type="button">No rotate</button>
                <button className={rotate === "90" ? "on" : ""} onClick={() => setRotate("90")} type="button">Rotate 90°</button>
                <button className={rotate === "270" ? "on" : ""} onClick={() => setRotate("270")} type="button">Rotate 270°</button>
              </div>
              <span className="hero-rotate-note">Rotate a landscape birds-eye to fill the portrait phone screen with the whole image — no cropping.</span>
            </div>
          </div>
        ) : null}
        <div className="picker-grid">
          {photos.map((photo) => (
            <button
              className={`picker-tile${photo.id === selectedId ? " is-picked" : ""}`}
              key={photo.id}
              onClick={() => setSelectedId(photo.id)}
              type="button"
              aria-pressed={photo.id === selectedId}
            >
              <SmartImage src={photo.imageUrl} alt={`${photo.title}, ${photo.location}`} />
            </button>
          ))}
        </div>
        <div className="picker-actions">
          <span className="picker-count">{selected ? `${selected.location} · ${selected.title}` : "Pick a photo"}</span>
          <span className="picker-actions-spacer" />
          <button className="ghost-button" type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="solid-button" type="button" onClick={save} disabled={saving || !selected}>
            {saving ? "Saving…" : "Set as hero"}
          </button>
        </div>
      </section>
    </div>
  );
}

// Cinematic landing: a full-bleed hero photo (admin-chosen, else auto) revealed
// by the existing fade-from-black, with the wordmark over it and the photo's
// place · title set small in the bottom-left corner. On mobile the photo fills
// the screen (portrait) when flagged portrait-worthy, else letterboxes.
function Hero({ photo, locations, isAdmin, rotate, onPickHero }: { photo?: Photo; locations: string[]; isAdmin: boolean; rotate: string; onPickHero: () => void }) {
  const rotClass = rotate === "90" ? " rotate-90" : rotate === "270" ? " rotate-270" : "";
  return (
    <section className={`hero landing-stage cinematic${rotClass}`} id="top" aria-label="Sam Duckworth Photography">
      {photo ? (
        <div className="landing-photo" aria-hidden="true">
          <SmartImage src={photo.imageUrl} alt="" priority />
        </div>
      ) : null}
      <div className="landing-copy scroll-reveal is-visible">
        <p className="eyebrow">Aerial &amp; Landscape · Northern Beaches</p>
        <h1>Sam Duckworth</h1>
        <RotatingLocations locations={locations} />
      </div>
      {photo ? (
        <figcaption className="hero-caption">
          <span className="loc">{photo.location}</span>
          <span className="ttl">{photo.title}</span>
        </figcaption>
      ) : null}
      {isAdmin ? (
        <button className="hero-edit" type="button" onClick={onPickHero} aria-label="Choose the hero photo">
          <Pencil size={13} aria-hidden="true" /> Hero
        </button>
      ) : null}
      <a className="scroll-cue" href="#galleries" aria-label="Scroll down to the gallery">
        <span className="scroll-chevrons" aria-hidden="true">
          <i className="scroll-chev" />
          <i className="scroll-chev" />
          <i className="scroll-chev" />
        </span>
      </a>
    </section>
  );
}

// A slowly rotating, gently pulsing line of the locations the photos come from,
// sat beneath the wordmark on the cinematic landing.
function RotatingLocations({ locations }: { locations: string[] }) {
  const [index, setIndex] = useState(0);
  const count = Math.min(3, locations.length);

  useEffect(() => {
    if (locations.length <= count) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setIndex((i) => i + 1), 2600);
    return () => window.clearInterval(id);
  }, [locations.length, count]);

  if (!locations.length) return null;

  const start = (index * count) % locations.length;
  const shown = Array.from(
    { length: count },
    (_, k) => locations[(start + k) % locations.length],
  );

  return (
    <p className="hero-locations" aria-label="Locations in the gallery">
      <span className="hero-locations-set" key={index}>
        {shown.map((name, i) => (
          <span key={`${index}-${name}-${i}`}>
            {i > 0 ? <span className="loc-dot" aria-hidden="true"> · </span> : null}
            {name}
          </span>
        ))}
      </span>
    </p>
  );
}

// The 2026 Europe trip banner: a themed sibling to the landing Hero, sat
// between it and Recent Work. Crossfades through the admin-curated photo set
// (site_settings "hero_2026_photos" — see VisibilityAdmin); "2026" stands in
// for the wordmark and the location ticker is read straight off the curated
// photos' own `location` field, so nothing about which countries is hardcoded.
// Renders nothing until at least one photo is curated.
function Hero2026({ heading, photos, onOpen }: { heading: string; photos: Photo[]; onOpen: () => void }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [photos.length]);

  useEffect(() => {
    if (photos.length <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % photos.length), 4500);
    return () => window.clearInterval(id);
  }, [photos.length]);

  const locationTicker = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const photo of photos) {
      if (photo.location && !seen.has(photo.location)) {
        seen.add(photo.location);
        list.push(photo.location);
      }
    }
    return list;
  }, [photos]);

  if (!photos.length) return null;

  return (
    <section
      aria-label={`${heading} — view the gallery`}
      className="hero-2026 scroll-reveal"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen();
      }}
      role="link"
      tabIndex={0}
    >
      <div className="hero-2026-photos" aria-hidden="true">
        {photos.map((photo, i) => (
          <div className={`hero-2026-frame${i === index ? " is-active" : ""}`} key={photo.id}>
            <SmartImage
              alt=""
              priority={i === 0}
              sizes="100vw"
              src={photo.imageUrl}
              srcSet={srcSetFor(photo)}
            />
          </div>
        ))}
      </div>
      <div className="hero-2026-copy">
        <p className="hero-2026-year">{heading}</p>
        <div className="hero-2026-route" aria-hidden="true">
          <span className="dot" />
          <span className="seg" />
          <Plane size={13} style={{ transform: "rotate(45deg)" }} />
          <span className="seg" />
          <span className="dot" />
        </div>
        {locationTicker.length ? <p className="hero-2026-locs">{locationTicker.join(" · ")}</p> : null}
      </div>
    </section>
  );
}

// The Collections rail: the galleries page's first filter axis. Each tab is a
// two-line chip (period over name — "2026" / "EUROPE") so a trip reads at a
// glance without extra copy. "All work" leads and clears the filter.
const ALL_COLLECTIONS = "__all__";

function CollectionRail({
  activeId,
  collections,
  counts,
  onChange,
}: {
  activeId: string;
  collections: Collection[];
  counts: Map<string, number>;
  onChange: (id: string) => void;
}) {
  return (
    // Reuses .location-rail for the scrolling flex row, then overrides it to sit
    // static (only the places rail sticks) with taller two-line tabs.
    <section className="location-rail collection-rail" aria-label="Filter gallery by collection">
      <button
        className={activeId === ALL_COLLECTIONS ? "active" : ""}
        onClick={() => onChange(ALL_COLLECTIONS)}
        type="button"
      >
        <span className="rail-period">All</span>
        <span className="rail-name">All work</span>
      </button>
      {collections.map((collection) => {
        const count = counts.get(collection.id) ?? 0;
        return (
          <button
            className={`${activeId === collection.id ? "active" : ""}${count === 0 ? " is-empty" : ""}`}
            key={collection.id}
            onClick={() => onChange(collection.id)}
            title={collection.subtitle ?? undefined}
            type="button"
          >
            <span className="rail-period">{collection.period || collection.name}</span>
            <span className="rail-name">
              {collection.period ? collection.name : "Collection"}
              {count === 0 ? " · empty" : ""}
            </span>
          </button>
        );
      })}
    </section>
  );
}

// The scope line under the collections rail (desktop). Names exactly what's on
// screen — "2024 Europe › Italy · 50 photos" — so a place tab can never be
// mistaken for the same place in another trip, and offers the one way out.
function CollectionScope({
  collection,
  place,
  count,
  onClear,
}: {
  collection: Collection;
  place: string | null;
  count: number;
  onClear: () => void;
}) {
  return (
    <div className="collection-scope">
      <span className="scope-text">
        Showing <b>{collectionTitle(collection)}</b>
        {place ? (
          <>
            <span className="scope-sep" aria-hidden="true">›</span>
            <b>{place}</b>
          </>
        ) : null}
      </span>
      <span className="scope-count">{count === 1 ? "1 photo" : `${count} photos`}</span>
      <button className="scope-clear" onClick={onClear} type="button">Clear</button>
    </div>
  );
}

function LocationRail({
  activeLocation,
  allLabel,
  excludeUnsorted = false,
  includeAllWork = true,
  locations,
  photos,
  onChange,
}: {
  activeLocation: ActiveLocation;
  // What the "no place chosen" tab reads as. On the galleries page it sits
  // beneath the collections rail, where "All places" is clearer than "All work".
  allLabel?: string;
  excludeUnsorted?: boolean;
  includeAllWork?: boolean;
  locations: GalleryLocation[];
  photos: Photo[];
  onChange: (location: ActiveLocation) => void;
}) {
  const photoLocationNames = new Set(photos.map((photo) => photo.location));
  // Deduped by name: two `locations` rows can share a display name (the archive
  // has a few), which otherwise emits duplicate React keys and renders the tab
  // twice. The rail is keyed by name, so one tab per name is the correct shape.
  const visibleLocations: ActiveLocation[] = [
    ...new Set(
      [
        ...(includeAllWork ? [allLocations] : []),
        ...locations
          .map((location) => location.name)
          .filter((locationName) => photoLocationNames.has(locationName)),
        ...[...photoLocationNames].filter(
          (locationName) => !locations.some((location) => location.name === locationName),
        ),
      ].filter((locationName) => !excludeUnsorted || locationName !== "Unsorted"),
    ),
  ];

  return (
    <section className="location-rail" aria-label="Filter gallery by location">
      {visibleLocations.map((location) => (
        <button
          className={activeLocation === location ? "active" : ""}
          key={location}
          onClick={() => onChange(location)}
          type="button"
        >
          {location === allLocations ? allLabel ?? location : location}
        </button>
      ))}
    </section>
  );
}

// Slim teaser strip between Recent Work and the gallery: copy on the left, a small
// data-driven minimap on the right that cycles a highlight through the locations.
// Inline SVG (no MapLibre) so the home page stays light; the whole strip opens /map.
function MapPromo({
  photos,
  locations,
  onOpen,
}: {
  photos: Photo[];
  locations: GalleryLocation[];
  onOpen: () => void;
}) {
  // Each "drone-feed" frame is image + telemetry. If admins have chosen feature
  // photos, the feed is exactly those (ordered by the location's feed order).
  // Otherwise it auto-picks one landscape-first shot per location.
  const frames = useMemo(() => {
    const usable = photos.filter(
      (p) => p.location && p.location !== "Unsorted" && p.latitude != null && p.longitude != null && p.imageUrl,
    );
    const order = new Map(locations.map((l) => [l.name, l.mapFeedOrder ?? 0]));
    const toFrame = (p: Photo) => ({
      // Carried so the rendered frames can be keyed uniquely: several featured
      // photos may share a location, so the location name is not a unique key.
      id: p.id,
      name: p.location,
      lat: p.latitude as number,
      lon: p.longitude as number,
      alt: p.relativeAltitude ?? null,
      image: p.storagePath ? getTransformedPublicUrl(photoBucket, p.storagePath, 640) : p.imageUrl,
    });

    const featured = usable.filter((p) => p.mapFeature);
    if (featured.length) {
      return featured
        .sort(
          (a, b) =>
            (order.get(a.location) ?? 0) - (order.get(b.location) ?? 0) ||
            (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
        )
        .slice(0, 12)
        .map(toFrame);
    }

    // Auto fallback: one photo per location, preferring landscape (least cropped).
    const isLandscape = (p: Photo) => p.aspect === "landscape" || p.aspect === "wide";
    const byLoc = new Map<string, Photo[]>();
    for (const p of usable) {
      const list = byLoc.get(p.location);
      if (list) list.push(p);
      else byLoc.set(p.location, [p]);
    }
    return [...byLoc.entries()]
      .map(([name, list]) => ({
        name,
        count: list.length,
        // Only landscape/wide shots auto-feature — never fall back to a portrait
        // (which would zoom hard under `cover`). Locations with no landscape are
        // simply skipped from the auto feed (admins can still feature one manually).
        sample: list.find((p) => isLandscape(p) && p.relativeAltitude != null) ?? list.find(isLandscape),
      }))
      .filter((x): x is { name: string; count: number; sample: Photo } => Boolean(x.sample))
      .sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0) || b.count - a.count)
      .slice(0, 10)
      .map(({ sample }) => toFrame(sample));
  }, [photos, locations]);

  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState("");

  // Advance the highlighted frame.
  useEffect(() => {
    if (frames.length <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setActive((a) => (a + 1) % frames.length), 2800);
    return () => window.clearInterval(id);
  }, [frames.length]);

  // Typewriter the active location name (left of the card).
  useEffect(() => {
    const name = frames[active]?.name ?? "";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setTyped(name); return; }
    setTyped("");
    let c = 0;
    const id = window.setInterval(() => {
      c += 1;
      setTyped(name.slice(0, c));
      if (c >= name.length) window.clearInterval(id);
    }, 58);
    return () => window.clearInterval(id);
  }, [active, frames]);

  if (frames.length < 2) return null;

  // `frames` can shrink under a live `active` index when the data silently
  // refreshes (tab refocus, admin edit) — clamp instead of crashing.
  const f = frames[active] ?? frames[0];
  const altPart = f.alt != null && Math.round(f.alt) >= 1 ? `  ·  ${Math.round(f.alt)}m` : "";
  const coords = `${Math.abs(f.lat).toFixed(2)}°${f.lat < 0 ? "S" : "N"}  ${Math.abs(f.lon).toFixed(2)}°${f.lon < 0 ? "W" : "E"}${altPart}`;

  return (
    <div className="map-promo">
      <span className="map-promo-text">
        <span className="eyebrow">On the map</span>
        <strong>See where these were shot</strong>
        <span className="map-promo-rotator">{typed}</span>
      </span>
      <button className="map-promo-mini" onClick={onOpen} type="button" aria-label="Open the map of photo locations">
        {frames.map((fr, i) => (
          <img
            key={fr.id}
            className={`map-promo-frame${i === active ? " is-on" : ""}`}
            src={fr.image}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ))}
        <span className="map-promo-bracket tl" />
        <span className="map-promo-bracket tr" />
        <span className="map-promo-bracket bl" />
        <span className="map-promo-bracket br" />
        <span className="map-promo-scan" />
        <span className="map-promo-read" key={active}>
          <strong>{f.name}</strong>
          <small>{coords}</small>
        </span>
        <span className="map-promo-cta">View map →</span>
      </button>
    </div>
  );
}

// Admin panel: curate the home page map-promo "drone feed" — pick which photos
// front each place, remove them, and order which place leads.
function MapFeedAdmin({
  photos,
  locations,
  onChanged,
}: {
  photos: Photo[];
  locations: GalleryLocation[];
  onChanged: () => Promise<void> | void;
}) {
  const [pickId, setPickId] = useState("");
  const [busy, setBusy] = useState(false);
  const [ratios, setRatios] = useState<Record<string, number>>({});

  // Only published, geotagged photos can actually appear in the feed.
  const eligible = useMemo(
    () =>
      photos.filter(
        (p) => p.published && p.latitude != null && p.longitude != null && p.imageUrl && p.location && p.location !== "Unsorted",
      ),
    [photos],
  );
  const featured = useMemo(() => eligible.filter((p) => p.mapFeature), [eligible]);
  const orderByName = useMemo(() => new Map(locations.map((l) => [l.name, l.mapFeedOrder ?? 0])), [locations]);
  const idByName = useMemo(() => new Map(locations.map((l) => [l.name, l.id])), [locations]);

  const featuredLocs = useMemo(() => {
    const m = new Map<string, Photo[]>();
    for (const p of featured) {
      const list = m.get(p.location);
      if (list) list.push(p);
      else m.set(p.location, [p]);
    }
    return [...m.entries()].sort(
      (a, b) => (orderByName.get(a[0]) ?? 0) - (orderByName.get(b[0]) ?? 0) || a[0].localeCompare(b[0]),
    );
  }, [featured, orderByName]);

  const pickPhotos = useMemo(() => eligible.filter((p) => p.locationId === pickId), [eligible, pickId]);
  const locationsWithPhotos = locations.filter((l) => eligible.some((p) => p.locationId === l.id));

  // The feed card is 16:9 (the library's most common ratio). Measure each photo's
  // true ratio (via SmartImage) and flag teal only when it genuinely fills the
  // card with no meaningful crop (<= ~4%); otherwise amber.
  const CARD_RATIO = 16 / 9;
  const measure = (id: string, ratio: number) =>
    setRatios((prev) => (prev[id] ? prev : { ...prev, [id]: ratio }));
  const fitOf = (p: Photo): "fit" | "crop" | null => {
    const r = ratios[p.id];
    if (r == null) return null; // not measured yet
    return Math.abs(r - CARD_RATIO) / CARD_RATIO <= 0.04 ? "fit" : "crop";
  };
  const fitBadge = (p: Photo) => {
    const f = fitOf(p);
    if (f === "fit") {
      return (
        <span className="map-feed-fit" title={`Fits the feed card — ${ratios[p.id].toFixed(2)}:1`}>
          <Check size={11} aria-hidden="true" />
        </span>
      );
    }
    if (f === "crop") {
      return (
        <span className="map-feed-warn" title={`Will be cropped — ${ratios[p.id].toFixed(2)}:1 vs 1.78 (16:9)`}>
          <TriangleAlert size={11} aria-hidden="true" />
        </span>
      );
    }
    return null;
  };

  async function toggle(photo: Photo) {
    if (busy) return;
    setBusy(true);
    try {
      await setMapFeature(photo.id, !photo.mapFeature);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const names = featuredLocs.map(([name]) => name);
    const j = index + dir;
    if (j < 0 || j >= names.length || busy) return;
    [names[index], names[j]] = [names[j], names[index]];
    setBusy(true);
    try {
      await Promise.all(
        names.map((name, i) => {
          const id = idByName.get(name);
          return id ? setLocationFeedOrder(id, i + 1) : Promise.resolve();
        }),
      );
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="map-feed-admin" aria-label="Drone feed curation">
      <div className="map-feed-head">
        <p className="eyebrow">Drone feed</p>
        <h2>Home map promo</h2>
      </div>
      <p className="map-feed-note">
        Choose the photos that front each place on the home page map card, and order which place leads.
        With nothing chosen it auto-picks a landscape shot per location.
      </p>

      <div className="map-feed-current">
        {featuredLocs.length === 0 ? (
          <p className="map-feed-empty">No features chosen yet — the feed is auto-picking.</p>
        ) : (
          featuredLocs.map(([name, pics], i) => (
            <div className="map-feed-loc" key={name}>
              <div className="map-feed-loc-head">
                <span className="map-feed-rank">{i + 1}</span>
                <strong>{name}</strong>
                <div className="map-feed-move">
                  <button type="button" disabled={i === 0 || busy} onClick={() => move(i, -1)} aria-label={`Move ${name} earlier`}>
                    ↑
                  </button>
                  <button type="button" disabled={i === featuredLocs.length - 1 || busy} onClick={() => move(i, 1)} aria-label={`Move ${name} later`}>
                    ↓
                  </button>
                </div>
              </div>
              <div className="map-feed-thumbs">
                {pics.map((p) => (
                  <button
                    className={`map-feed-thumb is-on${fitOf(p) === "crop" ? " is-misfit" : ""}`}
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p)}
                    title="Remove from feed"
                  >
                    <SmartImage src={p.imageUrl} alt={p.title} onMeasure={(r) => measure(p.id, r)} />
                    <span className="map-feed-badge remove"><X size={12} aria-hidden="true" /></span>
                    {fitBadge(p)}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <label className="map-feed-picker-label">
        Add from a location
        <select value={pickId} onChange={(e) => setPickId(e.target.value)}>
          <option value="">Choose a location…</option>
          {locationsWithPhotos.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </label>
      {pickId ? (
        <div className="map-feed-grid">
          {pickPhotos.length === 0 ? (
            <p className="map-feed-empty">No eligible (published, geotagged) photos here.</p>
          ) : (
            pickPhotos.map((p) => (
              <button
                className={`map-feed-thumb${p.mapFeature ? " is-on" : ""}${fitOf(p) === "crop" ? " is-misfit" : ""}`}
                key={p.id}
                type="button"
                onClick={() => toggle(p)}
                title={p.mapFeature ? "Remove from feed" : "Add to feed"}
              >
                <SmartImage src={p.imageUrl} alt={p.title} onMeasure={(r) => measure(p.id, r)} />
                <span className={`map-feed-badge${p.mapFeature ? " remove" : " add"}`}>
                  {p.mapFeature ? <X size={12} aria-hidden="true" /> : <Crosshair size={12} aria-hidden="true" />}
                </span>
                {fitBadge(p)}
              </button>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

function GalleryControls({
  onChange,
  onViewOnMap,
  view,
}: {
  onChange: (view: GalleryView) => void;
  onViewOnMap?: () => void;
  view: GalleryView;
}) {
  return (
    <div className="gallery-controls">
      {onViewOnMap ? (
        <button className="map-link-button" onClick={onViewOnMap} type="button">
          <Globe size={14} aria-hidden="true" />
          View on map
        </button>
      ) : null}
      <div className="view-toggle" role="group" aria-label="Gallery layout">
        <button
          aria-label="As they appear"
          aria-pressed={view === "flow"}
          className={view === "flow" ? "active" : ""}
          onClick={() => onChange("flow")}
          title="As they appear"
          type="button"
        >
          <LayoutDashboard size={16} aria-hidden="true" />
        </button>
        <button
          aria-label="Box grid"
          aria-pressed={view === "box"}
          className={view === "box" ? "active" : ""}
          onClick={() => onChange("box")}
          title="Box grid"
          type="button"
        >
          <LayoutGrid size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

// Minimal skeleton placeholder that mirrors the gallery grid while photos load.
// Just shimmering tiles — no imagery. Box view = uniform tiles; flow view = varied
// heights so the masonry reads like real photos.
const SKELETON_FLOW_RATIOS = ["3 / 4", "4 / 3", "1 / 1", "5 / 7", "4 / 5", "3 / 2", "16 / 10", "2 / 3", "1 / 1"];

function GallerySkeleton({ view }: { view: GalleryView }) {
  const count = view === "box" ? 9 : SKELETON_FLOW_RATIOS.length;
  return (
    <section
      className={`gallery view-${view} is-skeleton`}
      role="status"
      aria-label="Loading gallery"
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          className="skeleton-tile"
          key={index}
          aria-hidden="true"
          style={
            view === "flow"
              ? ({ aspectRatio: SKELETON_FLOW_RATIOS[index] } as CSSProperties)
              : undefined
          }
        />
      ))}
    </section>
  );
}

// Skeleton for the Recent Work mosaic — reuses the real mosaic grid classes so
// the placeholder sits exactly where the photos will land (no layout shift).
function RecentWorkSkeleton() {
  return (
    <section className="recent-work" aria-label="Loading recent work">
      <h2 className="recent-heading">Recent Work</h2>
      <div className="recent-mosaic" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => (
          <div className={`recent-tile recent-tile-${index + 1} skeleton-tile`} key={index} />
        ))}
      </div>
    </section>
  );
}

// Skeleton for the location filter rail — a row of pill placeholders matching
// the real rail's sticky bar and button sizing.
const SKELETON_RAIL_WIDTHS = [64, 88, 72, 96, 70, 82];

function LocationRailSkeleton() {
  return (
    <section className="location-rail" aria-hidden="true">
      {SKELETON_RAIL_WIDTHS.map((width, index) => (
        <span className="rail-skeleton" key={index} style={{ width } as CSSProperties} />
      ))}
    </section>
  );
}

function Gallery({
  isAdmin,
  onEditPhoto,
  onSelectPhoto,
  onWarm,
  onSendToTop,
  onToggleMapFeature,
  onUnpublish,
  photos,
  view,
}: {
  isAdmin: boolean;
  onEditPhoto: (photo: Photo) => void;
  onSelectPhoto: (photo: Photo, from?: HTMLElement) => void;
  onWarm?: (photo: Photo) => void;
  onSendToTop: (photo: Photo) => void;
  onToggleMapFeature: (photo: Photo) => void;
  onUnpublish: (photo: Photo) => void;
  photos: Photo[];
  view: GalleryView;
}) {
  return (
    <section className={`gallery view-${view}`} aria-label="Photography gallery">
      {photos.map((photo, index) => (
        <div
          className={`photo-tile ${photo.aspect} scroll-reveal${isAdmin ? " is-admin" : ""}`}
          key={photo.id}
          onClick={(event) => onSelectPhoto(photo, event.currentTarget)}
          onPointerDown={() => onWarm?.(photo)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelectPhoto(photo);
            }
          }}
          role="button"
          tabIndex={0}
          style={
            {
              "--reveal-delay": `${Math.min(index, 8) * 32}ms`,
              // Flow view reserves each tile's true shape up front so the
              // masonry never reflows as images arrive. (Box view keeps its
              // uniform CSS aspect.)
              ...(view === "flow" ? { aspectRatio: String(tileRatio(photo)) } : null),
            } as CSSProperties
          }
        >
          <SmartImage
            src={photo.imageUrl}
            srcSet={srcSetFor(photo)}
            sizes={GRID_SIZES}
            vtId={photo.id}
            alt={`${photo.title}, ${photo.location}`}
            // First screenful loads immediately (and is pre-warmed by the
            // gallery gate); the rest fetch lazily as you scroll, so the page
            // never trickles in from the bottom.
            eager={index < EAGER_TILE_COUNT}
          />
          <div className="photo-meta">
            <span>
              <MapPin size={13} aria-hidden="true" />
              {photo.location}
            </span>
            <strong>{photo.title}</strong>
            {photo.year ? <small>{photo.year}</small> : null}
          </div>
          <AltitudeBadge photo={photo} />
          {isAdmin ? (
            <div className="tile-admin-actions">
              <button
                aria-label="Send to top of this category"
                onClick={(event) => {
                  event.stopPropagation();
                  onSendToTop(photo);
                }}
                title="Send to top"
                type="button"
              >
                <ArrowUpToLine size={14} aria-hidden="true" />
              </button>
              <button
                aria-label="Edit photo"
                onClick={(event) => {
                  event.stopPropagation();
                  onEditPhoto(photo);
                }}
                title="Edit"
                type="button"
              >
                <Pencil size={14} aria-hidden="true" />
              </button>
              <button
                aria-label={photo.mapFeature ? "Remove from map feed" : "Feature in map feed"}
                className={photo.mapFeature ? "is-active" : ""}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleMapFeature(photo);
                }}
                title={photo.mapFeature ? "Featured in map feed" : "Feature in map feed"}
                type="button"
              >
                <Crosshair size={14} aria-hidden="true" />
              </button>
              <button
                aria-label="Unpublish photo"
                onClick={(event) => {
                  event.stopPropagation();
                  onUnpublish(photo);
                }}
                title="Unpublish"
                type="button"
              >
                <EyeOff size={14} aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function Lightbox({
  photo,
  origin,
  onClose,
  onViewOnMap,
  onViewGallery,
  onOrderPrint,
}: {
  photo: Photo;
  // Viewport point the photo was opened from — the tapped tile's centre.
  origin?: { x: number; y: number } | null;
  onClose: () => void;
  onViewOnMap: (photo: Photo) => void;
  // Only passed on the home page — inside /galleries you're already looking at
  // the place the photo belongs to, so the button would go nowhere useful.
  onViewGallery?: (photo: Photo) => void;
  // Only passed when print_configurator is on — every published photo (not
  // just the curated /shop grid) gets a way to order it as a print.
  onOrderPrint?: (photo: Photo) => void;
}) {
  // Every published row carries an exact 4dp width/height ratio, so the panel
  // is laid out correctly on its FIRST render — no measuring, no correcting.
  //
  // This used to start null and get fixed up by onMeasure once the image
  // loaded, which meant the panel picked a layout, then swapped grid template
  // and width the moment the bytes arrived. During a view transition that
  // relayout lands mid-animation and is most of what made the morph feel
  // clunky. tileRatio() falls back to the aspect bucket if a ratio is missing.
  const ratio = tileRatio(photo);
  // Only RESERVE a shape when the row actually carries one. tileRatio() falls
  // back to a nominal bucket value, and reserving that would letterbox the
  // photo inside its own frame — a guess is fine for choosing the layout, but
  // not for pinning the box.
  const exactRatio = photo.ratio ?? null;

  // Grow the panel out of the tile that was tapped instead of out of its own
  // centre. transform-origin is relative to the panel's own box, so the tile's
  // viewport point has to be converted into a percentage of it. useLayoutEffect
  // so it lands before the entry animation's first frame.
  const panelRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (!origin) {
      panel.style.removeProperty("transform-origin");
      return;
    }
    // The entry animation's from-state is already applied by the time this
    // runs, so getBoundingClientRect() reports the SCALED box. Recover the
    // resting box from the layout size, or the origin lands a few px adrift.
    const box = panel.getBoundingClientRect();
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    if (!w || !h) return;
    const left = box.left + (box.width - w) / 2;
    const top = box.top + (box.height - h) / 2;
    // Clamped so a tile far off-screen doesn't fling the origin miles away and
    // turn a gentle scale into a slide across the viewport.
    const clamp = (v: number) => Math.max(-40, Math.min(140, v));
    const x = clamp(((origin.x - left) / w) * 100);
    const y = clamp(((origin.y - top) / h) * 100);
    panel.style.transformOrigin = `${x.toFixed(1)}% ${y.toFixed(1)}%`;
  }, [origin, photo.id]);

  // Play the exit animation, THEN unmount. Without this the panel is ripped out
  // of the DOM the instant you hit the X — the photo just vanishes, which is
  // what made closing feel abrupt.
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const dismiss = useCallback(() => {
    if (closeTimer.current) return; // already on the way out
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onClose();
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, LIGHTBOX_EXIT_MS);
  }, [onClose]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismiss]);

  const hasCoords = photo.latitude != null && photo.longitude != null;
  // "Unsorted" photos have no place page to land on, so the button is hidden
  // rather than pointing at an empty gallery.
  const canViewGallery = Boolean(onViewGallery && photo.location && photo.location !== "Unsorted");
  const canOrderPrint = Boolean(onOrderPrint);
  // Taller-than-wide → portrait card (image beside the caption); otherwise the
  // classic landscape card (image above the caption).
  const isPortrait = ratio < 1;

  return (
    <div className={`lightbox${closing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-label={photo.title}>
      <button className="lightbox-backdrop" onClick={dismiss} type="button" aria-label="Close" />
      <section className={`lightbox-panel${isPortrait ? " is-portrait" : ""}`} ref={panelRef}>
        <button className="icon-button close-button" onClick={dismiss} type="button" aria-label="Close">
          <X size={18} aria-hidden="true" />
        </button>
        <div
          className="lightbox-image"
          style={exactRatio ? ({ "--shot-ratio": String(exactRatio) } as CSSProperties) : undefined}
        >
          <SmartImage
            noFade
            src={photo.imageUrl}
            srcSet={srcSetFor(photo)}
            sizes={LIGHTBOX_SIZES}
            alt={`${photo.title}, ${photo.location}`}
          />
          <AltitudeBadge photo={photo} />
        </div>
        <aside className="lightbox-copy">
          <span className="lightbox-location">
            <MapPin size={13} aria-hidden="true" />
            {photo.location}
          </span>
          <h2>{photo.title}</h2>
          {photo.year ? <small>{photo.year}</small> : null}
          {hasCoords || canViewGallery || canOrderPrint ? (
            <div className="lightbox-actions">
              {canOrderPrint ? (
                <button className="map-link-button order-print-button" onClick={() => onOrderPrint!(photo)} type="button">
                  <Frame size={14} aria-hidden="true" />
                  Order a print
                </button>
              ) : null}
              {canViewGallery ? (
                <button className="map-link-button" onClick={() => onViewGallery!(photo)} type="button">
                  <Images size={14} aria-hidden="true" />
                  View gallery
                </button>
              ) : null}
              {hasCoords ? (
                <button className="map-link-button" onClick={() => onViewOnMap(photo)} type="button">
                  <Globe size={14} aria-hidden="true" />
                  View on map
                </button>
              ) : null}
            </div>
          ) : null}
        </aside>
      </section>
    </div>
  );
}

// Curation picker for one Collection. The archive is ~430 photos, so picking by
// hand alone would be miserable — the filters (location / year / free text) plus
// "Add all N matching" let you assemble a trip in a couple of clicks, while
// still allowing photo-by-photo control. Selection is kept as an ordered list.
function CollectionCurator({
  collection,
  photos,
  initialIds,
  onClose,
  onSave,
}: {
  collection: Collection;
  photos: Photo[];
  initialIds: string[];
  onClose: () => void;
  onSave: (ids: string[]) => Promise<void>;
}) {
  const [picks, setPicks] = useState<string[]>(initialIds);
  const [location, setLocation] = useState("All");
  const [year, setYear] = useState("All");
  const [query, setQuery] = useState("");
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const locationOptions = useMemo(
    () => [...new Set(photos.map((p) => p.location).filter(Boolean))].sort(),
    [photos],
  );
  const yearOptions = useMemo(
    () => [...new Set(photos.map((p) => p.year).filter(Boolean))].sort().reverse(),
    [photos],
  );

  const picked = useMemo(() => new Set(picks), [picks]);
  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return photos.filter((p) => {
      if (location !== "All" && p.location !== location) return false;
      if (year !== "All" && p.year !== year) return false;
      if (onlyPicked && !picked.has(p.id)) return false;
      if (!needle) return true;
      return (
        p.title.toLowerCase().includes(needle) ||
        p.location.toLowerCase().includes(needle) ||
        (p.sourcePath ?? "").toLowerCase().includes(needle)
      );
    });
  }, [photos, location, year, query, onlyPicked, picked]);

  const unpickedMatches = matching.filter((p) => !picked.has(p.id));

  function toggle(id: string) {
    setPicks((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }
  function addAllMatching() {
    setPicks((cur) => [...cur, ...unpickedMatches.map((p) => p.id).filter((id) => !cur.includes(id))]);
  }
  function removeAllMatching() {
    const ids = new Set(matching.map((p) => p.id));
    setPicks((cur) => cur.filter((id) => !ids.has(id)));
  }

  async function save() {
    setSaving(true);
    try {
      await onSave(picks);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "The collection could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Curate ${collectionTitle(collection)}`}>
      <button className="lightbox-backdrop" onClick={onClose} type="button" aria-label="Close" />
      <section className="picker-panel curator-panel">
        <button className="icon-button close-button" onClick={onClose} type="button" aria-label="Close">
          <X size={18} aria-hidden="true" />
        </button>
        <p className="eyebrow">Curate {collectionTitle(collection)}</p>
        <p className="picker-hint">
          Filter by place, year or name, then add them in bulk or one at a time. Photos can belong to
          more than one collection.
        </p>

        <div className="curator-filters">
          <label>
            <span>Place</span>
            <select value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="All">All places</option>
              {locationOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label>
            <span>Year</span>
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="All">All years</option>
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="curator-search">
            <span>Search</span>
            <input
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Title, place or filename"
              type="search"
              value={query}
            />
          </label>
          <label className="curator-check">
            <input checked={onlyPicked} onChange={(e) => setOnlyPicked(e.target.checked)} type="checkbox" />
            <span>Only chosen</span>
          </label>
        </div>

        <div className="curator-bulk">
          <span className="curator-matchcount">{matching.length} matching</span>
          <button
            className="ghost-button"
            disabled={!unpickedMatches.length}
            onClick={addAllMatching}
            type="button"
          >
            Add all {unpickedMatches.length || ""} matching
          </button>
          <button
            className="text-button"
            disabled={!matching.some((p) => picked.has(p.id))}
            onClick={removeAllMatching}
            type="button"
          >
            Remove matching
          </button>
        </div>

        <div className="picker-grid">
          {matching.map((photo) => {
            const index = picks.indexOf(photo.id);
            return (
              <button
                aria-pressed={index >= 0}
                className={`picker-tile${index >= 0 ? " is-picked" : ""}`}
                key={photo.id}
                onClick={() => toggle(photo.id)}
                title={`${photo.title} — ${photo.location}${photo.year ? ` (${photo.year})` : ""}`}
                type="button"
              >
                <SmartImage src={thumbUrl(photo, 300)} alt={`${photo.title}, ${photo.location}`} />
                {index >= 0 ? <span className="picker-badge">{index + 1}</span> : null}
                {!photo.published ? <span className="picker-draft">Draft</span> : null}
              </button>
            );
          })}
          {!matching.length ? <p className="picker-hint">Nothing matches those filters.</p> : null}
        </div>

        <div className="picker-actions">
          <span className="picker-count">{picks.length} in this collection</span>
          <span className="picker-actions-spacer" />
          <button className="ghost-button" disabled={!picks.length || saving} onClick={() => setPicks([])} type="button">
            Clear all
          </button>
          <button className="solid-button" disabled={saving} onClick={save} type="button">
            {saving ? "Saving…" : "Save collection"}
          </button>
        </div>
      </section>
    </div>
  );
}

// Admin panel: the running order of the places. This is `locations.sort_order`,
// which until now could only be changed by hand in SQL.
//
// It drives the home page's location card grid and the order of the place tabs
// on /galleries. It does NOT drive the phone list on the home page — that one
// is deliberately sorted newest-first and capped (see CollectionCards), so it
// stays a "latest work" list rather than a manual one.
function PlacesOrderAdmin({
  locations,
  photos,
  onChanged,
}: {
  locations: GalleryLocation[];
  photos: Photo[];
  onChanged: () => void;
}) {
  const [order, setOrder] = useState<GalleryLocation[]>(locations);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // Adopt the server's order whenever it genuinely changes. A reload elsewhere
  // in the dashboard will discard unsaved moves — the server is the truth, and
  // the "Unsaved changes" note makes it obvious there was something to save.
  const dirty = useMemo(
    () => order.map((l) => l.id).join() !== locations.map((l) => l.id).join(),
    [order, locations],
  );
  useEffect(() => {
    setOrder((prev) =>
      prev.map((l) => l.id).join() === locations.map((l) => l.id).join() ? prev : locations,
    );
    // Intentionally keyed on the server list only: re-running when `order`
    // changes would stomp the user's in-progress reordering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of photos) {
      if (!p.published || !p.location || p.location === "Unsorted") continue;
      map.set(p.location, (map.get(p.location) ?? 0) + 1);
    }
    return map;
  }, [photos]);

  function move(index: number, direction: -1 | 1) {
    const next = [...order];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      await setLocationOrder(order.map((l) => l.id));
      onChanged();
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the order.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-visibility" aria-label="Place order">
      <div className="admin-sec-head"><ArrowUpDown size={16} aria-hidden="true" /><h2>Place order</h2></div>
      <p className="admin-sec-hint">
        The running order of the location cards on the home page, and of the place tabs on the
        gallery. Places with no published photos are listed here but never appear publicly.
        The phone list on the home page ignores this — it always shows the ten most recent places.
      </p>

      <div className="place-order">
        {order.map((location, index) => {
          const count = counts.get(location.name) ?? 0;
          return (
            <div className={`place-row${count ? "" : " is-empty"}`} key={location.id}>
              <span className="place-pos">{index + 1}</span>
              <span className="place-id">
                <b>{location.name}</b>
                <span>
                  {count ? `${count} ${count === 1 ? "photo" : "photos"}` : "no published photos"}
                  {location.region ? ` · ${location.region}` : ""}
                </span>
              </span>
              <span className="place-actions">
                <button
                  aria-label={`Move ${location.name} up`}
                  className="icon-button"
                  disabled={busy || index === 0}
                  onClick={() => move(index, -1)}
                  title="Move up"
                  type="button"
                >
                  <ArrowUpToLine size={14} aria-hidden="true" />
                </button>
                <button
                  aria-label={`Move ${location.name} down`}
                  className="icon-button"
                  disabled={busy || index === order.length - 1}
                  onClick={() => move(index, 1)}
                  title="Move down"
                  type="button"
                >
                  <ArrowUpFromLine size={14} aria-hidden="true" />
                </button>
              </span>
            </div>
          );
        })}
      </div>

      <div className="place-order-foot">
        <button className="solid-button" disabled={busy || !dirty} onClick={save} type="button">
          {busy ? "Saving…" : "Save order"}
        </button>
        <button
          className="text-button"
          disabled={busy || !dirty}
          onClick={() => { setOrder(locations); setSaved(false); }}
          type="button"
        >
          Reset
        </button>
        {dirty ? <span className="place-order-note">Unsaved changes</span> : null}
        {saved && !dirty ? <span className="place-order-note is-ok">Order saved</span> : null}
        {error ? <span className="place-order-note is-bad">{error}</span> : null}
      </div>
    </section>
  );
}

// Admin panel: create, rename, reorder, hide and curate the gallery Collections.
// Everything about a collection is editable here — nothing is hardcoded.
function CollectionsAdmin({ photos }: { photos: Photo[] }) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [instagramPosts, setInstagramPosts] = useState<InstagramPost[]>([]);
  const [membership, setMembership] = useState<Map<string, string[]>>(new Map());
  const [curating, setCurating] = useState<Collection | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", period: "", subtitle: "" });
  const [newName, setNewName] = useState("");
  const [newPeriod, setNewPeriod] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [list, links] = await Promise.all([getAdminCollections(), getCollectionMembership()]);
    setCollections(list);
    setMembership(links);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(collection: Collection) {
    setEditingId(collection.id);
    setDraft({
      name: collection.name,
      period: collection.period ?? "",
      subtitle: collection.subtitle ?? "",
    });
  }

  async function move(collection: Collection, direction: -1 | 1) {
    const index = collections.findIndex((c) => c.id === collection.id);
    const swap = collections[index + direction];
    if (!swap) return;
    await run(async () => {
      await updateCollection(collection.id, { sortOrder: swap.sortOrder });
      await updateCollection(swap.id, { sortOrder: collection.sortOrder });
    });
  }

  return (
    <section className="admin-visibility" aria-label="Collections">
      <div className="admin-sec-head"><LayoutGrid size={16} aria-hidden="true" /><h2>Collections</h2></div>
      <p className="admin-sec-hint">
        Trips and bodies of work, shown as the top filter on the gallery. Choosing one narrows the place
        tabs to just its places. A collection stays hidden from the public until it has a published photo.
      </p>

      {!collections.length ? (
        <p className="admin-sec-hint">
          No collections yet — either none have been created, or the <code>series</code> migration hasn’t been
          run against the database.
        </p>
      ) : null}

      <div className="coll-list">
        {collections.map((collection, index) => {
          const count = (membership.get(collection.id) ?? []).length;
          const isEditing = editingId === collection.id;
          return (
            <div className={`coll-row${collection.isVisible ? "" : " is-hidden"}`} key={collection.id}>
              {isEditing ? (
                <div className="coll-edit">
                  <label>
                    <span>Big line</span>
                    <input
                      onChange={(e) => setDraft({ ...draft, period: e.target.value })}
                      placeholder="2026"
                      value={draft.period}
                    />
                  </label>
                  <label>
                    <span>Name</span>
                    <input
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      placeholder="Europe"
                      value={draft.name}
                    />
                  </label>
                  <label className="coll-edit-wide">
                    <span>Subtitle (optional)</span>
                    <input
                      onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
                      placeholder="Italy, Denmark, Portugal and Greece"
                      value={draft.subtitle}
                    />
                  </label>
                  <div className="coll-edit-actions">
                    <button
                      className="solid-button"
                      disabled={busy}
                      onClick={() => run(async () => {
                        await updateCollection(collection.id, draft);
                        setEditingId(null);
                      })}
                      type="button"
                    >
                      Save
                    </button>
                    <button className="text-button" onClick={() => setEditingId(null)} type="button">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="coll-id">
                    <b>{collectionTitle(collection)}</b>
                    <span>
                      {count === 1 ? "1 photo" : `${count} photos`}
                      {collection.subtitle ? ` · ${collection.subtitle}` : ""}
                      {collection.isVisible ? "" : " · hidden"}
                    </span>
                  </div>
                  <div className="coll-actions">
                    <button
                      aria-label="Move up"
                      className="icon-button"
                      disabled={busy || index === 0}
                      onClick={() => move(collection, -1)}
                      title="Move up"
                      type="button"
                    >
                      <ArrowUpToLine size={14} aria-hidden="true" />
                    </button>
                    <button
                      aria-label="Move down"
                      className="icon-button"
                      disabled={busy || index === collections.length - 1}
                      onClick={() => move(collection, 1)}
                      title="Move down"
                      type="button"
                    >
                      <ArrowUpFromLine size={14} aria-hidden="true" />
                    </button>
                    <button className="ghost-button" disabled={busy} onClick={() => setCurating(collection)} type="button">
                      Photos
                    </button>
                    <button className="ghost-button" disabled={busy} onClick={() => startEdit(collection)} type="button">
                      Edit
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => run(() => updateCollection(collection.id, { isVisible: !collection.isVisible }))}
                      type="button"
                    >
                      {collection.isVisible ? "Hide" : "Show"}
                    </button>
                    <button
                      className="text-button danger"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Delete the "${collectionTitle(collection)}" collection? The photos themselves are kept.`)) return;
                        run(() => deleteCollection(collection.id));
                      }}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="coll-new">
        <label>
          <span>Big line</span>
          <input onChange={(e) => setNewPeriod(e.target.value)} placeholder="2026" value={newPeriod} />
        </label>
        <label>
          <span>Name</span>
          <input onChange={(e) => setNewName(e.target.value)} placeholder="Europe" value={newName} />
        </label>
        <button
          className="solid-button"
          disabled={busy || !newName.trim()}
          onClick={() => run(async () => {
            await createCollection({ name: newName, period: newPeriod });
            setNewName("");
            setNewPeriod("");
          })}
          type="button"
        >
          <Plus size={14} aria-hidden="true" /> Add collection
        </button>
      </div>
      {error ? <p className="coll-error">{error}</p> : null}

      {curating ? (
        <CollectionCurator
          collection={curating}
          initialIds={membership.get(curating.id) ?? []}
          onClose={() => setCurating(null)}
          onSave={async (ids) => {
            await setCollectionPhotos(curating.id, ids);
            await load();
            setCurating(null);
          }}
          photos={photos}
        />
      ) : null}
    </section>
  );
}

// The public visibility flags the admin can toggle. Labels live here (not just
// the DB) so the panel reads well even if a seed row is missing.
const VISIBILITY_FLAGS: { key: string; label: string; hint: string }[] = [
  { key: "hero_2026", label: "Home — 2026 Europe hero", hint: "The crossfading trip banner near the top of the home page." },
  { key: "recent_work", label: "Home — Recent Work mosaic", hint: "The editorial photo mosaic near the top of the home page." },
  { key: "map_promo", label: "Home — Map promo", hint: "The interactive-map teaser on the home page." },
  { key: "collection_cards", label: "Home — Collection cards", hint: "The cycling location tiles on the home page." },
  { key: "framed_banner", label: "Home — Framed Editions banner", hint: "The print-shop banner near the bottom of the home page." },
  { key: "contact_prompt", label: "Home — Contact / Work with me", hint: "The “Let’s work together” prompt + contact popup." },
  { key: "instagram_feed", label: "Home — Instagram feed", hint: "The live strip of your latest Instagram posts, above the footer." },
  { key: "shop_public", label: "Shop page — public", hint: "Open /shop to the public (otherwise it shows “Opening soon”)." },
  { key: "print_configurator", label: "Shop — Print configurator", hint: "The true-to-size room preview + size/frame/mount picker + cart on each print's own page (/shop/<slug>). Off = the old inline size picker stays on the shop grid." },
];

// Flags that default OFF with no site_settings row (vs. every other flag,
// which defaults ON) — "not ready to launch yet", not "hide this section".
// Matched here so the toggle itself shows the true state on a fresh install,
// instead of reading "on" for something the public gate is actually hiding.
const DEFAULT_OFF_FLAGS = new Set(["shop_public", "print_configurator"]);

// Admin panel: flip what the public can see, and choose the two photos shown in
// the home Framed Editions banner. Reads/writes public.site_settings.
function VisibilityAdmin({ photos, locations }: { photos: Photo[]; locations: GalleryLocation[] }) {
  const [settings, setSettings] = useState<SiteSetting[]>([]);
  const [bannerSlot, setBannerSlot] = useState<null | "portrait" | "landscape">(null);
  const [curatingHero2026, setCuratingHero2026] = useState(false);
  const [adminCollections, setAdminCollections] = useState<Collection[]>([]);
  const [busy, setBusy] = useState(false);

  // For the 2026 picker's candidate list — narrows a big archive down to the
  // trip's own photos so curating doesn't mean scrolling past every gallery.
  const regionByLocation = useMemo(() => new Map(locations.map((l) => [l.name, l.region])), [locations]);

  const load = useCallback(async () => {
    const [siteSettings, collections] = await Promise.all([getSiteSettings(), getAdminCollections()]);
    setSettings(siteSettings);
    setAdminCollections(collections);
  }, []);

  // Wrap a setting write so the controls lock while it's in flight.
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      await load();
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load();
  }, [load]);

  const flags = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const s of settings) map[s.key] = s.enabled;
    return map;
  }, [settings]);
  const value = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const s of settings) map[s.key] = s.value;
    return map;
  }, [settings]);

  async function toggle(key: string, next: boolean) {
    setBusy(true);
    try {
      await setSiteFlag(key, next);
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function pickBanner(orientation: "portrait" | "landscape", id: string | null) {
    setBusy(true);
    try {
      await setSiteSetting(orientation === "portrait" ? "banner_portrait" : "banner_landscape", id);
      await load();
      setBannerSlot(null);
    } finally {
      setBusy(false);
    }
  }

  const chosen = {
    portrait: photos.find((p) => p.id === value.banner_portrait),
    landscape: photos.find((p) => p.id === value.banner_landscape),
  };

  // The 2026 Europe hero carousel: an ordered id list in one site_settings
  // value (same JSON-array-in-a-string trick the shop's "wall" preview uses).
  const hero2026Ids = useMemo(() => {
    try {
      return value.hero_2026_photos ? (JSON.parse(value.hero_2026_photos) as string[]) : [];
    } catch {
      return [];
    }
  }, [value.hero_2026_photos]);
  const hero2026Chosen = useMemo(() => {
    const byId = new Map(photos.map((p) => [p.id, p]));
    return hero2026Ids.map((id) => byId.get(id)).filter((p): p is Photo => Boolean(p));
  }, [hero2026Ids, photos]);
  async function saveHero2026(orderedIds: string[]) {
    setBusy(true);
    try {
      await setSiteSetting("hero_2026_photos", orderedIds.length ? JSON.stringify(orderedIds) : null);
      await load();
      setCuratingHero2026(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-visibility" aria-label="Visibility and banner">
      <div className="admin-sec-head"><Eye size={16} aria-hidden="true" /><h2>Visibility</h2></div>
      <p className="admin-sec-hint">Choose what the public sees. You always see everything while signed in.</p>
      <div className="vis-flags">
        {VISIBILITY_FLAGS.map((f) => {
          const on = DEFAULT_OFF_FLAGS.has(f.key) ? flags[f.key] === true : flags[f.key] !== false;
          return (
            <div className="vis-flag" key={f.key}>
              <span className="vis-flag-text"><b>{f.label}</b><span>{f.hint}</span></span>
              <button
                type="button"
                className={`vis-toggle${on ? " on" : ""}`}
                onClick={() => toggle(f.key, !on)}
                disabled={busy}
                aria-pressed={on}
                aria-label={`${f.label} ${on ? "visible" : "hidden"}`}
              >
                <span className="vis-knob" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="admin-sec-head vis-banner-head"><Images size={16} aria-hidden="true" /><h2>Banner frames</h2></div>
      <p className="admin-sec-hint">The two photos shown in the home Framed Editions banner. Leave on “Auto” to pick the latest.</p>
      <div className="banner-slots">
        {(["portrait", "landscape"] as const).map((orient) => (
          <div className="banner-slot" key={orient}>
            <div className="banner-slot-frame">
              {chosen[orient] ? (
                <OakFrame src={thumbUrl(chosen[orient] as Photo, 520)} orientation={orient} alt={(chosen[orient] as Photo).title} />
              ) : (
                <div className="banner-slot-empty">Auto</div>
              )}
            </div>
            <div className="banner-slot-actions">
              <span className="banner-slot-label">{orient}</span>
              <button className="ghost-button" type="button" onClick={() => setBannerSlot(orient)} disabled={busy}>Choose</button>
              {chosen[orient] ? (
                <button className="text-button" type="button" onClick={() => pickBanner(orient, null)} disabled={busy}>Reset</button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {bannerSlot ? (
        <OrderedPhotoPicker
          title={`Banner ${bannerSlot} photo`}
          hint={`Pick one ${bannerSlot} photo for the home banner frame.`}
          max={1}
          photos={photos.filter(
            (p) =>
              p.published &&
              (bannerSlot === "portrait"
                ? p.aspect === "portrait" || p.aspect === "square"
                : p.aspect === "landscape" || p.aspect === "wide"),
          )}
          initialIds={value[bannerSlot === "portrait" ? "banner_portrait" : "banner_landscape"] ? [value[bannerSlot === "portrait" ? "banner_portrait" : "banner_landscape"] as string] : []}
          onClose={() => setBannerSlot(null)}
          onSave={async (ids) => { await pickBanner(bannerSlot, ids[0] ?? null); }}
        />
      ) : null}
      <div className="admin-sec-head vis-banner-head"><Images size={16} aria-hidden="true" /><h2>2026 Europe hero</h2></div>
      <p className="admin-sec-hint">
        Photos that crossfade in the home page's "2026" banner. Order sets the crossfade sequence and the
        location ticker beneath it — pick them in the order you want the trip to read. Empty = the banner
        stays hidden.
      </p>
      <div className="hero2026-strip">
        {hero2026Chosen.length ? (
          hero2026Chosen.map((photo, i) => (
            <div className="hero2026-thumb" key={photo.id}>
              <img alt={photo.title} src={thumbUrl(photo, 160)} />
              <span>{i + 1}</span>
            </div>
          ))
        ) : (
          <div className="banner-slot-empty">None chosen — banner hidden</div>
        )}
      </div>
      <div className="banner-slot-actions">
        <button className="ghost-button" type="button" onClick={() => setCuratingHero2026(true)} disabled={busy}>
          Choose photos
        </button>
        {hero2026Chosen.length ? (
          <button className="text-button" type="button" onClick={() => saveHero2026([])} disabled={busy}>
            Clear
          </button>
        ) : null}
      </div>
      <label className="hero2026-target">
        <span>Banner heading</span>
        <input
          defaultValue={value.hero_2026_title ?? "Europe 2026"}
          disabled={busy}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next === (value.hero_2026_title ?? "Europe 2026")) return;
            run(() => setSiteSetting("hero_2026_title", next || null));
          }}
          placeholder="Europe 2026"
        />
      </label>
      <label className="hero2026-target">
        <span>Clicking the banner opens</span>
        <select
          disabled={busy}
          onChange={(e) => run(() => setSiteSetting("hero_2026_collection", e.target.value || null))}
          value={value.hero_2026_collection ?? ""}
        >
          <option value="">Auto — the collection its photos are in</option>
          {adminCollections.map((collection) => (
            <option key={collection.id} value={collection.slug}>{collectionTitle(collection)}</option>
          ))}
          <option value="__none__">The full gallery (no collection)</option>
        </select>
      </label>
      {curatingHero2026 ? (
        <OrderedPhotoPicker
          title="2026 Europe hero carousel"
          hint="Pick and order up to 16 photos from the trip. They crossfade in that order on the home page; the ticker beneath reads their locations, first-seen order."
          max={16}
          photos={photos.filter((p) => p.published && regionByLocation.get(p.location) === "Europe")}
          initialIds={hero2026Ids}
          onClose={() => setCuratingHero2026(false)}
          onSave={saveHero2026}
        />
      ) : null}
    </section>
  );
}

function AdminApp({ onNavigate }: { onNavigate: (route: string) => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setIsChecking(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setIsAdmin(false);
      setIsChecking(false);
      return;
    }

    setIsChecking(true);
    isCurrentUserAdmin()
      .then(setIsAdmin)
      .finally(() => setIsChecking(false));
  }, [session]);

  function goHome() {
    window.history.pushState({}, "", "/");
    onNavigate("/");
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <button className="brand" onClick={goHome} type="button" aria-label="Back to gallery">
          SD
        </button>
        <button className="text-button" onClick={goHome} type="button">
          View site
        </button>
      </header>
      {!hasSupabaseEnv ? <AdminNotice /> : null}
      {isChecking ? <p className="loading-note">Checking admin access</p> : null}
      {!session && !isChecking ? <AdminLogin /> : null}
      {session && !isAdmin && !isChecking ? <NotAdmin email={session.user.email ?? ""} /> : null}
      {session && isAdmin ? <AdminDashboard session={session} /> : null}
    </main>
  );
}

function AdminNotice() {
  return (
    <section className="admin-card">
      <Lock size={18} aria-hidden="true" />
      <p>Supabase is not configured in this environment.</p>
    </section>
  );
}

function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || isSending) return;

    setIsSending(true);
    setMessage("");

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      setMessage(error ? error.message : "");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className="admin-login">
      <div>
        <p className="eyebrow">Private admin</p>
        <h1>Sign in to manage the archive.</h1>
      </div>
      <form className="admin-card" onSubmit={submit}>
        <label>
          Email
          <input
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            type="email"
            value={email}
          />
        </label>
        <label>
          Password
          <input
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            required
            type="password"
            value={password}
          />
        </label>
        <button className="solid-button" disabled={isSending} type="submit">
          {isSending ? "Signing in" : "Sign in"}
        </button>
        {message ? <p className="form-note">{message}</p> : null}
      </form>
    </section>
  );
}

function NotAdmin({ email }: { email: string }) {
  return (
    <section className="admin-card">
      <Lock size={18} aria-hidden="true" />
      <h2>Signed in, but not an admin yet.</h2>
      <p>
        Add <strong>{email}</strong> to the `admin_users` table, then refresh this page.
      </p>
    </section>
  );
}

function AdminDashboard({ session }: { session: Session }) {
  const [locations, setLocations] = useState<GalleryLocation[]>([]);
  const [adminPhotos, setAdminPhotos] = useState<Photo[]>([]);
  const [activeLocation, setActiveLocation] =
    useState<ActiveLocation>(allLocations);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [editingPhotoId, setEditingPhotoId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [bulkTitle, setBulkTitle] = useState("");
  const [bulkLocationId, setBulkLocationId] = useState("");
  const [newLocationName, setNewLocationName] = useState("");
  const [message, setMessage] = useState("");
  // One global in-flight flag: disables write controls during any save so a
  // tap-again on a slow connection can't double-submit (e.g. delete twice). The
  // ref guards the gap before `disabled` re-renders (a rapid double-tap).
  const [working, setWorking] = useState(false);
  const workingRef = useRef(false);

  // Auto-dismiss the toast so a stale success/error doesn't linger.
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => setMessage(""), 6000);
    return () => window.clearTimeout(t);
  }, [message]);

  async function refresh() {
    const [galleryData, nextAdminPhotos] = await Promise.all([
      getGalleryData(),
      getAdminPhotos(),
    ]);
    setLocations(galleryData.locations);
    setAdminPhotos(nextAdminPhotos);
  }

  // Wrap a write so controls lock while it runs and a failure always surfaces.
  async function run(fn: () => Promise<void>, failMsg: string) {
    if (workingRef.current) return;
    workingRef.current = true;
    setWorking(true);
    try {
      await fn();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : failMsg);
    } finally {
      workingRef.current = false;
      setWorking(false);
    }
  }

  useEffect(() => {
    refresh().catch((error) => setMessage(error.message));
  }, []);

  const filteredPhotos = useMemo(() => {
    if (activeLocation === allLocations) return adminPhotos;
    return adminPhotos.filter((photo) => photo.location === activeLocation);
  }, [activeLocation, adminPhotos]);

  // Catalogue search: match title, location, or the original source filename/path
  // so a customer pointing at a photo can be traced back to the full-res file.
  const visiblePhotos = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return filteredPhotos;
    return filteredPhotos.filter(
      (photo) =>
        photo.title.toLowerCase().includes(q) ||
        photo.location.toLowerCase().includes(q) ||
        (photo.sourcePath ?? "").toLowerCase().includes(q),
    );
  }, [filteredPhotos, query]);

  useEffect(() => {
    if (
      activeLocation !== allLocations &&
      !adminPhotos.some((photo) => photo.location === activeLocation)
    ) {
      setActiveLocation(allLocations);
    }
  }, [activeLocation, adminPhotos]);

  async function signOut() {
    await supabase?.auth.signOut();
  }

  function toggleSelection(photoId: string) {
    setSelectedPhotoIds((current) => {
      const next = new Set(current);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  }

  async function bulkUpdate(input: { featured?: boolean; published?: boolean }) {
    const ids = [...selectedPhotoIds];
    if (!ids.length) return;
    await run(async () => {
      await updatePhotoCuration(ids, input);
      setSelectedPhotoIds(new Set());
      setMessage(`Updated ${ids.length} photo${ids.length === 1 ? "" : "s"}.`);
      await refresh();
    }, "Could not update photos.");
  }

  function selectAllFiltered() {
    setSelectedPhotoIds(new Set(visiblePhotos.map((photo) => photo.id)));
  }

  async function bulkRename() {
    const ids = [...selectedPhotoIds];
    if (!ids.length || !bulkTitle.trim()) return;
    if (!window.confirm(`Rename ${ids.length} selected photo${ids.length === 1 ? "" : "s"} to "${bulkTitle.trim()}"?`)) return;
    await run(async () => {
      await bulkEditPhotos(ids, { title: bulkTitle.trim() });
      setBulkTitle("");
      setSelectedPhotoIds(new Set());
      setMessage(`Renamed ${ids.length} photo${ids.length === 1 ? "" : "s"}.`);
      await refresh();
    }, "Could not rename photos.");
  }

  async function bulkSetLocation() {
    const ids = [...selectedPhotoIds];
    if (!ids.length) return;
    const locationName = locations.find((l) => l.id === bulkLocationId)?.name ?? "Unsorted";
    if (!window.confirm(`Move ${ids.length} selected photo${ids.length === 1 ? "" : "s"} to ${locationName}?`)) return;
    await run(async () => {
      // Move only — titles are curated individually and must survive a re-bucket.
      await bulkEditPhotos(ids, { locationId: bulkLocationId || null });
      setBulkLocationId("");
      setSelectedPhotoIds(new Set());
      setMessage(`Moved ${ids.length} photo${ids.length === 1 ? "" : "s"} to ${locationName}.`);
      await refresh();
    }, "Could not move photos.");
  }

  async function removePhoto(photo: Photo) {
    if (
      !window.confirm(
        `Delete "${photo.title}" permanently? This removes the photo and its image file.`,
      )
    ) {
      return;
    }
    await run(async () => {
      await deletePhoto(photo.id, photo.storagePath);
      setSelectedPhotoIds((current) => {
        const next = new Set(current);
        next.delete(photo.id);
        return next;
      });
      setMessage(`Deleted "${photo.title}".`);
      await refresh();
    }, "Could not delete photo.");
  }

  async function addLocation() {
    const name = newLocationName.trim();
    if (!name) return;
    await run(async () => {
      await createLocation(name);
      setNewLocationName("");
      setMessage(`Added location "${name}".`);
      await refresh();
    }, "Could not add location.");
  }

  // The photo being edited (from the full admin records, so it carries
  // source_path even when search has filtered it out of the grid).
  const editingPhoto = editingPhotoId
    ? adminPhotos.find((photo) => photo.id === editingPhotoId) ?? null
    : null;

  return (
    <section className="admin-dashboard">
      <div className="admin-title">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Manage the photo archive.</h1>
          <p>{session.user.email}</p>
        </div>
        <button className="text-button" onClick={signOut} type="button">
          <LogOut size={15} aria-hidden="true" /> Sign out
        </button>
      </div>
      <UploadPanel locations={locations} onUploaded={refresh} setMessage={setMessage} />
      {message ? (
        <div className="admin-toast" role="status" onClick={() => setMessage("")}>{message}</div>
      ) : null}
      <MapFeedAdmin photos={adminPhotos} locations={locations} onChanged={refresh} />
      <CollectionsAdmin photos={adminPhotos} />
      <PlacesOrderAdmin locations={locations} photos={adminPhotos} onChanged={refresh} />
      <VisibilityAdmin photos={adminPhotos} locations={locations} />
      <LocationRail
        activeLocation={activeLocation}
        locations={locations}
        photos={adminPhotos}
        onChange={setActiveLocation}
      />
      <div className="admin-search">
        <Search size={16} aria-hidden="true" />
        <input
          aria-label="Search photos by title, location, or source filename"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search title, location, or source filename…"
          type="search"
          value={query}
        />
        {query ? (
          <span className="admin-search-count">
            {visiblePhotos.length} match{visiblePhotos.length === 1 ? "" : "es"}
          </span>
        ) : null}
      </div>
      <section className="admin-toolbar" aria-label="Bulk photo actions">
        <span>{selectedPhotoIds.size} selected</span>
        <button className="text-button" onClick={selectAllFiltered} type="button">
          Select all
        </button>
        <button className="text-button" onClick={() => setSelectedPhotoIds(new Set())} type="button">
          Clear
        </button>
        <button className="solid-button" onClick={() => bulkUpdate({ published: true })} type="button" disabled={working || !selectedPhotoIds.size}>
          Publish
        </button>
        <button className="text-button" onClick={() => bulkUpdate({ published: false })} type="button" disabled={working || !selectedPhotoIds.size}>
          Unpublish
        </button>
      </section>
      <section className="admin-bulk-edit" aria-label="Bulk edit selected">
        <div>
          <input
            onChange={(event) => setBulkTitle(event.target.value)}
            placeholder="Rename selected to…"
            type="text"
            value={bulkTitle}
          />
          <button className="text-button" onClick={bulkRename} type="button" disabled={working}>
            Rename
          </button>
        </div>
        <div>
          <select onChange={(event) => setBulkLocationId(event.target.value)} value={bulkLocationId}>
            <option value="">Unsorted</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          <button className="text-button" onClick={bulkSetLocation} type="button" disabled={working || !selectedPhotoIds.size}>
            Move to location
          </button>
        </div>
        <div>
          <input
            onChange={(event) => setNewLocationName(event.target.value)}
            placeholder="New location name…"
            type="text"
            value={newLocationName}
          />
          <button className="text-button" onClick={addLocation} type="button" disabled={working || !newLocationName.trim()}>
            <Plus size={14} aria-hidden="true" /> Add location
          </button>
        </div>
      </section>
      <section className="admin-curation-grid" aria-label="Photo curation grid">
        {visiblePhotos.map((photo, index) => (
          <article
            className={`admin-curation-card ${photo.aspect} ${
              selectedPhotoIds.has(photo.id) ? "selected" : ""
            }`}
            key={photo.id}
          >
            <button
              className="admin-card-image"
              onClick={() => toggleSelection(photo.id)}
              type="button"
            >
              <SmartImage src={photo.imageUrl} alt={photo.title} />
              <span className="selection-dot">{selectedPhotoIds.has(photo.id) ? "Selected" : "Select"}</span>
            </button>
            <div className="admin-card-meta">
                <span>
                  {photo.location}
                  {photo.year ? ` / ${photo.year}` : ""}
                </span>
                <strong>{photo.title}</strong>
                {photo.description ? <p>{photo.description}</p> : null}
                <small className="admin-facts">
                  {photo.kind}
                  {photo.relativeAltitude != null ? ` · ${Math.round(photo.relativeAltitude)}m` : ""}
                  {photo.latitude != null && photo.longitude != null
                    ? ` · ${photo.latitude.toFixed(3)}, ${photo.longitude.toFixed(3)}`
                    : ""}
                  {` · ${photo.published ? "Published" : "Draft"}`}
                </small>
                {photo.sourcePath ? (
                  <div className="admin-source" title={photo.sourcePath}>
                    <span className="admin-source-name">{sourceFilename(photo.sourcePath)}</span>
                    <CopyButton value={photo.sourcePath} label="Copy source path" />
                    <span className="admin-source-path">{photo.sourcePath}</span>
                  </div>
                ) : (
                  <small className="admin-source-missing">No source file linked</small>
                )}
                <div className="card-actions">
                  <button className="text-button edit-button" onClick={() => setEditingPhotoId(photo.id)} type="button">
                    <Pencil size={13} aria-hidden="true" /> Edit details
                  </button>
                  <button className="text-button danger" onClick={() => removePhoto(photo)} type="button" disabled={working}>
                    <Trash2 size={13} aria-hidden="true" /> Delete
                  </button>
                </div>
                <label>
                  <input
                    checked={Boolean(photo.published)}
                    disabled={working}
                    onChange={(event) => {
                      const published = event.target.checked;
                      void run(async () => {
                        await updatePhotoVisibility(photo.id, { featured: Boolean(photo.featured), published });
                        await refresh();
                      }, "Could not update the photo.");
                    }}
                    type="checkbox"
                  />
                  Published
                </label>
            </div>
          </article>
        ))}
      </section>
      {editingPhoto ? (
        <PhotoEditOverlay
          full
          locations={locations}
          onClose={() => setEditingPhotoId(null)}
          onSaved={async () => {
            setMessage("Photo details updated.");
            await refresh();
          }}
          photo={editingPhoto}
        />
      ) : null}
    </section>
  );
}

// Just the filename from a full source path (handles / and \ separators).
function sourceFilename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

// Small clipboard button used for source/storage paths, slugs, ids.
function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label={label ?? "Copy"}
      className="copy-chip"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
      title={label ?? "Copy"}
      type="button"
    >
      {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
    </button>
  );
}

// Parse the edit form into the updatePhotoDetails input. The basic fields always
// write. The rest only write from the FULL (admin) form — flagged by a hidden
// `_full` input — so the lightweight inline editor on the public gallery (whose
// photos never carry source_path/captured_at) can't silently clear them: any
// field it omits stays `undefined` (untouched). Blank numeric fields clear the
// column (null); blank sort order leaves it untouched.
function formToPhotoDetails(formData: FormData): Parameters<typeof updatePhotoDetails>[1] {
  const num = (key: string): number | null => {
    const raw = String(formData.get(key) ?? "").trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const details: Parameters<typeof updatePhotoDetails>[1] = {
    title: String(formData.get("title") || ""),
    description: String(formData.get("description") || ""),
    locationId: String(formData.get("locationId") || ""),
    year: Number(formData.get("year")) || undefined,
    aspect: String(formData.get("aspect") || "landscape") as Photo["aspect"],
  };
  if (formData.get("_full") !== "1") return details;

  const sort = num("sortOrder");
  details.kind = String(formData.get("kind") || "Drone") as Photo["kind"];
  details.capturedAt = String(formData.get("capturedAt") || "").trim() || null;
  details.relativeAltitude = num("altitude");
  details.latitude = num("latitude");
  details.longitude = num("longitude");
  details.sourcePath = String(formData.get("sourcePath") || "");
  details.sortOrder = sort == null ? undefined : sort;
  details.isPublished = formData.get("isPublished") === "on";
  details.isFeatured = formData.get("isFeatured") === "on";
  details.isMapFeature = formData.get("isMapFeature") === "on";
  return details;
}

function PhotoEditForm({
  locations,
  onCancel,
  onSave,
  photo,
  full = false,
}: {
  locations: GalleryLocation[];
  onCancel: () => void;
  onSave: (formData: FormData) => Promise<void>;
  photo: Photo;
  // `full` (admin) exposes every field; the lightweight public inline editor
  // leaves it false so it only touches the basic fields it actually loads.
  full?: boolean;
}) {
  const [isSaving, setIsSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;

    setIsSaving(true);
    try {
      await onSave(new FormData(event.currentTarget));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="admin-card-meta edit-photo-form" onSubmit={submit}>
      {full ? <input name="_full" type="hidden" value="1" /> : null}
      <label>
        Title
        <input defaultValue={photo.title} name="title" placeholder={photo.location} type="text" />
      </label>
      <label>
        Description
        <textarea defaultValue={photo.description ?? ""} name="description" rows={2} />
      </label>
      <label>
        Location
        <select defaultValue={photo.locationId ?? ""} name="locationId">
          <option value="">Unsorted</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </label>
      <div className="edit-grid">
        <label>
          Year
          <input defaultValue={photo.year} inputMode="numeric" name="year" placeholder="2026" type="number" />
        </label>
        <label>
          Ratio
          <select defaultValue={photo.aspect} name="aspect">
            <option>landscape</option>
            <option>portrait</option>
            <option>square</option>
            <option>wide</option>
          </select>
        </label>
      </div>
      {full ? (
        <>
          <div className="edit-grid">
            <label>
              Capture date
              <input defaultValue={photo.capturedAt ?? ""} name="capturedAt" type="date" />
            </label>
            <label>
              Kind
              <select defaultValue={photo.kind} name="kind">
                <option>Drone</option>
                <option>Landscape</option>
                <option>Travel</option>
              </select>
            </label>
            <label>
              Altitude (m)
              <input
                defaultValue={photo.relativeAltitude ?? ""}
                inputMode="decimal"
                name="altitude"
                placeholder="—"
                step="0.1"
                type="number"
              />
            </label>
            <label>
              Sort order
              <input defaultValue={photo.sortOrder ?? ""} inputMode="numeric" name="sortOrder" placeholder="—" type="number" />
            </label>
            <label>
              Latitude
              <input defaultValue={photo.latitude ?? ""} inputMode="decimal" name="latitude" placeholder="—" step="any" type="number" />
            </label>
            <label>
              Longitude
              <input defaultValue={photo.longitude ?? ""} inputMode="decimal" name="longitude" placeholder="—" step="any" type="number" />
            </label>
          </div>
          <label>
            Source file (original full-res)
            <input
              defaultValue={photo.sourcePath ?? ""}
              name="sourcePath"
              placeholder="/Volumes/SamD2/…/DJI_0001.JPG"
              type="text"
            />
          </label>
          <div className="check-row edit-flags">
            <label>
              <input defaultChecked={Boolean(photo.published)} name="isPublished" type="checkbox" /> Published
            </label>
            <label>
              <input defaultChecked={Boolean(photo.featured)} name="isFeatured" type="checkbox" /> Featured
            </label>
            <label>
              <input defaultChecked={Boolean(photo.mapFeature)} name="isMapFeature" type="checkbox" /> Map feature
            </label>
          </div>
          <dl className="edit-readonly">
            {photo.storagePath ? (
              <div>
                <dt>Storage</dt>
                <dd>
                  <code>{photo.storagePath}</code>
                  <CopyButton value={photo.storagePath} label="Copy storage path" />
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Slug</dt>
              <dd>
                <code>{photo.slug}</code>
                <CopyButton value={photo.slug} label="Copy slug" />
              </dd>
            </div>
            <div>
              <dt>ID</dt>
              <dd>
                <code>{photo.id}</code>
                <CopyButton value={photo.id} label="Copy id" />
              </dd>
            </div>
          </dl>
        </>
      ) : null}
      <div className="edit-actions">
        <button className="solid-button" disabled={isSaving} type="submit">
          {isSaving ? "Saving" : "Save changes"}
        </button>
        <button className="text-button" disabled={isSaving} onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </form>
  );
}

function PhotoEditOverlay({
  locations,
  onClose,
  onSaved,
  photo,
  full = false,
}: {
  locations: GalleryLocation[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  photo: Photo;
  full?: boolean;
}) {
  const [message, setMessage] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function save(formData: FormData) {
    try {
      await updatePhotoDetails(photo.id, {
        ...formToPhotoDetails(formData),
        previousTitle: photo.title,
      });
      await onSaved();
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save changes.");
    }
  }

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Edit ${photo.title}`}>
      <button className="lightbox-backdrop" onClick={onClose} type="button" aria-label="Close" />
      <section className="edit-overlay-panel">
        <button className="icon-button close-button" onClick={onClose} type="button" aria-label="Close">
          <X size={18} aria-hidden="true" />
        </button>
        <div className="edit-overlay-preview">
          <SmartImage src={photo.imageUrl} alt={`${photo.title}, ${photo.location}`} />
        </div>
        <div className="edit-overlay-body">
          <p className="eyebrow">Edit photo</p>
          <PhotoEditForm full={full} locations={locations} onCancel={onClose} onSave={save} photo={photo} />
          {message ? <p className="form-note">{message}</p> : null}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batch photo uploader (admin). Drop in one or many photos at once; each gets
// the SAME metadata tracing as a script import — GPS, drone altitude, capture
// date, exact ratio/aspect — plus a reverse-geocoded location suggestion.
// Titles and locations are editable per photo before upload, and new locations
// can be created inline. Built mobile-first and network-resilient (per-photo
// progress + retry, capped concurrency) because batches get uploaded from a
// phone, often on a poor overseas connection.
// ---------------------------------------------------------------------------

type QueueStatus = "analyzing" | "ready" | "uploading" | "done" | "error";

type QueueItem = {
  id: string;
  file: File;
  previewUrl: string;
  status: QueueStatus;
  stage: string; // short status label while busy, e.g. "Compressing"
  error: string;
  meta: ExtractedPhotoMeta | null;
  geo: Placement | null;
  hasGps: boolean;
  locating: boolean; // GPS present, reverse-geocode still in flight
  title: string;
  titleAuto: string; // the auto-derived title, so we know if the user edited it
  locationChoice: string; // existing location id | NEW_LOCATION | "" (Unsorted)
  locationTouched: boolean; // user picked a location → don't overwrite from geo
  newLocationName: string;
  newLocationRegion: string;
  kind: Photo["kind"];
  aspect: Photo["aspect"] | null; // measured at compression, cached for retry
  ratio: number | null;
  uploadedPath: string | null; // set once the asset is in storage, so a retry reuses it
};

const NEW_LOCATION = "__new__";
const UPLOAD_CONCURRENCY = 2; // phone-friendly: at most 2 images encoding at once
const ANALYZE_CONCURRENCY = 3; // bound exifr/preview work so big batches don't spike memory
const MAX_BATCH_FILES = 60; // soft cap — mobile Safari will kill the tab past this
let queueSeq = 0;

function kindFor(meta: ExtractedPhotoMeta | null, geo: Placement | null): Photo["kind"] {
  if (meta?.relativeAltitude != null) return "Drone";
  if (geo && !geo.isHome) return "Travel";
  return "Landscape";
}

// Retry a flaky async step (network upload / DB insert) with linear backoff.
// Compression is deterministic, so it's deliberately NOT retried.
async function retryAsync<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 800): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
    }
  }
  throw lastError;
}

function UploadPanel({
  locations,
  onUploaded,
  setMessage,
}: {
  locations: GalleryLocation[];
  onUploaded: () => Promise<void>;
  setMessage: (message: string) => void;
}) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [published, setPublished] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const itemsRef = useRef<QueueItem[]>(items);
  itemsRef.current = items;

  // Revoke object URLs on unmount so big batches don't leak memory.
  useEffect(() => () => { itemsRef.current.forEach((it) => URL.revokeObjectURL(it.previewUrl)); }, []);

  // Warn before leaving with an upload in flight or unsaved photos queued —
  // phone users switch apps constantly and mobile Safari evicts background tabs.
  useEffect(() => {
    const hasWork = isUploading || items.some((it) => it.status === "ready" || it.status === "error");
    if (!hasWork) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isUploading, items]);

  const patchItem = useCallback(
    (id: string, patch: Partial<QueueItem> | ((it: QueueItem) => Partial<QueueItem>)) => {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...(typeof patch === "function" ? patch(it) : patch) } : it)));
    },
    [],
  );

  // Match a reverse-geocoded category name to an existing location row.
  const locationByName = useMemo(() => {
    const m = new Map<string, GalleryLocation>();
    for (const l of locations) m.set(l.name.trim().toLowerCase(), l);
    return m;
  }, [locations]);
  const locationByNameRef = useRef(locationByName);
  locationByNameRef.current = locationByName;

  // Read metadata (fast) → item becomes uploadable immediately. The GPS
  // reverse-geocode runs in the BACKGROUND and fills the location suggestion
  // when it arrives, so the Upload button is never gated on Nominatim's rate
  // limit (a 30-stop road trip would otherwise stall for ~36s). The background
  // patch never overwrites a title/location the user has already edited.
  const analyze = useCallback(
    async (id: string, file: File) => {
      let meta: ExtractedPhotoMeta | null = null;
      try {
        meta = await extractPhotoMetadata(file);
      } catch {
        meta = null; // unreadable metadata never blocks an upload
      }
      const hasGps = Boolean(meta && meta.latitude != null && meta.longitude != null);
      patchItem(id, { status: "ready", stage: "", meta, hasGps, locating: hasGps, kind: kindFor(meta, null) });

      if (!hasGps || !meta) return;
      void (async () => {
        const geo = await reverseGeocode(meta.latitude as number, meta.longitude as number);
        patchItem(id, (it) => {
          const patch: Partial<QueueItem> = { geo, locating: false, kind: kindFor(it.meta, geo) };
          if (!geo || geo.category === "Unsorted") return patch;
          // Title: only if the user hasn't edited it away from the auto value.
          if (it.title === it.titleAuto && geo.title && geo.title !== "Unsorted") {
            patch.title = geo.title;
            patch.titleAuto = geo.title;
          }
          // Location: only if the user hasn't picked one yet.
          if (!it.locationTouched && !it.locationChoice) {
            const match = locationByNameRef.current.get(geo.category.trim().toLowerCase());
            if (match) {
              patch.locationChoice = match.id;
            } else {
              patch.locationChoice = NEW_LOCATION;
              patch.newLocationName = geo.category;
              patch.newLocationRegion = geo.isHome ? "Northern Beaches" : geo.region || geo.country || "Travel";
            }
          }
          return patch;
        });
      })();
    },
    [patchItem],
  );

  const addFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || !fileList.length) return;
      const room = MAX_BATCH_FILES - itemsRef.current.length;
      if (room <= 0) {
        setMessage(`That's the limit (${MAX_BATCH_FILES} at a time). Upload these first, then add more.`);
        return;
      }
      const incoming: QueueItem[] = [];
      let skipped = false;
      for (const file of Array.from(fileList)) {
        if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|heic|heif|tiff?)$/i.test(file.name)) continue;
        if (incoming.length >= room) { skipped = true; break; }
        queueSeq += 1;
        const autoTitle = file.name.replace(/\.[^/.]+$/, "");
        incoming.push({
          id: `q${Date.now()}-${queueSeq}`,
          file,
          previewUrl: URL.createObjectURL(file),
          status: "analyzing",
          stage: "Reading",
          error: "",
          meta: null,
          geo: null,
          hasGps: false,
          locating: false,
          title: autoTitle,
          titleAuto: autoTitle,
          locationChoice: "",
          locationTouched: false,
          newLocationName: "",
          newLocationRegion: "Northern Beaches",
          kind: "Landscape",
          aspect: null,
          ratio: null,
          uploadedPath: null,
        });
      }
      if (!incoming.length) return;
      if (skipped) setMessage(`Added ${incoming.length} — capped at ${MAX_BATCH_FILES} per batch.`);
      setItems((prev) => [...prev, ...incoming]);
      // Throttle metadata reading so a big selection doesn't spike memory. The
      // background geocode inside analyze() isn't awaited here, so it doesn't
      // gate the pool — it self-paces in geocode.ts.
      let cursor = 0;
      const pump = async () => {
        while (cursor < incoming.length) {
          const it = incoming[cursor];
          cursor += 1;
          await analyze(it.id, it.file);
        }
      };
      for (let i = 0; i < Math.min(ANALYZE_CONCURRENCY, incoming.length); i += 1) void pump();
    },
    [analyze, setMessage],
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const target = prev.find((it) => it.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        // If the asset reached storage but no row was ever created (a failed
        // insert the user is now abandoning), clean up the orphan.
        if (target.uploadedPath && target.status !== "done") void removeUploadedAsset(target.uploadedPath);
      }
      return prev.filter((it) => it.id !== id);
    });
  }, []);

  const clearDone = useCallback(() => {
    setItems((prev) => {
      prev.filter((it) => it.status === "done").forEach((it) => URL.revokeObjectURL(it.previewUrl));
      return prev.filter((it) => it.status !== "done");
    });
  }, []);

  // One photo, end-to-end: compress → upload asset → insert row → warm CDN.
  // Idempotent on retry: if the asset already uploaded (item.uploadedPath), we
  // reuse it instead of re-compressing and minting a duplicate storage object —
  // so retrying a failed ROW insert costs no bandwidth and leaves no orphans.
  const uploadItem = useCallback(
    async (item: QueueItem, locationIdByName: Map<string, string>) => {
      patchItem(item.id, { status: "uploading", stage: "Compressing", error: "" });

      let storagePath = item.uploadedPath;
      let aspect = item.aspect;
      let ratio = item.ratio;
      if (!storagePath || aspect == null) {
        let compressed;
        try {
          compressed = await compressToWebp(item.file);
        } catch {
          const heic = /image\/(heic|heif)/i.test(item.file.type) || /\.(heic|heif)$/i.test(item.file.name);
          throw new Error(
            heic
              ? "Couldn't convert this HEIC photo. On iPhone: Settings → Camera → Formats → 'Most Compatible' shoots JPEG."
              : "Couldn't process this image. Try a JPEG.",
          );
        }
        aspect = compressed.aspect;
        ratio = compressed.ratio;
        patchItem(item.id, { stage: "Uploading", aspect, ratio });
        storagePath = await retryAsync(() => uploadPhotoAsset(compressed.blob, item.file.name));
        // Remember the path the moment storage succeeds, so a later row-insert
        // failure + retry reuses it.
        patchItem(item.id, { uploadedPath: storagePath });
      }

      let locationId: string | null = null;
      if (item.locationChoice === NEW_LOCATION) {
        locationId = locationIdByName.get(item.newLocationName.trim().toLowerCase()) ?? null;
      } else if (item.locationChoice) {
        locationId = item.locationChoice;
      }

      patchItem(item.id, { stage: "Saving" });
      await retryAsync(() =>
        createPhotoRecord({
          title: item.title.trim() || item.file.name.replace(/\.[^/.]+$/, ""),
          locationId: locationId ?? undefined,
          kind: item.kind,
          year: item.meta?.year ?? undefined,
          aspect: aspect ?? "landscape",
          ratio,
          capturedAt: item.meta?.capturedAt ?? null,
          latitude: item.meta?.latitude ?? null,
          longitude: item.meta?.longitude ?? null,
          relativeAltitude: item.meta?.relativeAltitude ?? null,
          storagePath,
          sourcePath: item.file.name, // record the original filename for the source link
          isFeatured: false,
          // No-location photos stay drafts (Unsorted is hidden from the public
          // gallery, so "published with no location" would be invisible).
          isPublished: published && locationId != null,
        }),
      );

      // Warm the grid's transform variants so first viewers hit a warm CDN.
      for (const width of SRCSET_WIDTHS) {
        const url = getTransformedPublicUrl(photoBucket, storagePath, width, width >= 1800 ? 76 : 72);
        if (url) fetch(url).catch(() => { /* warming only */ });
      }
      patchItem(item.id, { status: "done", stage: "", error: "" });
    },
    [patchItem, published],
  );

  const runUpload = useCallback(
    async (targetItems: QueueItem[]) => {
      if (!targetItems.length) return;
      setIsUploading(true);
      try {
        // 1) Resolve every NEW location name to an id, once each (deduped).
        const newSpecs = new Map<string, { name: string; region: string }>();
        for (const it of targetItems) {
          if (it.locationChoice === NEW_LOCATION) {
            const name = it.newLocationName.trim();
            if (name) newSpecs.set(name.toLowerCase(), { name, region: it.newLocationRegion });
          }
        }
        const locationIdByName = new Map<string, string>();
        for (const [key, spec] of newSpecs) {
          try {
            locationIdByName.set(key, await ensureLocation(spec.name, spec.region));
          } catch (error) {
            const msg = error instanceof Error ? error.message : "Could not create location.";
            targetItems
              .filter((it) => it.locationChoice === NEW_LOCATION && it.newLocationName.trim().toLowerCase() === key)
              .forEach((it) => patchItem(it.id, { status: "error", stage: "", error: msg }));
          }
        }

        // 2) Upload with a small concurrency pool (phone-friendly).
        const queue = targetItems.filter(
          (it) => !(it.locationChoice === NEW_LOCATION && !locationIdByName.has(it.newLocationName.trim().toLowerCase())),
        );
        let cursor = 0;
        let ok = 0;
        let failed = targetItems.length - queue.length; // items dropped by a location-create failure
        const worker = async () => {
          while (cursor < queue.length) {
            const item = queue[cursor];
            cursor += 1;
            try {
              await uploadItem(item, locationIdByName);
              ok += 1;
            } catch (error) {
              failed += 1;
              patchItem(item.id, { status: "error", stage: "", error: error instanceof Error ? error.message : "Upload failed." });
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, worker));

        setMessage(`Uploaded ${ok} photo${ok === 1 ? "" : "s"}${failed ? `, ${failed} failed — tap Retry` : ""}.`);
        await onUploaded();
      } finally {
        setIsUploading(false);
      }
    },
    [onUploaded, patchItem, setMessage, uploadItem],
  );

  const uploadAll = useCallback(() => {
    void runUpload(itemsRef.current.filter((it) => it.status === "ready" || it.status === "error"));
  }, [runUpload]);

  const retryFailed = useCallback(() => {
    void runUpload(itemsRef.current.filter((it) => it.status === "error"));
  }, [runUpload]);

  const analyzing = items.some((it) => it.status === "analyzing");
  const pending = items.filter((it) => it.status === "ready" || it.status === "error").length;
  const failedCount = items.filter((it) => it.status === "error").length;
  const doneCount = items.filter((it) => it.status === "done").length;

  return (
    <div className="batch-upload">
      <div className="batch-head">
        <div className="batch-head-text">
          <h2>Add photos</h2>
          <p>
            Pick one or many. Each photo's GPS, drone height, date &amp; shape are read automatically and the location is
            suggested from GPS — edit the title or location below before uploading.
          </p>
        </div>
        <label className="solid-button batch-add">
          <Plus size={15} aria-hidden="true" /> Choose photos
          <input
            accept="image/*"
            multiple
            type="file"
            hidden
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
          />
        </label>
      </div>

      {items.length > 0 && (
        <>
          <div className="batch-controls">
            <label className="batch-publish">
              <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
              Publish on upload <span>(no-location photos stay drafts)</span>
            </label>
            <div className="batch-actions">
              {doneCount > 0 && (
                <button className="text-button" type="button" onClick={clearDone} disabled={isUploading}>
                  Clear {doneCount} done
                </button>
              )}
              {failedCount > 0 && !isUploading && (
                <button className="text-button" type="button" onClick={retryFailed}>
                  <RotateCw size={15} aria-hidden="true" /> Retry {failedCount}
                </button>
              )}
              <button
                className="solid-button"
                type="button"
                onClick={uploadAll}
                disabled={isUploading || analyzing || pending === 0}
              >
                <Upload size={15} aria-hidden="true" />{" "}
                {isUploading ? "Uploading…" : analyzing ? "Reading…" : `Upload ${pending}`}
              </button>
            </div>
          </div>

          <ul className="batch-list">
            {items.map((it) => (
              <BatchRow key={it.id} item={it} locations={locations} disabled={isUploading} onChange={patchItem} onRemove={removeItem} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function BatchRow({
  item,
  locations,
  disabled,
  onChange,
  onRemove,
}: {
  item: QueueItem;
  locations: GalleryLocation[];
  disabled: boolean;
  onChange: (id: string, patch: Partial<QueueItem>) => void;
  onRemove: (id: string) => void;
}) {
  const badges: string[] = [];
  if (item.status !== "analyzing") {
    badges.push(item.hasGps ? "GPS" : "No GPS");
    if (item.meta?.relativeAltitude != null) badges.push(`${Math.round(item.meta.relativeAltitude)}m`);
    if (item.meta?.capturedAt) badges.push(item.meta.capturedAt);
    badges.push(item.kind);
  }
  // Don't nag about a missing location while the background geocode might still
  // fill it in.
  const needsLocation = item.status !== "analyzing" && !item.locationChoice && !item.locating;
  const locked = disabled || item.status === "uploading" || item.status === "done";

  return (
    <li className={`batch-row status-${item.status}`}>
      <div className="batch-thumb">
        <img src={item.previewUrl} alt="" loading="lazy" />
        {(item.status === "analyzing" || item.status === "uploading") && (
          <span className="batch-spinner"><LoaderCircle size={18} aria-hidden="true" /></span>
        )}
        {item.status === "done" && <span className="batch-tick"><Check size={16} aria-hidden="true" /></span>}
      </div>

      <div className="batch-fields">
        <div className="batch-row-top">
          <span className="batch-filename" title={item.file.name}>{item.file.name}</span>
          {item.status !== "uploading" && item.status !== "done" && (
            <button className="batch-remove" type="button" onClick={() => onRemove(item.id)} disabled={disabled} aria-label="Remove">
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>

        {item.status === "analyzing" ? (
          <p className="batch-note">Reading metadata…</p>
        ) : (
          <>
            <label className="batch-field">
              <span>Title</span>
              <input
                type="text"
                value={item.title}
                disabled={locked}
                placeholder="Title"
                onChange={(e) => onChange(item.id, { title: e.target.value })}
              />
            </label>

            <label className={`batch-field${needsLocation ? " needs" : ""}`}>
              <span>{item.locating ? "Location · finding from GPS…" : needsLocation ? "Location — set one to publish" : "Location"}</span>
              <select
                value={item.locationChoice}
                disabled={locked}
                onChange={(e) => onChange(item.id, { locationChoice: e.target.value, locationTouched: true })}
              >
                <option value="">Unsorted (stays a draft)</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
                <option value={NEW_LOCATION}>＋ New location…</option>
              </select>
            </label>

            {item.locationChoice === NEW_LOCATION && (
              <label className="batch-field">
                <span>New location name</span>
                <input
                  type="text"
                  value={item.newLocationName}
                  disabled={locked}
                  placeholder="e.g. Positano"
                  onChange={(e) => onChange(item.id, { newLocationName: e.target.value })}
                />
              </label>
            )}

            {badges.length > 0 && (
              <div className="batch-badges">
                {badges.map((b) => (
                  <span key={b} className="batch-badge">{b}</span>
                ))}
              </div>
            )}

            {item.status === "uploading" && <p className="batch-note">{item.stage}…</p>}
            {item.status === "done" && <p className="batch-note done">Uploaded</p>}
            {item.status === "error" && (
              <p className="batch-note error"><TriangleAlert size={13} aria-hidden="true" /> {item.error || "Failed"}</p>
            )}
          </>
        )}
      </div>
    </li>
  );
}

function AboutOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="about-overlay" role="dialog" aria-modal="true" aria-label="About Sam Duckworth">
      <button className="about-backdrop" onClick={onClose} type="button" aria-label="Close" />
      <section className="about-panel">
        <button className="icon-button close-button" onClick={onClose} type="button" aria-label="Close">
          <X size={18} aria-hidden="true" />
        </button>
        <div className="about-portrait">
          <img src="/about-sam.webp" alt="Sam Duckworth" loading="lazy" decoding="async" />
        </div>
        <div className="about-copy">
          <p className="eyebrow">About Me</p>
          <h2>Sam Duckworth</h2>
          <p>
            Photographer and videographer, born in Manly and based on Sydney's
            Northern Beaches.
          </p>
          <p>
            With ten years of experience, I have a passion for aerial and
            landscape photography.
          </p>
        </div>
      </section>
    </div>
  );
}

// Where enquiry emails go (the contact popup composes a message to this inbox).
const CONTACT_EMAIL = "samduckworthphoto@gmail.com";

// Small "let's work together" prompt beneath the home print-shop banner.
function ContactPrompt({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="contact-prompt scroll-reveal" aria-label="Contact">
      <p className="eyebrow">Get in touch</p>
      <h2>Let&rsquo;s work together.</h2>
      <p className="contact-lead">Commissions, prints &amp; licensing enquiries — say hello.</p>
      <button className="solid-button" type="button" onClick={onOpen}>Contact me</button>
    </section>
  );
}

// Simple contact popup. The form composes an email via the visitor's mail app
// (no backend); a real in-page send (Formspree/Resend) can come later.
function ContactOverlay({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const subject = encodeURIComponent(`Website enquiry${name ? ` from ${name}` : ""}`);
    const body = encodeURIComponent(`${message}\n\n— ${name || ""}${email ? `\n${email}` : ""}`);
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
  }

  return (
    <div className="contact-overlay" role="dialog" aria-modal="true" aria-label="Contact Sam Duckworth">
      <button className="lightbox-backdrop" onClick={onClose} type="button" aria-label="Close" />
      <section className="contact-panel">
        <button className="icon-button close-button" onClick={onClose} type="button" aria-label="Close">
          <X size={18} aria-hidden="true" />
        </button>
        <p className="eyebrow">Get in touch</p>
        <h2>Let&rsquo;s work together.</h2>
        <p className="contact-lead">Commissions, prints &amp; licensing — drop a note and I&rsquo;ll get back to you.</p>
        <form className="contact-form" onSubmit={submit}>
          <label>Name
            <input value={name} onChange={(e) => setName(e.target.value)} type="text" autoComplete="name" placeholder="Your name" />
          </label>
          <label>Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="you@example.com" />
          </label>
          <label>Message
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder="What can I help with?" required />
          </label>
          <button className="solid-button" type="submit">Send message</button>
        </form>
        <p className="contact-alt">
          or email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          {" · "}
          <a href="https://instagram.com/sam.duckworth" target="_blank" rel="noopener noreferrer">@sam.duckworth</a>
        </p>
      </section>
    </div>
  );
}

// Shown for any unknown path (the router falls through to here).
function NotFound({ onNavigate }: { onNavigate: (route: string) => void }) {
  useSeo("Page not found — Sam Duckworth Photography", { path: "/404" });
  function goHome() { window.history.pushState({}, "", "/"); onNavigate("/"); }
  return (
    <main className="error-screen">
      <Header isScrolled onNavigate={onNavigate} />
      <div className="error-body">
        <p className="eyebrow">404</p>
        <h1>Page not found.</h1>
        <p>That page doesn&rsquo;t exist or has moved.</p>
        <button className="solid-button" type="button" onClick={goHome}>Back to gallery</button>
      </div>
    </main>
  );
}

function Footer() {
  return (
    <footer>
      <span>SD Gallery</span>
      <a className="footer-ig" href="https://instagram.com/sam.duckworth" target="_blank" rel="noopener noreferrer" aria-label="Instagram: sam.duckworth">
        <Instagram size={15} aria-hidden="true" /> sam.duckworth
      </a>
      <span>Photography by Sam Duckworth</span>
    </footer>
  );
}

export default App;
