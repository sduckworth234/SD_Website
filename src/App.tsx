import type { Session } from "@supabase/supabase-js";
import {
  ArrowUpFromLine,
  ArrowUpToLine,
  Check,
  Copy,
  Crosshair,
  Eye,
  EyeOff,
  Globe,
  Images,
  Instagram,
  LayoutDashboard,
  LayoutGrid,
  Lock,
  LogOut,
  MapPin,
  Pencil,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import type { CSSProperties, DependencyList, ReactNode } from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  assignRecentSlot,
  bulkEditPhotos,
  createLocation,
  createPhotoRecord,
  deletePhoto,
  getAdminPhotos,
  getGalleryData,
  getRecentPhotos,
  getSiteSettings,
  getTransformedPublicUrl,
  hasSupabaseEnv,
  photoBucket,
  isCurrentUserAdmin,
  sendPhotoToTop,
  setCollectionPicks,
  setLocationFeedOrder,
  setMapFeature,
  setPhotoShop,
  setSiteFlag,
  setSiteSetting,
  supabase,
  updatePhotoDetails,
  updatePhotoCuration,
  updatePhotoVisibility,
  uploadPhotoAsset,
} from "./lib/supabase";
import type { GalleryLocation, LocationBucket, Photo, SiteSetting } from "./types";
import { useSeo } from "./lib/seo";
import { Header } from "./components/Header";
import { OakFrame } from "./components/OakFrame";
import { SmartImage } from "./components/SmartImage";

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

// A right-sized image variant (the gallery imageUrl is 1800px — too big for small
// collection/shop thumbnails).
function thumbUrl(photo: Photo, width: number): string {
  return photo.storagePath ? getTransformedPublicUrl(photoBucket, photo.storagePath, width) : photo.imageUrl;
}

// Responsive srcset across a range of widths so phones don't download the full
// 1800px image. Falls back to the single imageUrl when there's no storage path.
const SRCSET_WIDTHS = [400, 700, 1000, 1400, 1800];
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

    return () => observer.disconnect();
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

  if (matches("/galleries")) {
    return <GalleriesPage key={route} onNavigate={navigate} />;
  }

  if (path === "/" || path === "") {
    return <Home onNavigate={navigate} />;
  }

  return <NotFound onNavigate={navigate} />;
}

// Shared data (photos, locations, recent), admin detection, scroll state and the
// derived public/location lists — used by both the Home page and Galleries page.
function useSiteData() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [recentPhotos, setRecentPhotos] = useState<Photo[]>([]);
  const [locations, setLocations] = useState<GalleryLocation[]>([]);
  const [settings, setSettings] = useState<SiteSetting[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadGallery = useCallback(async () => {
    const [data, recent, siteSettings] = await Promise.all([
      getGalleryData(),
      getRecentPhotos(9),
      getSiteSettings(),
    ]);
    setPhotos(data.photos);
    setLocations(data.locations);
    setRecentPhotos(recent);
    setSettings(siteSettings);
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

  return { photos, recentPhotos, locations, settings, flags, settingValue, publicPhotos, locationNames, isAdmin, adminChecked, isScrolled, isLoading, loadGallery };
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
  const { photos, recentPhotos, publicPhotos, locations, locationNames, flags, settingValue, isAdmin, isScrolled, isLoading, loadGallery } = useSiteData();
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null);
  const [recentSlot, setRecentSlot] = useState<number | null>(null);
  const [editingCollection, setEditingCollection] = useState<GalleryLocation | null>(null);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [heroPicking, setHeroPicking] = useState(false);

  function goToMap() { window.history.pushState({}, "", "/map"); onNavigate("/map"); }
  function goToShop() { window.history.pushState({}, "", "/shop"); onNavigate("/shop"); }
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
          {recentPhotos.length >= 5 ? (
            <AdminHideable isAdmin={isAdmin} visible={flagOn(flags, "recent_work")} label="Recent Work">
              <RecentWork
                isAdmin={isAdmin}
                onChangePhoto={setRecentSlot}
                onEditPhoto={setEditingPhoto}
                onSelect={setSelectedPhoto}
                photos={recentPhotos}
              />
            </AdminHideable>
          ) : null}
          <AdminHideable isAdmin={isAdmin} visible={flagOn(flags, "map_promo")} label="Map promo">
            <MapPromo photos={publicPhotos} locations={locations} onOpen={goToMap} />
          </AdminHideable>
          <AdminHideable isAdmin={isAdmin} visible={flagOn(flags, "collection_cards")} label="Collections">
            <CollectionCards photos={publicPhotos} locations={locations} onOpen={openLocation} isAdmin={isAdmin} onEdit={setEditingCollection} />
          </AdminHideable>
          {heroPortrait ? (
            <AdminHideable isAdmin={isAdmin} visible={flagOn(flags, "framed_banner")} label="Framed Editions banner">
              <FramedHero portrait={heroPortrait} landscape={heroLandscape} onShop={goToShop} />
            </AdminHideable>
          ) : null}
          <AdminHideable isAdmin={isAdmin} visible={flagOn(flags, "contact_prompt")} label="Contact">
            <ContactPrompt onOpen={() => setIsContactOpen(true)} />
          </AdminHideable>
        </>
      )}
      <Footer />
      {selectedPhoto ? (
        <Lightbox photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} onViewOnMap={viewPhotoOnMap} />
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
  const { publicPhotos, locations, locationNames, isAdmin, isLoading, loadGallery } = useSiteData();
  const [activeLocation, setActiveLocation] = useState<ActiveLocation>(() => readLocationParam() ?? allLocations);
  const [view, setView] = useState<GalleryView>("flow");
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null);
  const [imagesReady, setImagesReady] = useState(false);

  async function unpublishPhoto(photo: Photo) {
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
    const valid = activeLocation !== allLocations && publicPhotos.some((p) => p.location === activeLocation);
    if (!valid && locationNames.length) setActiveLocation(pickLandingLocation(locationNames));
  }, [activeLocation, publicPhotos, locationNames]);

  const filteredPhotos = useMemo(() => {
    if (activeLocation === allLocations) return publicPhotos;
    return publicPhotos.filter((p) => p.location === activeLocation);
  }, [activeLocation, publicPhotos]);

  useEffect(() => {
    if (isLoading) return;
    if (activeLocation === allLocations) {
      // Normally transient (the landing effect picks a category) — but with no
      // published photos at all there's nothing to land on, so release the
      // skeleton rather than shimmer forever.
      if (!locationNames.length) setImagesReady(true);
      return;
    }
    // Warm only the first screenful, and with the SAME srcset/sizes the grid
    // tiles use — the browser then resolves to the identical (small) variant
    // instead of pulling the full 1800px image for every photo in the category.
    const batch = filteredPhotos.filter((p) => p.imageUrl).slice(0, 12);
    if (!batch.length) { setImagesReady(true); return; }
    let cancelled = false; setImagesReady(false); let done = 0;
    const tick = () => { done += 1; if (!cancelled && done >= batch.length) setImagesReady(true); };
    const imgs = batch.map((photo) => {
      const im = new Image();
      im.onload = tick;
      im.onerror = tick;
      const srcset = srcSetFor(photo);
      if (srcset) {
        im.sizes = "(max-width: 620px) 50vw, (max-width: 1024px) 33vw, 25vw";
        im.srcset = srcset;
      }
      im.src = photo.imageUrl;
      return im;
    });
    const timer = window.setTimeout(() => { if (!cancelled) setImagesReady(true); }, 5000);
    return () => { cancelled = true; window.clearTimeout(timer); imgs.forEach((im) => { im.onload = null; im.onerror = null; }); };
  }, [filteredPhotos, isLoading, activeLocation, locationNames]);

  // Switching location should land you back at the top of the gallery, even if
  // you'd scrolled down (changing the filter isn't a route change, so the
  // navigate() scroll-reset doesn't fire here).
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeLocation]);

  const seoLoc = activeLocation === allLocations ? null : activeLocation;
  useSeo(
    seoLoc ? `${seoLoc} — Sam Duckworth Photography` : "Gallery — Sam Duckworth Photography",
    seoLoc
      ? { description: `Aerial and landscape photography from ${seoLoc}, by Sam Duckworth.`, path: `/galleries?location=${encodeURIComponent(seoLoc)}` }
      : { path: "/galleries" },
  );

  useScrollReveal([isLoading, imagesReady, activeLocation, filteredPhotos.length, view]);

  return (
    <main className="gallery-page">
      <Header isScrolled onNavigate={onNavigate} />
      <section className="gallery-page-head">
        <h1 className="gallery-page-title">{activeLocation === allLocations ? "All work" : activeLocation}</h1>
      </section>
      <LocationRail
        activeLocation={activeLocation}
        excludeUnsorted
        includeAllWork={false}
        locations={locations}
        photos={publicPhotos}
        onChange={setActiveLocation}
      />
      <GalleryControls onChange={setView} onViewOnMap={viewOnMap} view={view} />
      {isLoading || !imagesReady ? (
        <GallerySkeleton view={view} />
      ) : (
        <Gallery
          isAdmin={isAdmin}
          onEditPhoto={setEditingPhoto}
          onSelectPhoto={setSelectedPhoto}
          onSendToTop={sendToTop}
          onToggleMapFeature={toggleMapFeature}
          onUnpublish={unpublishPhoto}
          photos={filteredPhotos}
          view={view}
        />
      )}
      <Footer />
      {selectedPhoto ? (
        <Lightbox photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} onViewOnMap={viewPhotoOnMap} />
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
function CollectionCards({ photos, locations, onOpen, isAdmin = false, onEdit }: { photos: Photo[]; locations: GalleryLocation[]; onOpen: (name: string) => void; isAdmin?: boolean; onEdit?: (location: GalleryLocation) => void }) {
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
        return { name, photos: (pinned.length ? pinned : ps).slice(0, 5), loc: locByName.get(name) };
      })
      .sort((a, b) => (order.get(a.name) ?? 999) - (order.get(b.name) ?? 999) || a.name.localeCompare(b.name));
  }, [photos, locations]);

  if (!cards.length) return null;
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
function ShopProduct({ photo, onAdd }: { photo: Photo; onAdd: () => void }) {
  const [size, setSize] = useState(1);
  const orient = photo.aspect === "portrait" || photo.aspect === "square" ? "portrait" : "landscape";
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
  const [filter, setFilter] = useState("All");
  // Two independent curations: "shop" = the products for sale (in_shop), "wall" =
  // the coming-soon collection glimpse (its own ordered list in shop_preview).
  const [curating, setCurating] = useState<null | "shop" | "wall">(null);

  useSeo("Framed Editions — Sam Duckworth Photography", {
    description: "Fine-art aerial and coastal prints, framed in solid oak — by Sam Duckworth. Launching soon.",
    path: "/shop",
  });

  function goHome() { window.history.pushState({}, "", "/"); onNavigate("/"); }
  // Classify by the location's DB region (no hardcoded place list — a newly
  // created Australian location should never file under Europe).
  const regionByLocation = useMemo(() => new Map(locations.map((l) => [l.name, l.region])), [locations]);
  const region = (p: Photo) => (regionByLocation.get(p.location) === "Europe" ? "Europe" : "Australia");

  // Explicit true — so before settings load (flags empty) we default to the
  // safe "not live" preview, never a flash of the transactional shop.
  const shopLive = flags.shop_public === true;

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
        {shopLive ? <span className="shop-cart">Cart · {cart}</span> : null}
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
          <a className="solid-button" href={shopLive ? "#shop-grid" : "#shop-wall"}>{shopLive ? "Shop the collection" : "See the collection"}</a>
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
              {filtered.map((p) => <ShopProduct key={p.id} photo={p} onAdd={() => setCart((c) => c + 1)} />)}
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

function RecentWork({
  isAdmin,
  onChangePhoto,
  onEditPhoto,
  onSelect,
  photos,
}: {
  isAdmin: boolean;
  onChangePhoto: (slot: number) => void;
  onEditPhoto: (photo: Photo) => void;
  onSelect: (photo: Photo) => void;
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
            onClick={() => onSelect(photo)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(photo);
              }
            }}
            role="button"
            tabIndex={0}
            style={{ "--reveal-delay": `${index * 80}ms` } as CSSProperties}
          >
            <SmartImage
              src={photo.imageUrl}
              srcSet={srcSetFor(photo)}
              sizes="(max-width: 900px) 50vw, 33vw"
              alt={`${photo.title}, ${photo.location}`}
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

function LocationRail({
  activeLocation,
  excludeUnsorted = false,
  includeAllWork = true,
  locations,
  photos,
  onChange,
}: {
  activeLocation: ActiveLocation;
  excludeUnsorted?: boolean;
  includeAllWork?: boolean;
  locations: GalleryLocation[];
  photos: Photo[];
  onChange: (location: ActiveLocation) => void;
}) {
  const photoLocationNames = new Set(photos.map((photo) => photo.location));
  const visibleLocations: ActiveLocation[] = [
    ...(includeAllWork ? [allLocations] : []),
    ...locations
      .map((location) => location.name)
      .filter((locationName) => photoLocationNames.has(locationName)),
    ...[...photoLocationNames].filter(
      (locationName) => !locations.some((location) => location.name === locationName),
    ),
  ].filter((locationName) => !excludeUnsorted || locationName !== "Unsorted");

  return (
    <section className="location-rail" aria-label="Filter gallery by location">
      {visibleLocations.map((location) => (
        <button
          className={activeLocation === location ? "active" : ""}
          key={location}
          onClick={() => onChange(location)}
          type="button"
        >
          {location}
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
            key={fr.name}
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
  onSendToTop,
  onToggleMapFeature,
  onUnpublish,
  photos,
  view,
}: {
  isAdmin: boolean;
  onEditPhoto: (photo: Photo) => void;
  onSelectPhoto: (photo: Photo) => void;
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
          onClick={() => onSelectPhoto(photo)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelectPhoto(photo);
            }
          }}
          role="button"
          tabIndex={0}
          style={{ "--reveal-delay": `${Math.min(index, 12) * 38}ms` } as CSSProperties}
        >
          <SmartImage
            src={photo.imageUrl}
            srcSet={srcSetFor(photo)}
            sizes="(max-width: 620px) 50vw, (max-width: 1024px) 33vw, 25vw"
            alt={`${photo.title}, ${photo.location}`}
            eager
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
  onClose,
  onViewOnMap,
}: {
  photo: Photo;
  onClose: () => void;
  onViewOnMap: (photo: Photo) => void;
}) {
  // Measured width/height ratio of the loaded image. We start from the stored
  // aspect (no layout flash) and correct to the true ratio once it loads — so
  // even a mis-tagged image lands in the right layout.
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => { setRatio(null); }, [photo.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const hasCoords = photo.latitude != null && photo.longitude != null;
  const guessPortrait = photo.aspect === "portrait" || photo.aspect === "square";
  // Taller-than-wide → portrait card (image beside the caption); otherwise the
  // classic landscape card (image above the caption).
  const isPortrait = ratio != null ? ratio < 1 : guessPortrait;

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={photo.title}>
      <button className="lightbox-backdrop" onClick={onClose} type="button" aria-label="Close" />
      <section className={`lightbox-panel${isPortrait ? " is-portrait" : ""}`}>
        <button className="icon-button close-button" onClick={onClose} type="button" aria-label="Close">
          <X size={18} aria-hidden="true" />
        </button>
        <div className="lightbox-image">
          <SmartImage
            src={photo.imageUrl}
            srcSet={srcSetFor(photo)}
            sizes="(max-width: 920px) 92vw, 60vw"
            alt={`${photo.title}, ${photo.location}`}
            onMeasure={setRatio}
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
          {hasCoords ? (
            <button className="map-link-button" onClick={() => onViewOnMap(photo)} type="button">
              <Globe size={14} aria-hidden="true" />
              View on map
            </button>
          ) : null}
        </aside>
      </section>
    </div>
  );
}

// The public visibility flags the admin can toggle. Labels live here (not just
// the DB) so the panel reads well even if a seed row is missing.
const VISIBILITY_FLAGS: { key: string; label: string; hint: string }[] = [
  { key: "recent_work", label: "Home — Recent Work mosaic", hint: "The editorial photo mosaic near the top of the home page." },
  { key: "map_promo", label: "Home — Map promo", hint: "The interactive-map teaser on the home page." },
  { key: "collection_cards", label: "Home — Collection cards", hint: "The cycling location tiles on the home page." },
  { key: "framed_banner", label: "Home — Framed Editions banner", hint: "The print-shop banner near the bottom of the home page." },
  { key: "contact_prompt", label: "Home — Contact / Work with me", hint: "The “Let’s work together” prompt + contact popup." },
  { key: "shop_public", label: "Shop page — public", hint: "Open /shop to the public (otherwise it shows “Opening soon”)." },
];

// Admin panel: flip what the public can see, and choose the two photos shown in
// the home Framed Editions banner. Reads/writes public.site_settings.
function VisibilityAdmin({ photos }: { photos: Photo[] }) {
  const [settings, setSettings] = useState<SiteSetting[]>([]);
  const [bannerSlot, setBannerSlot] = useState<null | "portrait" | "landscape">(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setSettings(await getSiteSettings());
  }, []);
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

  return (
    <section className="admin-visibility" aria-label="Visibility and banner">
      <div className="admin-sec-head"><Eye size={16} aria-hidden="true" /><h2>Visibility</h2></div>
      <p className="admin-sec-hint">Choose what the public sees. You always see everything while signed in.</p>
      <div className="vis-flags">
        {VISIBILITY_FLAGS.map((f) => {
          const on = flags[f.key] !== false;
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

  async function refresh() {
    const [galleryData, nextAdminPhotos] = await Promise.all([
      getGalleryData(),
      getAdminPhotos(),
    ]);
    setLocations(galleryData.locations);
    setAdminPhotos(nextAdminPhotos);
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
    try {
      await updatePhotoCuration(ids, input);
      setSelectedPhotoIds(new Set());
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update photos.");
    }
  }

  function selectAllFiltered() {
    setSelectedPhotoIds(new Set(visiblePhotos.map((photo) => photo.id)));
  }

  async function bulkRename() {
    const ids = [...selectedPhotoIds];
    if (!ids.length || !bulkTitle.trim()) return;
    try {
      await bulkEditPhotos(ids, { title: bulkTitle.trim() });
      setBulkTitle("");
      setSelectedPhotoIds(new Set());
      setMessage(`Renamed ${ids.length} photo${ids.length === 1 ? "" : "s"}.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not rename photos.");
    }
  }

  async function bulkSetLocation() {
    const ids = [...selectedPhotoIds];
    if (!ids.length) return;
    const locationName = locations.find((l) => l.id === bulkLocationId)?.name ?? "Unsorted";
    try {
      // Move only — titles are curated individually and must survive a re-bucket.
      await bulkEditPhotos(ids, { locationId: bulkLocationId || null });
      setBulkLocationId("");
      setSelectedPhotoIds(new Set());
      setMessage(`Moved ${ids.length} photo${ids.length === 1 ? "" : "s"} to ${locationName}.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not move photos.");
    }
  }

  async function removePhoto(photo: Photo) {
    if (
      !window.confirm(
        `Delete "${photo.title}" permanently? This removes the photo and its image file.`,
      )
    ) {
      return;
    }
    try {
      await deletePhoto(photo.id, photo.storagePath);
      setSelectedPhotoIds((current) => {
        const next = new Set(current);
        next.delete(photo.id);
        return next;
      });
      setMessage(`Deleted "${photo.title}".`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete photo.");
    }
  }

  async function addLocation() {
    const name = newLocationName.trim();
    if (!name) return;
    try {
      await createLocation(name);
      setNewLocationName("");
      setMessage(`Added location "${name}".`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add location.");
    }
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
      {message ? <p className="form-note">{message}</p> : null}
      <MapFeedAdmin photos={adminPhotos} locations={locations} onChanged={refresh} />
      <VisibilityAdmin photos={adminPhotos} />
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
        <button className="solid-button" onClick={() => bulkUpdate({ published: true })} type="button">
          Publish
        </button>
        <button className="text-button" onClick={() => bulkUpdate({ published: false })} type="button">
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
          <button className="text-button" onClick={bulkRename} type="button">
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
          <button className="text-button" onClick={bulkSetLocation} type="button">
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
          <button className="text-button" onClick={addLocation} type="button">
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
                  <button className="text-button danger" onClick={() => removePhoto(photo)} type="button">
                    <Trash2 size={13} aria-hidden="true" /> Delete
                  </button>
                </div>
                <label>
                  <input
                    checked={Boolean(photo.published)}
                    onChange={(event) =>
                      updatePhotoVisibility(photo.id, {
                        featured: Boolean(photo.featured),
                        published: event.target.checked,
                      })
                        .then(refresh)
                        .catch((error) =>
                          setMessage(error instanceof Error ? error.message : "Could not update the photo."),
                        )
                    }
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
                name="altitude"
                placeholder="—"
                step="0.1"
                type="number"
              />
            </label>
            <label>
              Sort order
              <input defaultValue={photo.sortOrder ?? ""} name="sortOrder" placeholder="—" type="number" />
            </label>
            <label>
              Latitude
              <input defaultValue={photo.latitude ?? ""} name="latitude" placeholder="—" step="any" type="number" />
            </label>
            <label>
              Longitude
              <input defaultValue={photo.longitude ?? ""} name="longitude" placeholder="—" step="any" type="number" />
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

function UploadPanel({
  locations,
  onUploaded,
  setMessage,
}: {
  locations: GalleryLocation[];
  onUploaded: () => Promise<void>;
  setMessage: (message: string) => void;
}) {
  const [isUploading, setIsUploading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");

    if (!(file instanceof File) || !file.size) {
      setMessage("Choose a photo first.");
      return;
    }

    setIsUploading(true);
    try {
      const storagePath = await uploadPhotoAsset(file);
      await createPhotoRecord({
        title: String(formData.get("title") || file.name.replace(/\.[^/.]+$/, "")),
        description: String(formData.get("description") || ""),
        locationId: String(formData.get("locationId") || ""),
        kind: "Drone",
        year: Number(formData.get("year")) || undefined,
        aspect: String(formData.get("aspect") || "landscape") as Photo["aspect"],
        storagePath,
        sourcePath: file.name, // record the original filename for the source link
        isFeatured: formData.get("isFeatured") === "on",
        isPublished: formData.get("isPublished") === "on",
      });
      form.reset();
      setMessage("Photo uploaded and saved.");
      await onUploaded();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <form className="upload-panel" onSubmit={submit}>
      <label>
        Photo
        <input accept="image/*" name="file" required type="file" />
      </label>
      <label>
        Title
        <input name="title" placeholder="Barrenjoey after rain" type="text" />
      </label>
      <label>
        Description
        <textarea name="description" placeholder="Short caption or field note" rows={3} />
      </label>
      <label>
        Location
        <select name="locationId">
          <option value="">Unsorted</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Year
        <input name="year" placeholder="2026" type="number" />
      </label>
      <label>
        Aspect
        <select name="aspect" defaultValue="landscape">
          <option>landscape</option>
          <option>portrait</option>
          <option>square</option>
          <option>wide</option>
        </select>
      </label>
      <div className="check-row">
        <label>
          <input name="isPublished" type="checkbox" /> Published
        </label>
        <label>
          <input name="isFeatured" type="checkbox" /> Featured
        </label>
      </div>
      <button className="solid-button" disabled={isUploading} type="submit">
        <Upload size={15} aria-hidden="true" /> {isUploading ? "Uploading" : "Upload photo"}
      </button>
    </form>
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
