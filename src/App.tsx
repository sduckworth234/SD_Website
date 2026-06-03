import type { Session } from "@supabase/supabase-js";
import {
  ArrowUpRight,
  Camera,
  Grid3X3,
  Lock,
  LogOut,
  MapPin,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createPhotoRecord,
  getAdminPhotos,
  getGalleryData,
  hasSupabaseEnv,
  isCurrentUserAdmin,
  supabase,
  updatePhotoVisibility,
  uploadPhotoAsset,
} from "./lib/supabase";
import type { GalleryLocation, LocationBucket, Photo } from "./types";

const allLocations = "All work";
type ActiveLocation = LocationBucket | typeof allLocations;

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
  const [locations, setLocations] = useState<GalleryLocation[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getGalleryData()
      .then((data) => {
        setPhotos(data.photos);
        setLocations(data.locations);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const featuredPhotos = photos.filter((photo) => photo.featured).slice(0, 3);
  const filteredPhotos = useMemo(() => {
    if (activeLocation === allLocations) return photos;
    return photos.filter((photo) => photo.location === activeLocation);
  }, [activeLocation, photos]);

  return (
    <main>
      <Header onNavigate={onNavigate} />
      <Hero featuredPhotos={featuredPhotos} onSelectPhoto={setSelectedPhoto} />
      <section className="intro-panel" id="galleries" aria-labelledby="gallery-heading">
        <div>
          <p className="eyebrow">Northern Beaches / Travel</p>
          <h2 id="gallery-heading">A quiet archive for coast, altitude, and light.</h2>
        </div>
        <p>
          Built as a gallery first: fast browsing, location buckets, flexible
          image ratios, and a Supabase-backed archive for the full collection.
        </p>
      </section>
      <LocationRail
        activeLocation={activeLocation}
        locations={locations}
        onChange={setActiveLocation}
      />
      {isLoading ? (
        <p className="loading-note">Loading gallery</p>
      ) : (
        <Gallery photos={filteredPhotos} onSelectPhoto={setSelectedPhoto} />
      )}
      <ArchivePlan />
      <Footer />
      {selectedPhoto ? (
        <Lightbox photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} />
      ) : null}
    </main>
  );
}

function Header({ onNavigate }: { onNavigate: (route: string) => void }) {
  function openAdmin(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    window.history.pushState({}, "", "/admin");
    onNavigate("/admin");
  }

  return (
    <header className="site-header">
      <a className="brand" href="#top" aria-label="SD Gallery home">
        SD
      </a>
      <nav aria-label="Primary navigation">
        <a href="#galleries">Galleries</a>
        <a href="#archive">Archive</a>
        <a href="/admin" onClick={openAdmin}>
          Admin
        </a>
      </nav>
    </header>
  );
}

function Hero({
  featuredPhotos,
  onSelectPhoto,
}: {
  featuredPhotos: Photo[];
  onSelectPhoto: (photo: Photo) => void;
}) {
  return (
    <section className="hero" id="top" aria-label="Featured photography">
      <div className="hero-copy">
        <p className="eyebrow">Sam Duckworth</p>
        <h1>Northern Beaches from above and on foot.</h1>
        <p>
          Drone-led coastal studies, travel landscapes, and grounded DSLR frames
          gathered into a calm, image-first archive.
        </p>
        <a className="hero-link" href="#galleries">
          View galleries <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </div>
      <div className="feature-strip" aria-label="Prime photo selection">
        {featuredPhotos.map((photo, index) => (
          <button
            className={`feature-card feature-card-${index + 1}`}
            key={photo.id}
            onClick={() => onSelectPhoto(photo)}
            type="button"
          >
            <img src={photo.imageUrl} alt={`${photo.title}, ${photo.location}`} />
            <div>
              <span>{photo.location}</span>
              <strong>{photo.title}</strong>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function LocationRail({
  activeLocation,
  locations,
  onChange,
}: {
  activeLocation: ActiveLocation;
  locations: GalleryLocation[];
  onChange: (location: ActiveLocation) => void;
}) {
  const visibleLocations: ActiveLocation[] = [
    allLocations,
    ...locations.map((location) => location.name),
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

function Gallery({
  photos,
  onSelectPhoto,
}: {
  photos: Photo[];
  onSelectPhoto: (photo: Photo) => void;
}) {
  return (
    <section className="gallery" aria-label="Photography gallery">
      {photos.map((photo, index) => (
        <button
          className={`photo-tile ${photo.aspect}`}
          key={photo.id}
          onClick={() => onSelectPhoto(photo)}
          style={{ "--stagger": `${Math.min(index, 8) * 34}ms` } as React.CSSProperties}
          type="button"
        >
          <img src={photo.imageUrl} alt={`${photo.title}, ${photo.location}`} loading="lazy" />
          <div className="photo-meta">
            <span>
              <MapPin size={13} aria-hidden="true" />
              {photo.location}
            </span>
            <strong>{photo.title}</strong>
            <small>
              {photo.kind} {photo.year ? `/ ${photo.year}` : ""}
            </small>
          </div>
        </button>
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
          <img src={photo.imageUrl} alt={`${photo.title}, ${photo.location}`} />
        </div>
        <aside className="lightbox-copy">
          <p className="eyebrow">{photo.location}</p>
          <h2>{photo.title}</h2>
          <p>{photo.description || "A quiet frame from the archive."}</p>
          <small>
            {photo.kind} {photo.year ? `/ ${photo.year}` : ""}
          </small>
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

  async function signOut() {
    await supabase?.auth.signOut();
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
      <section className="admin-photo-list" aria-label="Photo records">
        {adminPhotos.map((photo) => (
          <article className="admin-photo-row" key={photo.id}>
            <img src={photo.imageUrl} alt={photo.title} />
            <div>
              <strong>{photo.title}</strong>
              <span>{photo.location} / {photo.kind}</span>
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
            <label>
              <input
                checked={Boolean(photo.featured)}
                onChange={(event) =>
                  updatePhotoVisibility(photo.id, {
                    featured: event.target.checked,
                    published: Boolean(photo.published),
                  }).then(refresh)
                }
                type="checkbox"
              />
              Featured
            </label>
          </article>
        ))}
      </section>
    </section>
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
        kind: String(formData.get("kind") || "Drone") as Photo["kind"],
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
        Kind
        <select name="kind" defaultValue="Drone">
          <option>Drone</option>
          <option>Landscape</option>
          <option>Travel</option>
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

function ArchivePlan() {
  return (
    <section className="archive-plan" id="archive" aria-labelledby="archive-heading">
      <div>
        <p className="eyebrow">Architecture</p>
        <h2 id="archive-heading">Ready for the real collection.</h2>
      </div>
      <div className="plan-grid">
        <article>
          <Camera size={18} aria-hidden="true" />
          <h3>Supabase Storage</h3>
          <p>Store compressed uploads in the `photos` bucket and serve public transformed URLs.</p>
        </article>
        <article>
          <Grid3X3 size={18} aria-hidden="true" />
          <h3>Photo Metadata</h3>
          <p>Title, description, location, type, featured state, and publish state live in Postgres.</p>
        </article>
        <article>
          <MapPin size={18} aria-hidden="true" />
          <h3>Location Buckets</h3>
          <p>Public visitors only see published work, grouped into clean coastal and travel buckets.</p>
        </article>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer>
      <span>SD Gallery</span>
      <span>Drone / coast / travel</span>
    </footer>
  );
}

export default App;
