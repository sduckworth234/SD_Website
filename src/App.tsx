import type { Session } from "@supabase/supabase-js";
import {
  ArrowDown,
  Camera,
  EyeOff,
  Images,
  Instagram,
  LayoutDashboard,
  LayoutGrid,
  Lock,
  LogOut,
  MapPin,
  Pencil,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import type { CSSProperties, DependencyList } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  assignRecentSlot,
  bulkEditPhotos,
  createPhotoRecord,
  getAdminPhotos,
  getGalleryData,
  getRecentPhotos,
  hasSupabaseEnv,
  isCurrentUserAdmin,
  supabase,
  updatePhotoDetails,
  updatePhotoCuration,
  updatePhotoVisibility,
  uploadPhotoAsset,
} from "./lib/supabase";
import type { GalleryLocation, LocationBucket, Photo } from "./types";

const allLocations = "All work";
type ActiveLocation = LocationBucket | typeof allLocations;

type GalleryView = "flow" | "box";

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

// Image with a shimmer skeleton + fade-in, so partially-loaded images never
// flash in half-rendered. Skeleton is removed from the DOM once loaded.
function SmartImage({
  alt,
  className,
  src,
}: {
  alt: string;
  className?: string;
  src: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (ref.current?.complete) setLoaded(true);
  }, [src]);

  return (
    <>
      {loaded ? null : <span className="img-skeleton" aria-hidden="true" />}
      <img
        alt={alt}
        className={`smart-img${loaded ? " is-loaded" : ""}${className ? ` ${className}` : ""}`}
        decoding="async"
        loading="lazy"
        onLoad={() => setLoaded(true)}
        ref={ref}
        src={src}
      />
    </>
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

  return <PublicGallery onNavigate={setRoute} />;
}

function PublicGallery({ onNavigate }: { onNavigate: (route: string) => void }) {
  const [activeLocation, setActiveLocation] =
    useState<ActiveLocation>(allLocations);
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
  const [isLoading, setIsLoading] = useState(true);

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
    if (!sb) return;
    let active = true;
    const check = async () => {
      const { data } = await sb.auth.getSession();
      if (!data.session) {
        if (active) setIsAdmin(false);
        return;
      }
      const ok = await isCurrentUserAdmin();
      if (active) setIsAdmin(ok);
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

  useEffect(() => {
    if (
      activeLocation !== allLocations &&
      !photos.some((photo) => photo.location === activeLocation)
    ) {
      setActiveLocation(allLocations);
    }
  }, [activeLocation, photos]);

  const filteredPhotos = useMemo(() => {
    if (activeLocation === allLocations) return photos;
    return photos.filter((photo) => photo.location === activeLocation);
  }, [activeLocation, photos]);

  useScrollReveal([isLoading, activeLocation, filteredPhotos.length, view, recentPhotos.length]);

  return (
    <main>
      <Header
        isScrolled={isScrolled}
        onNavigate={onNavigate}
        onOpenAbout={() => setIsAboutOpen(true)}
      />
      <Hero />
      <div id="galleries" className="section-anchor" aria-hidden="true" />
      {recentPhotos.length >= 5 ? (
        <RecentWork
          isAdmin={isAdmin}
          onChangePhoto={setRecentSlot}
          onEditPhoto={setEditingPhoto}
          onSelect={setSelectedPhoto}
          photos={recentPhotos}
        />
      ) : null}
      <LocationRail
        activeLocation={activeLocation}
        locations={locations}
        photos={photos}
        onChange={setActiveLocation}
      />
      {isLoading ? (
        <p className="loading-note">Loading gallery</p>
      ) : (
        <>
          <GalleryControls
            count={filteredPhotos.length}
            onChange={setView}
            view={view}
          />
          <Gallery
            isAdmin={isAdmin}
            onEditPhoto={setEditingPhoto}
            onSelectPhoto={setSelectedPhoto}
            onUnpublish={unpublishPhoto}
            photos={filteredPhotos}
            view={view}
          />
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

function Header({
  isScrolled,
  onNavigate,
  onOpenAbout,
}: {
  isScrolled: boolean;
  onNavigate: (route: string) => void;
  onOpenAbout: () => void;
}) {
  function openAdmin(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    window.history.pushState({}, "", "/admin");
    onNavigate("/admin");
  }

  return (
    <header className={`site-header${isScrolled ? " is-visible" : ""}`}>
      <a className="brand" href="#top" aria-label="SD Gallery home">
        SD
      </a>
      <nav aria-label="Primary navigation">
        <a href="#galleries">Galleries</a>
        <button className="nav-button" onClick={onOpenAbout} type="button">
          About Me
        </button>
        <a className="nav-icon" href="/admin" onClick={openAdmin} aria-label="Admin sign in" title="Admin">
          <UserRound size={18} aria-hidden="true" />
        </a>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero landing-stage" id="top" aria-label="Sam Duckworth Photography">
      <div className="landing-copy scroll-reveal is-visible">
        <p className="eyebrow">My Photography Gallery</p>
        <h1>Sam Duckworth Photography.</h1>
        <p>
          Northern Beaches drone and travel photography, collected into a quiet
          image-first gallery.
        </p>
      </div>
      <a className="scroll-cue" href="#galleries" aria-label="Scroll down to the gallery">
        <span>Scroll</span>
        <ArrowDown size={18} aria-hidden="true" />
      </a>
    </section>
  );
}

function LocationRail({
  activeLocation,
  locations,
  photos,
  onChange,
}: {
  activeLocation: ActiveLocation;
  locations: GalleryLocation[];
  photos: Photo[];
  onChange: (location: ActiveLocation) => void;
}) {
  const photoLocationNames = new Set(photos.map((photo) => photo.location));
  const visibleLocations: ActiveLocation[] = [
    allLocations,
    ...locations
      .map((location) => location.name)
      .filter((locationName) => photoLocationNames.has(locationName)),
    ...[...photoLocationNames].filter(
      (locationName) => !locations.some((location) => location.name === locationName),
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
          {location}
        </button>
      ))}
    </section>
  );
}

function GalleryControls({
  count,
  onChange,
  view,
}: {
  count: number;
  onChange: (view: GalleryView) => void;
  view: GalleryView;
}) {
  return (
    <div className="gallery-controls">
      <span className="gallery-count">
        {count} {count === 1 ? "photograph" : "photographs"}
      </span>
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

function Gallery({
  isAdmin,
  onEditPhoto,
  onSelectPhoto,
  onUnpublish,
  photos,
  view,
}: {
  isAdmin: boolean;
  onEditPhoto: (photo: Photo) => void;
  onSelectPhoto: (photo: Photo) => void;
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
          <SmartImage src={photo.imageUrl} alt={`${photo.title}, ${photo.location}`} />
          <div className="photo-meta">
            <span>
              <MapPin size={13} aria-hidden="true" />
              {photo.location}
            </span>
            <strong>{photo.title}</strong>
            {photo.year ? <small>{photo.year}</small> : null}
          </div>
          {isAdmin ? (
            <div className="tile-admin-actions">
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
          <span>Portrait placeholder</span>
        </div>
        <div className="about-copy">
          <p className="eyebrow">About Me</p>
          <h2>Sam Duckworth</h2>
          <p>
            Placeholder bio — a short introduction goes here. Northern Beaches
            based photographer shooting coast and travel, from the air and on
            foot.
          </p>
          <p>
            More to come: a proper photo, a few lines about the work, and how to
            get in touch.
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
