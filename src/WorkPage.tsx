import { useEffect, useState } from "react";
import { ArrowRight, Aperture, Building2, Instagram, Mail, MapPin, PartyPopper, Phone, Sparkles } from "lucide-react";
import { getProfessionalWorkPhotos } from "./lib/supabase";
import { usePublicContent } from "./lib/publicContent";
import { useSeo } from "./lib/seo";
import { Header } from "./components/Header";
import { ContactOverlay } from "./components/ContactOverlay";
import { PhotoLightbox, photoLightboxSrcSet, PHOTO_LIGHTBOX_SIZES } from "./components/PhotoLightbox";
import { SmartImage } from "./components/SmartImage";
import type { Photo } from "./types";

// Hardcoded fallback so the hero always has a photo before any row is marked
// is_professional_work in the admin Shop tab — the "Flare" 2024 Manly wharf
// shoot Sam picked as the archetypal professional-work example.
const FALLBACK_HERO_URL =
  "https://krixuiimabosiorzxzju.supabase.co/storage/v1/render/image/public/photos/approved/2024/travels/wharf22-e2abcad2364a.webp?width=1800&resize=cover&quality=78";

const SERVICES = [
  {
    icon: Building2,
    title: "Real estate & aerial",
    body: "Listing photography and drone flyovers that show a property at its best — interiors, exteriors and the surrounding land.",
  },
  {
    icon: PartyPopper,
    title: "Events & launches",
    body: "Discreet, comprehensive coverage of live events, from golden-hour crowds to the details organisers want remembered.",
  },
  {
    icon: Sparkles,
    title: "Brand & campaign",
    body: "Location and product imagery for campaigns, social content and marketing — shot to match your brand's look.",
  },
  {
    icon: Aperture,
    title: "Elopements & occasions",
    body: "Intimate, unposed coverage for elopements and private occasions, with the same eye for light seen across the gallery.",
  },
];

export default function WorkPage({ onNavigate }: { onNavigate: (route: string) => void }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Photo | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const content = usePublicContent();

  useEffect(() => {
    let active = true;
    getProfessionalWorkPhotos().then((data) => {
      if (active) { setPhotos(data); setLoading(false); }
    });
    return () => { active = false; };
  }, []);

  const heroPhoto = photos[0] ?? null;

  useSeo("Professional Photography — Real Estate, Events & Brand Work | Sam Duckworth", {
    path: "/work",
    description: "Aerial and ground photography for real estate listings, live events and brand campaigns, by Sam Duckworth — based on Sydney's Northern Beaches.",
    type: "website",
    structuredData: {
      "@context": "https://schema.org",
      "@type": "Service",
      serviceType: "Photography",
      name: "Professional photography — real estate, events & brand work",
      description: "Aerial and ground photography for real estate listings, live events and brand campaigns.",
      provider: {
        "@type": "Person",
        name: "Sam Duckworth",
        email: content.publicEmail,
        telephone: content.publicPhone,
      },
      areaServed: content.publicLocation,
      url: "https://www.samduckworth.com/work",
    },
  });

  return (
    <main className="work-page">
      <Header isScrolled onNavigate={onNavigate} showShop={false} onOpenContact={() => setContactOpen(true)} />

      <section className="work-hero">
        <img
          className="work-hero-img"
          src={heroPhoto?.imageUrl ?? FALLBACK_HERO_URL}
          alt=""
          loading="eager"
          decoding="async"
        />
        <div className="work-hero-copy">
          <p className="eyebrow">Available for hire</p>
          <h1>Professional photography for real estate, events &amp; brands.</h1>
          <p>Ten years behind a drone and a camera — now open for listings, live events and brand campaigns across Sydney and beyond.</p>
          <button className="solid-button" type="button" onClick={() => setContactOpen(true)}>
            Get a quote <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="work-services" aria-label="Services">
        {SERVICES.map(({ icon: Icon, title, body }) => (
          <article className="work-service-card" key={title}>
            <Icon size={20} aria-hidden="true" />
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </section>

      <section className="work-gallery" aria-label="Recent professional work">
        <div className="work-section-head">
          <p className="eyebrow">Recent work</p>
          <h2>{photos.length ? "A few examples." : "Portfolio coming soon."}</h2>
        </div>
        {photos.length ? (
          <div className="gallery view-box work-gallery-grid">
            {photos.map((photo) => (
              <button
                className="photo-tile"
                key={photo.id}
                type="button"
                onClick={() => setSelected(photo)}
                aria-label={`View ${photo.title}`}
              >
                <SmartImage
                  src={photo.imageUrl}
                  srcSet={photoLightboxSrcSet(photo)}
                  sizes={PHOTO_LIGHTBOX_SIZES}
                  alt={photo.title}
                />
              </button>
            ))}
          </div>
        ) : (
          !loading && <p className="work-gallery-empty">Examples of real estate, event and brand work will appear here soon.</p>
        )}
      </section>

      <section className="work-contact" aria-label="Contact">
        <div className="work-section-head">
          <p className="eyebrow">Get in touch</p>
          <h2>Tell me about the shoot.</h2>
          <p>Send a few details about your listing, event or brand shoot and I&rsquo;ll get back to you with availability and a quote.</p>
        </div>
        <button className="solid-button" type="button" onClick={() => setContactOpen(true)}>
          Send an enquiry <ArrowRight size={15} aria-hidden="true" />
        </button>
        <div className="work-contact-details">
          <a href={`mailto:${content.publicEmail}`}><Mail size={15} aria-hidden="true" /> {content.publicEmail}</a>
          <a href={`tel:${content.publicPhone.replace(/[^+\d]/g, "")}`}><Phone size={15} aria-hidden="true" /> {content.publicPhone}</a>
          <span><MapPin size={15} aria-hidden="true" /> {content.publicLocation}</span>
          <a href={content.instagramUrl} target="_blank" rel="noopener noreferrer"><Instagram size={15} aria-hidden="true" /> @{content.instagramHandle}</a>
        </div>
      </section>

      <footer className="site-footer">
        <span>{content.footerLabel}</span>
        <a className="footer-ig" href={content.instagramUrl} target="_blank" rel="noopener noreferrer" aria-label={`Instagram: ${content.instagramHandle}`}>
          <Instagram size={15} aria-hidden="true" /> {content.instagramHandle}
        </a>
        <a className="footer-admin" href="/admin" title="Site access">Photography by Sam Duckworth</a>
      </footer>

      {selected ? <PhotoLightbox photo={selected} onClose={() => setSelected(null)} /> : null}
      {contactOpen ? (
        <ContactOverlay
          context="Professional work enquiry"
          intro="Tell me about your real estate listing, event or brand shoot and I'll get back to you with availability and a quote."
          onClose={() => setContactOpen(false)}
        />
      ) : null}
    </main>
  );
}
