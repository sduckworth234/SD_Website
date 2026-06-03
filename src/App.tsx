import { ArrowUpRight, Camera, Grid3X3, MapPin } from "lucide-react";
import { useMemo, useState } from "react";
import { locationBuckets, photos } from "./data/photos";
import type { LocationBucket, Photo } from "./types";

const allLocations = "All work";
type ActiveLocation = LocationBucket | typeof allLocations;

function App() {
  const [activeLocation, setActiveLocation] =
    useState<ActiveLocation>(allLocations);

  const featuredPhotos = photos.filter((photo) => photo.featured);
  const filteredPhotos = useMemo(() => {
    if (activeLocation === allLocations) return photos;
    return photos.filter((photo) => photo.location === activeLocation);
  }, [activeLocation]);

  return (
    <main>
      <Header />
      <Hero featuredPhotos={featuredPhotos} />
      <section className="intro-panel" id="galleries" aria-labelledby="gallery-heading">
        <div>
          <p className="eyebrow">Northern Beaches / Travel</p>
          <h2 id="gallery-heading">A quiet archive for coast, altitude, and light.</h2>
        </div>
        <p>
          Built as a gallery first: fast browsing, location buckets, flexible
          image ratios, and a Supabase-ready photo model for a 500 image archive.
        </p>
      </section>
      <LocationRail
        activeLocation={activeLocation}
        onChange={setActiveLocation}
      />
      <Gallery photos={filteredPhotos} />
      <ArchivePlan />
      <Footer />
    </main>
  );
}

function Header() {
  return (
    <header className="site-header">
      <a className="brand" href="#top" aria-label="SD Gallery home">
        SD
      </a>
      <nav aria-label="Primary navigation">
        <a href="#galleries">Galleries</a>
        <a href="#archive">Archive</a>
        <a href="mailto:hello@example.com">Contact</a>
      </nav>
    </header>
  );
}

function Hero({ featuredPhotos }: { featuredPhotos: Photo[] }) {
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
          <article className={`feature-card feature-card-${index + 1}`} key={photo.id}>
            <img src={photo.imageUrl} alt={`${photo.title}, ${photo.location}`} />
            <div>
              <span>{photo.location}</span>
              <strong>{photo.title}</strong>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function LocationRail({
  activeLocation,
  onChange,
}: {
  activeLocation: ActiveLocation;
  onChange: (location: ActiveLocation) => void;
}) {
  const locations: ActiveLocation[] = [allLocations, ...locationBuckets];

  return (
    <section className="location-rail" aria-label="Filter gallery by location">
      {locations.map((location) => (
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

function Gallery({ photos }: { photos: Photo[] }) {
  return (
    <section className="gallery" aria-label="Photography gallery">
      {photos.map((photo, index) => (
        <article
          className={`photo-tile ${photo.aspect}`}
          key={photo.id}
          style={{ "--stagger": `${Math.min(index, 8) * 34}ms` } as React.CSSProperties}
        >
          <img src={photo.imageUrl} alt={`${photo.title}, ${photo.location}`} loading="lazy" />
          <div className="photo-meta">
            <span>
              <MapPin size={13} aria-hidden="true" />
              {photo.location}
            </span>
            <strong>{photo.title}</strong>
            <small>
              {photo.kind} / {photo.year}
            </small>
          </div>
        </article>
      ))}
    </section>
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
          <p>Store original WebP/JPEG exports once, then serve transformed public URLs by width and quality.</p>
        </article>
        <article>
          <Grid3X3 size={18} aria-hidden="true" />
          <h3>Photo Metadata</h3>
          <p>Keep title, location, camera type, year, featured status, and storage path in a photos table.</p>
        </article>
        <article>
          <MapPin size={18} aria-hidden="true" />
          <h3>Location Buckets</h3>
          <p>Group the archive by Northern Beaches suburbs first, with a compact travel bucket for everything else.</p>
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
