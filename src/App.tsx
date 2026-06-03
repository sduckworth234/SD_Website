import type { Session } from "@supabase/supabase-js";
import {
  ArrowUpRight,
  Lock,
  LogOut,
  MapPin,
  Upload,
  X,
} from "lucide-react";
import type { CSSProperties, DependencyList } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  createPhotoRecord,
  getAdminPhotos,
  getGalleryData,
  hasSupabaseEnv,
  isCurrentUserAdmin,
  setHeroSlot,
  supabase,
  updatePhotoDetails,
  updatePhotoCuration,
  updatePhotoVisibility,
  uploadPhotoAsset,
} from "./lib/supabase";
import type { GalleryLocation, LocationBucket, Photo } from "./types";

const allLocations = "All work";
type ActiveLocation = LocationBucket | typeof allLocations;

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

  useScrollReveal([isLoading, activeLocation, filteredPhotos.length]);

  return (
    <main>
      <Header onNavigate={onNavigate} />
      <Hero featuredPhotos={featuredPhotos} onSelectPhoto={setSelectedPhoto} />
      <section className="intro-panel scroll-reveal" id="galleries" aria-labelledby="gallery-heading">
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
        photos={photos}
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
        <a href="#about">About Me</a>
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
  const flagshipPhoto =
    featuredPhotos.find((photo) => photo.aspect === "portrait") ?? featuredPhotos[0];
  const floatingPhotos = featuredPhotos
    .filter((photo) => photo.id !== flagshipPhoto?.id)
    .slice(0, 2);

  return (
    <section className="hero landing-stage" id="top" aria-label="Sam Duckworth Photography">
      <div className="landing-loader" aria-hidden="true">
        <span />
      </div>
      <div className="hero-copy landing-copy scroll-reveal is-visible">
        <p className="eyebrow">White light / coastal archive</p>
        <h1>Sam Duckworth Photography.</h1>
        <p>
          Northern Beaches drone and travel photography, collected into a quiet
          image-first gallery.
        </p>
        <a className="hero-link" href="#galleries">
          Scroll down to dive in <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </div>
      <div className="landing-art" aria-label="Flagship photo selection">
        {flagshipPhoto ? (
          <button
            className="flagship-photo scroll-reveal is-visible"
            onClick={() => onSelectPhoto(flagshipPhoto)}
            type="button"
          >
            <img
              src={flagshipPhoto.imageUrl}
              alt={`${flagshipPhoto.title}, ${flagshipPhoto.location}`}
            />
            <div>
              <span>{flagshipPhoto.location}</span>
              {flagshipPhoto.year ? <small>{flagshipPhoto.year}</small> : null}
            </div>
          </button>
        ) : null}
        {floatingPhotos.map((photo, index) => (
          <button
            className={`floating-photo floating-photo-${index + 1} scroll-reveal is-visible`}
            key={photo.id}
            onClick={() => onSelectPhoto(photo)}
            style={{ "--reveal-delay": `${420 + index * 140}ms` } as CSSProperties}
            type="button"
          >
            <img src={photo.imageUrl} alt={`${photo.title}, ${photo.location}`} />
          </button>
        ))}
      </div>
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
          className={`photo-tile ${photo.aspect} scroll-reveal`}
          key={photo.id}
          onClick={() => onSelectPhoto(photo)}
          style={{ "--reveal-delay": `${Math.min(index, 10) * 42}ms` } as CSSProperties}
          type="button"
        >
          <img src={photo.imageUrl} alt={`${photo.title}, ${photo.location}`} loading="lazy" />
          <div className="photo-meta">
            <span>
              <MapPin size={13} aria-hidden="true" />
              {photo.location}
            </span>
            <strong>{photo.title}</strong>
            {photo.year ? <small>{photo.year}</small> : null}
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
          <p className="eyebrow">
            {photo.location}
            {photo.year ? ` / ${photo.year}` : ""}
          </p>
          <h2>{photo.title}</h2>
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

  async function assignHeroSlot(photoId: string, slot: 1 | 2 | 3) {
    await setHeroSlot(photoId, slot);
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
        <button className="solid-button" onClick={() => bulkUpdate({ published: true })} type="button">
          Publish
        </button>
        <button className="text-button" onClick={() => bulkUpdate({ published: false })} type="button">
          Unpublish
        </button>
        <button className="text-button" onClick={() => bulkUpdate({ featured: true })} type="button">
          Feature
        </button>
        <button className="text-button" onClick={() => bulkUpdate({ featured: false })} type="button">
          Unfeature
        </button>
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
              <img src={photo.imageUrl} alt={photo.title} loading="lazy" />
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
                <small>
                  {photo.published ? "Published" : "Draft"}
                  {photo.featured ? " / Featured" : ""}
                </small>
                <div className="slot-actions">
                  <button onClick={() => assignHeroSlot(photo.id, 1)} type="button">Hero 1</button>
                  <button onClick={() => assignHeroSlot(photo.id, 2)} type="button">Hero 2</button>
                  <button onClick={() => assignHeroSlot(photo.id, 3)} type="button">Hero 3</button>
                </div>
                <button className="text-button edit-button" onClick={() => setEditingPhotoId(photo.id)} type="button">
                  Edit details
                </button>
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

function ArchivePlan() {
  return (
    <section className="archive-plan scroll-reveal" id="about" aria-labelledby="about-heading">
      <div>
        <p className="eyebrow">About Me</p>
        <h2 id="about-heading">Northern beaches from above and on foot.</h2>
      </div>
      <div className="plan-grid">
        <article className="scroll-reveal" style={{ "--reveal-delay": "80ms" } as CSSProperties}>
          <h3>Home Coast</h3>
          <p>Most of this work is made around the Northern Beaches, from headlands, pools, ocean edges, and quiet stretches of coastline.</p>
        </article>
        <article className="scroll-reveal" style={{ "--reveal-delay": "160ms" } as CSSProperties}>
          <h3>Drone / DSLR</h3>
          <p>I shoot from the air and from the ground, keeping the collection focused on place, light, and clean compositions.</p>
        </article>
        <article className="scroll-reveal" style={{ "--reveal-delay": "240ms" } as CSSProperties}>
          <h3>Travel</h3>
          <p>Images from trips sit alongside the coastal work, grouped simply by location as the archive grows.</p>
        </article>
      </div>
    </section>
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
