import { useEffect, useState } from "react";
import { ArrowRight, Building2, Instagram, Mail, MapPin, PartyPopper, Phone, Sparkles } from "lucide-react";
import { getProfessionalWorkPhotos, getSiteSettings } from "./lib/supabase";
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

// How a job actually runs, said once. Deliberately three steps — anything
// longer reads like a process document rather than an answer to "what happens
// if I email you".
const PROCESS = [
  { step: "01", title: "Enquire", body: "Tell me the address or the date and what you need. I come back within 24 hours with availability and a price." },
  { step: "02", title: "Shoot", body: "Usually an hour or two on site. Drone and ground, timed for the light where it matters." },
  { step: "03", title: "Delivery", body: "Edited photos back within 48 hours, sized for listings, socials and print." },
];

// The three package shapes. Prices are deliberately NOT in the code: each one
// reads a site_settings row and stays hidden until Sam sets it, so the page
// never quotes a number he hasn't agreed to.
const PACKAGES = [
  {
    id: "property",
    priceKey: "work_price_property",
    title: "Property listing",
    body: "For agents and owners putting a place to market.",
    scope: ["Aerial and ground stills", "Interiors and exteriors", "Sunrise or golden-hour timing", "Edited gallery within 48 hours"],
  },
  {
    id: "event",
    priceKey: "work_price_event",
    title: "Event",
    body: "Pubs, clubs, launches and outdoor gigs.",
    scope: ["Coverage across the run of the event", "Drone where the site allows it", "Crowd, venue and detail frames", "Edited gallery within 48 hours"],
  },
  {
    id: "brand",
    priceKey: "work_price_brand",
    title: "Brand & content",
    body: "Photos and short video for a site, a campaign or a feed.",
    scope: ["Half or full day on location", "Stills plus short-form video", "Framed for web and social crops", "Licensed for your own channels"],
  },
];

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

// "350" / "$350" / "350 + GST" all render sensibly; anything blank stays
// hidden and the package falls back to the quote line.
function formatFrom(value?: string | null) {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  return /^\d/.test(raw) ? `$${raw}` : raw;
}

export default function WorkPage({ onNavigate }: { onNavigate: (route: string) => void }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Photo | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactContext, setContactContext] = useState<{ context: string; intro: string } | null>(null);
  // Prices, the licence line and the client list are all admin-set rows. None
  // of them are claims this code makes on Sam's behalf: each stays invisible
  // until he fills it in.
  const [settings, setSettings] = useState<Record<string, string | null>>({});
  const content = usePublicContent();

  useEffect(() => {
    let active = true;
    getProfessionalWorkPhotos().then((data) => {
      if (active) { setPhotos(data); setLoading(false); }
    });
    getSiteSettings().then((rows) => {
      if (!active) return;
      const map: Record<string, string | null> = {};
      for (const row of rows) map[row.key] = row.value;
      setSettings(map);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const licenceLine = (settings.work_licence_line ?? "").trim();
  const clients = (settings.work_clients ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  function openEnquiry(context: string, intro: string) {
    setContactContext({ context, intro });
    setContactOpen(true);
  }

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

      <section className="work-process" aria-label="How it works">
        <div className="work-section-head">
          <p className="eyebrow">How it works</p>
          <h2>Three steps, no fuss.</h2>
        </div>
        <ol className="work-process-list">
          {PROCESS.map(({ step, title, body }) => (
            <li key={step}>
              <span className="work-process-step">{step}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="work-packages" aria-label="Packages">
        <div className="work-section-head">
          <p className="eyebrow">Packages</p>
          <h2>What a job usually looks like.</h2>
          <p>Every place and every event is different, so treat these as starting points — I&rsquo;ll price the actual job when you tell me about it.</p>
        </div>
        <div className="work-package-grid">
          {PACKAGES.map((pack) => {
            const from = formatFrom(settings[pack.priceKey]);
            return (
              <article className="work-package" key={pack.id}>
                <h3>{pack.title}</h3>
                <p className="work-package-body">{pack.body}</p>
                <ul className="work-package-scope">
                  {pack.scope.map((line) => <li key={line}>{line}</li>)}
                </ul>
                <p className="work-package-price">{from ? <>From <strong>{from}</strong></> : "Quote within 24 hours"}</p>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => openEnquiry(`${pack.title} enquiry`, `Tell me about the ${pack.title.toLowerCase()} — where, when, and what you need — and I'll come back with availability and a price.`)}
                >
                  Enquire <ArrowRight size={14} aria-hidden="true" />
                </button>
              </article>
            );
          })}
        </div>
        {/* A commission is the one service that starts from the print side of
            the site rather than the hire side, so it sits under the packages
            as its own line rather than pretending to be a fourth package. */}
        <div className="work-commission">
          <p>
            <strong>Commission a print of your home, boat or business.</strong>{" "}
            I&rsquo;ll fly it, choose the light, and hand back a framed photograph made for one wall.
          </p>
          <button
            className="ghost-button"
            type="button"
            onClick={() => openEnquiry("Commission enquiry", "Tell me what you'd like photographed and roughly where it is, and I'll come back with what's possible and a price.")}
          >
            Commission enquiry <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
        {licenceLine || clients.length ? (
          <div className="work-credentials">
            {licenceLine ? <p>{licenceLine}</p> : null}
            {clients.length ? (
              <p className="work-clients"><span>Worked with</span>{clients.join(" · ")}</p>
            ) : null}
          </div>
        ) : null}
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
          context={contactContext?.context ?? "Professional work enquiry"}
          intro={contactContext?.intro ?? "Tell me a bit about your listing, event or brand shoot and I'll get back to you with availability and a quote."}
          onClose={() => { setContactOpen(false); setContactContext(null); }}
        />
      ) : null}
    </main>
  );
}
