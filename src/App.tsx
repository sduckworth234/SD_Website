import type { Session } from "@supabase/supabase-js";
import {
  ArrowUpFromLine,
  ArrowUpToLine,
  Camera,
  Check,
  Crosshair,
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
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import type { CSSProperties, DependencyList } from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  assignRecentSlot,
  bulkEditPhotos,
  createLocation,
  createPhotoRecord,
  deletePhoto,
  getAdminPhotos,
  getGalleryData,
  getRecentPhotos,
  getTransformedPublicUrl,
  hasSupabaseEnv,
  photoBucket,
  isCurrentUserAdmin,
  sendPhotoToTop,
  setLocationFeedOrder,
  setMapFeature,
  supabase,
  updatePhotoDetails,
  updatePhotoCuration,
  updatePhotoVisibility,
  uploadPhotoAsset,
} from "./lib/supabase";
import type { GalleryLocation, LocationBucket, Photo } from "./types";
import { Header } from "./components/Header";
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
  const [route, setRoute] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setRoute(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  if (route.startsWith("/admin")) {
    return <AdminApp onNavigate={setRoute} />;
  }

  if (route.startsWith("/map")) {
    return (
      <Suspense fallback={<div className="map-shell map-loading" aria-label="Loading map" />}>
        <MapPage onNavigate={setRoute} />
      </Suspense>
    );
  }

  return <PublicGallery onNavigate={setRoute} />;
}

function PublicGallery({ onNavigate }: { onNavigate: (route: string) => void }) {
  const [activeLocation, setActiveLocation] =
    useState<ActiveLocation>(() => readLocationParam() ?? allLocations);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [recentPhotos, setRecentPhotos] = useState<Photo[]>([]);
  const [locations, setLocations] = useState<GalleryLocation[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null);
  const [recentSlot, setRecentSlot] = useState<number | null>(null);
  const [view, setView] = useState<GalleryView>("flow");
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [imagesReady, setImagesReady] = useState(false);

  const loadGallery = useCallback(async () => {
    const [data, recent] = await Promise.all([getGalleryData(), getRecentPhotos(5)]);
    setPhotos(data.photos);
    setLocations(data.locations);
    setRecentPhotos(recent);
  }, []);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    loadGallery().finally(() => setIsLoading(false));
  }, [loadGallery]);

  // Detect an admin session so the live gallery becomes editable in place.
  useEffect(() => {
    const sb = supabase;
    if (!sb) {
      setAdminChecked(true);
      return;
    }
    let active = true;
    const check = async () => {
      const { data } = await sb.auth.getSession();
      if (!data.session) {
        if (active) {
          setIsAdmin(false);
          setAdminChecked(true);
        }
        return;
      }
      const ok = await isCurrentUserAdmin();
      if (active) {
        setIsAdmin(ok);
        setAdminChecked(true);
      }
    };
    check();
    const { data } = sb.auth.onAuthStateChange(() => check());
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  async function unpublishPhoto(photo: Photo) {
    await updatePhotoVisibility(photo.id, {
      featured: Boolean(photo.featured),
      published: false,
    });
    await loadGallery();
  }

  // Admin "send to top": promote a favourite to the front of its category.
  async function sendToTop(photo: Photo) {
    await sendPhotoToTop(photo.id);
    await loadGallery();
  }

  // Admin: pick/unpick this photo as its location's drone-feed feature.
  async function toggleMapFeature(photo: Photo) {
    await setMapFeature(photo.id, !photo.mapFeature);
    await loadGallery();
  }

  // Open the map, framed on the current category when one is selected.
  function viewOnMap() {
    const query =
      activeLocation !== allLocations ? `?focus=${encodeURIComponent(activeLocation)}` : "";
    window.history.pushState({}, "", `/map${query}`);
    onNavigate("/map");
  }

  // Open the full map (no category focus) — used by the promo strip.
  function goToMap() {
    window.history.pushState({}, "", "/map");
    onNavigate("/map");
  }

  // Unsorted photos are kept out of the public gallery entirely (admin still
  // sees them in the dashboard to sort/fix).
  const publicPhotos = useMemo(
    () => photos.filter((photo) => photo.location !== "Unsorted"),
    [photos],
  );

  // Real shoot locations (in curated order) that actually have public photos.
  // Used both for the hero ticker and as the set of selectable categories.
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

  // There's no "All work" view — the gallery always shows one category. On load
  // (or if the active category vanished) land on a pseudo-random one.
  useEffect(() => {
    const valid =
      activeLocation !== allLocations &&
      publicPhotos.some((photo) => photo.location === activeLocation);
    if (!valid && locationNames.length) {
      setActiveLocation(pickLandingLocation(locationNames));
    }
  }, [activeLocation, publicPhotos, locationNames]);

  const filteredPhotos = useMemo(() => {
    if (activeLocation === allLocations) return publicPhotos;
    return publicPhotos.filter((photo) => photo.location === activeLocation);
  }, [activeLocation, publicPhotos]);

  // Preload the active category's images and hold the skeleton until they're
  // decoded, so the masonry lays out with known heights — no reflow/"shove" as
  // images pop in. A timeout reveals anyway so a slow image can't stall the grid.
  useEffect(() => {
    // Skip the brief "all work" moment before a category is chosen, so we don't
    // preload the entire library.
    if (isLoading || activeLocation === allLocations) return;
    const urls = filteredPhotos.map((p) => p.imageUrl).filter(Boolean);
    if (!urls.length) { setImagesReady(true); return; }
    let cancelled = false;
    setImagesReady(false);
    let done = 0;
    const tick = () => {
      done += 1;
      if (!cancelled && done >= urls.length) setImagesReady(true);
    };
    const imgs = urls.map((url) => {
      const im = new Image();
      im.onload = tick;
      im.onerror = tick;
      im.src = url;
      return im;
    });
    const timer = window.setTimeout(() => { if (!cancelled) setImagesReady(true); }, 5000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      imgs.forEach((im) => { im.onload = null; im.onerror = null; });
    };
  }, [filteredPhotos, isLoading, activeLocation]);

  useScrollReveal([isLoading, imagesReady, activeLocation, filteredPhotos.length, view, recentPhotos.length]);

  return (
    <main>
      <Header
        isScrolled={isScrolled}
        onNavigate={onNavigate}
        onOpenAbout={() => setIsAboutOpen(true)}
      />
      <Hero locations={locationNames} />
      <div id="galleries" className="section-anchor" aria-hidden="true" />
      {isLoading ? (
        <>
          <RecentWorkSkeleton />
          <LocationRailSkeleton />
          <GalleryControls onChange={setView} view={view} />
          <GallerySkeleton view={view} />
        </>
      ) : (
        <>
          {recentPhotos.length >= 5 ? (
            <RecentWork
              isAdmin={isAdmin}
              onChangePhoto={setRecentSlot}
              onEditPhoto={setEditingPhoto}
              onSelect={setSelectedPhoto}
              photos={recentPhotos}
            />
          ) : null}
          <MapPromo photos={publicPhotos} locations={locations} onOpen={goToMap} />
          <LocationRail
            activeLocation={activeLocation}
            excludeUnsorted
            includeAllWork={false}
            locations={locations}
            photos={publicPhotos}
            onChange={setActiveLocation}
          />
          <GalleryControls onChange={setView} onViewOnMap={viewOnMap} view={view} />
          {imagesReady ? (
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
          ) : (
            <GallerySkeleton view={view} />
          )}
        </>
      )}
      <Footer />
      {selectedPhoto ? (
        <Lightbox photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} />
      ) : null}
      {editingPhoto ? (
        <PhotoEditOverlay
          locations={locations}
          onClose={() => setEditingPhoto(null)}
          onSaved={loadGallery}
          photo={editingPhoto}
        />
      ) : null}
      {isAboutOpen ? <AboutOverlay onClose={() => setIsAboutOpen(false)} /> : null}
      {recentSlot !== null ? (
        <RecentPicker
          onClose={() => setRecentSlot(null)}
          onPick={async (photo) => {
            await assignRecentSlot(recentSlot, photo.id);
            await loadGallery();
            setRecentSlot(null);
          }}
          photos={photos}
        />
      ) : null}
      <InstagramRail />
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
  const tiles = photos.slice(0, 5);

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
            <SmartImage src={photo.imageUrl} alt={`${photo.title}, ${photo.location}`} />
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
}: {
  onClose: () => void;
  onPick: (photo: Photo) => void;
  photos: Photo[];
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Choose a photo for Recent Work">
      <button className="lightbox-backdrop" onClick={onClose} type="button" aria-label="Close" />
      <section className="picker-panel">
        <button className="icon-button close-button" onClick={onClose} type="button" aria-label="Close">
          <X size={18} aria-hidden="true" />
        </button>
        <p className="eyebrow">Choose a photo for Recent Work</p>
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

function Hero({ locations }: { locations: string[] }) {
  return (
    <section className="hero landing-stage" id="top" aria-label="Sam Duckworth Photography">
      <div className="landing-copy scroll-reveal is-visible">
        <p className="eyebrow">My Photography Gallery</p>
        <h1>Sam Duckworth Photography.</h1>
        <RotatingLocations locations={locations} />
      </div>
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

// A slowly rotating, gently pulsing line of the locations the photos come from.
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

  const f = frames[active];
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

  // The feed card is 16:10. Measure each photo's true ratio (via SmartImage) and
  // flag whether it fits the card (no crop) or will be cropped.
  const CARD_RATIO = 16 / 10;
  const measure = (id: string, ratio: number) =>
    setRatios((prev) => (prev[id] ? prev : { ...prev, [id]: ratio }));
  const fitOf = (p: Photo): "fit" | "crop" | null => {
    const r = ratios[p.id];
    if (r == null) return null; // not measured yet
    return Math.abs(r - CARD_RATIO) <= 0.1 ? "fit" : "crop";
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
        <span className="map-feed-warn" title={`Will be cropped — ${ratios[p.id].toFixed(2)}:1 vs 1.60`}>
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
        {Array.from({ length: 5 }, (_, index) => (
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
          <SmartImage src={photo.imageUrl} alt={`${photo.title}, ${photo.location}`} eager />
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

function Lightbox({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={photo.title}>
      <button className="lightbox-backdrop" onClick={onClose} type="button" aria-label="Close" />
      <section className="lightbox-panel">
        <button className="icon-button close-button" onClick={onClose} type="button" aria-label="Close">
          <X size={18} aria-hidden="true" />
        </button>
        <div className="lightbox-image">
          <SmartImage src={photo.imageUrl} alt={`${photo.title}, ${photo.location}`} />
          <AltitudeBadge photo={photo} />
        </div>
        <aside className="lightbox-copy">
          <span className="lightbox-location">
            <MapPin size={13} aria-hidden="true" />
            {photo.location}
          </span>
          <h2>{photo.title}</h2>
          {photo.year ? <small>{photo.year}</small> : null}
        </aside>
      </section>
    </div>
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
    await updatePhotoCuration(ids, input);
    setSelectedPhotoIds(new Set());
    await refresh();
  }

  function selectAllFiltered() {
    setSelectedPhotoIds(new Set(filteredPhotos.map((photo) => photo.id)));
  }

  async function bulkRename() {
    const ids = [...selectedPhotoIds];
    if (!ids.length || !bulkTitle.trim()) return;
    await bulkEditPhotos(ids, { title: bulkTitle.trim() });
    setBulkTitle("");
    setSelectedPhotoIds(new Set());
    setMessage(`Renamed ${ids.length} photo${ids.length === 1 ? "" : "s"}.`);
    await refresh();
  }

  async function bulkSetLocation() {
    const ids = [...selectedPhotoIds];
    if (!ids.length) return;
    const locationName = locations.find((l) => l.id === bulkLocationId)?.name ?? "Unsorted";
    await bulkEditPhotos(ids, { locationId: bulkLocationId || null, title: locationName });
    setBulkLocationId("");
    setSelectedPhotoIds(new Set());
    setMessage(`Moved ${ids.length} photo${ids.length === 1 ? "" : "s"} to ${locationName}.`);
    await refresh();
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

  async function savePhotoDetails(photoId: string, formData: FormData) {
    try {
      await updatePhotoDetails(photoId, {
        title: String(formData.get("title") || ""),
        description: String(formData.get("description") || ""),
        locationId: String(formData.get("locationId") || ""),
        year: Number(formData.get("year")) || undefined,
        aspect: String(formData.get("aspect") || "landscape") as Photo["aspect"],
      });
      setEditingPhotoId(null);
      setMessage("Photo details updated.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update photo.");
    }
  }

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
      <LocationRail
        activeLocation={activeLocation}
        locations={locations}
        photos={adminPhotos}
        onChange={setActiveLocation}
      />
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
        {filteredPhotos.map((photo, index) => (
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
            {editingPhotoId === photo.id ? (
              <PhotoEditForm
                locations={locations}
                onCancel={() => setEditingPhotoId(null)}
                onSave={(formData) => savePhotoDetails(photo.id, formData)}
                photo={photo}
              />
            ) : (
              <div className="admin-card-meta">
                <span>
                  {photo.location}
                  {photo.year ? ` / ${photo.year}` : ""}
                </span>
                <strong>{photo.title}</strong>
                {photo.description ? <p>{photo.description}</p> : null}
                <small>{photo.published ? "Published" : "Draft"}</small>
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
                      }).then(refresh)
                    }
                    type="checkbox"
                  />
                  Published
                </label>
              </div>
            )}
          </article>
        ))}
      </section>
    </section>
  );
}

function PhotoEditForm({
  locations,
  onCancel,
  onSave,
  photo,
}: {
  locations: GalleryLocation[];
  onCancel: () => void;
  onSave: (formData: FormData) => Promise<void>;
  photo: Photo;
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
      <label>
        Title
        <input defaultValue={photo.title} name="title" placeholder={photo.location} type="text" />
      </label>
      <label>
        Description
        <textarea defaultValue={photo.description ?? ""} name="description" rows={3} />
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
}: {
  locations: GalleryLocation[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  photo: Photo;
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
        title: String(formData.get("title") || ""),
        description: String(formData.get("description") || ""),
        locationId: String(formData.get("locationId") || ""),
        year: Number(formData.get("year")) || undefined,
        aspect: String(formData.get("aspect") || "landscape") as Photo["aspect"],
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
          <PhotoEditForm locations={locations} onCancel={onClose} onSave={save} photo={photo} />
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
        <div className="about-portrait" aria-hidden="true">
          <Camera size={28} />
          <span>Photo coming soon</span>
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

function Footer() {
  return (
    <footer>
      <span>SD Gallery</span>
      <span>Photography by Sam Duckworth</span>
    </footer>
  );
}

export default App;
