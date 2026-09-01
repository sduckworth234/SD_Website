import { useEffect, useState } from "react";
import { ArrowRight, Building2, Instagram, Mail, MapPin, PartyPopper, Phone, Sparkles } from "lucide-react";
import { getProfessionalWorkPhotos } from "./lib/supabase";
import { usePublicContent } from "./lib/publicContent";
import { useSeo } from "./lib/seo";
import { Header } from "./components/Header";
import { ContactOverlay } from "./components/ContactOverlay";
import { PhotoLightbox, photoLightboxSrcSet } from "./components/PhotoLightbox";
import { SmartImage } from "./components/SmartImage";
import type { Photo } from "./types";

// Sizing for the uniform ~340px gallery tiles (see .work-gallery-grid) — not
// PHOTO_LIGHTBOX_SIZES, which describes the much larger modal view and was
// picking unnecessarily low-res thumbnails here.
const WORK_GRID_SIZES = "(max-width: 700px) 45vw, (max-width: 1180px) 30vw, 340px";

// Hardcoded fallback so the hero always has a photo before any row is marked
// is_professional_work in the admin Shop tab — the "Flare" 2024 Manly wharf
// shoot Sam picked as the archetypal professional-work example.
const FALLBACK_HERO_URL =
  "https://krixuiimabosiorzxzju.supabase.co/storage/v1/render/image/public/photos/approved/2024/travels/wharf22-e2abcad2364a.webp?width=1800&resize=cover&quality=78";

const SERVICES = [
  {
    icon: Building2,
    title: "Property",
    body: "Drone gives bird's-eye and oblique angles you can't get any other way — photo and video, inside and out.",
  },
  {
    icon: PartyPopper,
    title: "Events",
    body: "Commercial events, pubs, clubs, outdoor gigs — including drone coverage.",
  },
  {
    icon: Sparkles,
    title: "Brand & content",
    body: "Photos and video for social media, your website, or a campaign.",
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
      <div id="main-content" className="section-anchor" tabIndex={-1} />

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
          <h1>I also shoot real estate, events &amp; brand work.</h1>
          <p>I've been doing this for ten years, mostly for myself — but I take on real estate, event and brand jobs too. Based in Sydney.</p>
          <button className="solid-button" type="button" onClick={() => setContactOpen(true)}>
            Get in touch <ArrowRight size={15} aria-hidden="true" />
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
          <h2>{photos.length ? "A few examples." : "Examples coming soon."}</h2>
        </div>
        {photos.length ? (
          <div className="work-gallery-grid">
            {photos.map((photo) => (
              <button
                className="photo-tile work-gallery-tile"
                key={photo.id}
                type="button"
                onClick={() => setSelected(photo)}
                aria-label={`View ${photo.title}`}
              >
                <SmartImage
                  src={photo.imageUrl}
                  srcSet={photoLightboxSrcSet(photo)}
                  sizes={WORK_GRID_SIZES}
                  alt={photo.title}
                />
              </button>
            ))}
          </div>
        ) : (
          !loading && <p className="work-gallery-empty">I'll add some real estate, event and brand shots here soon.</p>
        )}
      </section>

      <section className="work-contact" aria-label="Contact">
        <div className="work-section-head">
          <p className="eyebrow">Get in touch</p>
          <h2>Tell me about the shoot.</h2>
          <p>Flick me a few details about what you need and I&rsquo;ll get back to you with availability and a quote.</p>
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
          intro="Tell me a bit about your listing, event or brand shoot and I'll get back to you with availability and a quote."
          onClose={() => setContactOpen(false)}
        />
      ) : null}
    </main>
  );
}
