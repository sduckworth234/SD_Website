// Build-time prerender. Runs immediately after `vite build` (see the `build`
// script in package.json), so Vercel produces it on every deploy.
//
// WHY: the site is a client-rendered SPA — every route used to ship the same
// index.html, so link crawlers (Google's non-JS pass, iMessage, WhatsApp,
// Slack, Facebook, Pinterest) saw one generic title/description/share card for
// every product and every gallery. This writes a real HTML file per public
// route with that route's own <title>, description, canonical, OG/Twitter tags
// and JSON-LD. Vercel checks the filesystem BEFORE applying rewrites, so
// dist/shop/<slug>/index.html wins over the SPA catch-all while /admin,
// /checkout and anything else still falls through to it.
//
// The app still hydrates normally on top: useSeo (src/lib/seo.ts) rewrites the
// same tags client-side, in almost every case to the identical values.
//
// HOW the head is swapped: index.html marks its SEO block with
// <!-- SEO:START --> / <!-- SEO:END -->. Everything between the markers is
// replaced per route; the rest of the document (GA, theme script, font
// preloads, the bundle <script>) is untouched. If the markers are missing the
// script fails loudly rather than shipping wrong tags.
//
// ENV: needs VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY (both already
// set in Vercel, since the browser bundle needs them too). Without them, or if
// Supabase is unreachable, it prints a warning and leaves dist/ exactly as Vite
// built it — a valid, if unprerendered, site. It must never fail a build.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPricing, priceCentsFor } from "../server/shop/catalogue.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

// Vercel injects the project's env vars into the build process. Locally they
// live in .env.local, which Vite reads for the browser bundle but Node does
// not — load it so `npm run build` on a laptop prerenders too instead of
// silently skipping.
try {
  process.loadEnvFile?.(join(ROOT, ".env.local"));
} catch {
  // No .env.local (the normal case on Vercel) — the real env is already set.
}

const SITE_URL = (process.env.VITE_SITE_URL ?? "https://www.samduckworth.com").replace(/\/$/, "");
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const PHOTO_BUCKET = process.env.VITE_SUPABASE_PHOTO_BUCKET ?? "photos";

const SITE_NAME = "Sam Duckworth Photography";
const DEFAULT_TITLE = "Sam Duckworth Photography — Aerial & Landscape, Northern Beaches";
const DEFAULT_DESCRIPTION =
  "Aerial drone and landscape photography by Sam Duckworth, based on Sydney's Northern Beaches — fine-art prints and commissions.";

// ---------------------------------------------------------------- utilities

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

// JSON embedded in a <script> must not be able to close its own tag.
const jsonForScript = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");

async function rest(path) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!response.ok) {
    throw new Error(`Supabase ${response.status} for ${path.split("?")[0]}`);
  }
  return response.json();
}

// Mirrors getTransformedPublicUrl() in src/lib/supabase.ts, which is what the
// browser requests — so a preload here hits the same cache entry the <img>
// will ask for. supabase-js emits the params in this exact order.
function transformedUrl(bucket, path, width, quality) {
  return `${encodeURI(`${SUPABASE_URL}/storage/v1/render/image/public/${bucket}/${path}`)}?width=${width}&resize=contain&quality=${quality}`;
}

function photoImage(photo, width = 1200, quality = 76) {
  if (photo?.storage_path) {
    return transformedUrl(photo.storage_bucket ?? PHOTO_BUCKET, photo.storage_path, width, quality);
  }
  return photo?.image_url || `${SITE_URL}/og-image.png`;
}

const isoDay = (value) => (value ? String(value).slice(0, 10) : null);

// --------------------------------------------------------------- head build

function structuredDataTag(data) {
  const list = Array.isArray(data) ? data : [data];
  return list
    .filter(Boolean)
    // data-sd-prerendered lets useSeo (src/lib/seo.ts) drop a block once the
    // app renders its own schema of the same @type, so a product page doesn't
    // end up with two Product graphs. Blocks the app never replaces (the
    // LocalBusiness graph, breadcrumbs) simply stay.
    .map((entry) => `<script type="application/ld+json" data-sd-prerendered>${jsonForScript(entry)}</script>`)
    .join("\n    ");
}

function headFor(route) {
  const url = `${SITE_URL}${route.path}`;
  const image = route.image ?? `${SITE_URL}/api/og-image`;
  const lines = [
    `<title>${esc(route.title)}</title>`,
    `<meta name="description" content="${esc(route.description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta name="robots" content="index, follow" />`,
    `<meta property="og:type" content="${esc(route.type ?? "website")}" />`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}" />`,
    `<meta property="og:title" content="${esc(route.title)}" />`,
    `<meta property="og:description" content="${esc(route.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(route.title)}" />`,
    `<meta name="twitter:description" content="${esc(route.description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
  ];
  if (route.preloadImage) {
    // The LCP image, discoverable in the HTML instead of ~13 Supabase round
    // trips later. Paired with the #sd-boot payload below, which lets the Hero
    // render on first paint rather than after the gallery query resolves.
    lines.push(
      `<link rel="preload" as="image" fetchpriority="high" href="${esc(route.preloadImage)}" />`,
    );
  }
  if (route.structuredData) lines.push(structuredDataTag(route.structuredData));
  if (route.boot) {
    // A data block, NOT executable script: the CSP allow-lists inline scripts
    // by sha256 hash, and a per-build hash could never be added to the static
    // vercel.json. type="application/json" is inert, so CSP does not apply.
    lines.push(`<script type="application/json" id="sd-boot">${jsonForScript(route.boot)}</script>`);
  }
  return lines.join("\n    ");
}

// ------------------------------------------------------------- JSON-LD bits

function localBusiness(content) {
  const sameAs = [content.instagram_url].filter(Boolean);
  return {
    "@type": ["LocalBusiness", "ProfessionalService"],
    "@id": `${SITE_URL}/#business`,
    name: content.site_name || SITE_NAME,
    image: `${SITE_URL}/og-image.png`,
    url: `${SITE_URL}/`,
    founder: { "@id": `${SITE_URL}/#sam` },
    email: content.public_email || undefined,
    telephone: content.public_phone || undefined,
    priceRange: "$$",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Northern Beaches, Sydney",
      addressRegion: "NSW",
      addressCountry: "AU",
    },
    areaServed: ["Northern Beaches", "Sydney", "New South Wales", "Australia"],
    knowsAbout: [
      "Aerial photography",
      "Drone photography",
      "Landscape photography",
      "Travel photography",
    ],
    sameAs: sameAs.length ? sameAs : undefined,
  };
}

function person(content) {
  return {
    "@type": "Person",
    "@id": `${SITE_URL}/#sam`,
    name: "Sam Duckworth",
    jobTitle: "Photographer & Videographer",
    url: `${SITE_URL}/`,
    image: `${SITE_URL}/og-image.png`,
    sameAs: [content.instagram_url].filter(Boolean),
  };
}

function breadcrumbs(trail) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((entry, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: entry.name,
      item: `${SITE_URL}${entry.path}`,
    })),
  };
}

// ---------------------------------------------------------------- page write

async function writePage(shellBefore, shellAfter, route) {
  const html = `${shellBefore}${headFor(route)}${shellAfter}`;
  const file = route.path === "/"
    ? join(DIST, "index.html")
    : join(DIST, route.path.replace(/^\//, ""), "index.html");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html, "utf8");
}

// --------------------------------------------------------------------- main

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn("[prerender] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing — skipping prerender.");
    return;
  }

  const shell = await readFile(join(DIST, "index.html"), "utf8");
  const start = shell.indexOf("<!-- SEO:START -->");
  const end = shell.indexOf("<!-- SEO:END -->");
  if (start < 0 || end < 0) {
    throw new Error("index.html is missing its <!-- SEO:START --> / <!-- SEO:END --> markers.");
  }
  const shellBefore = shell.slice(0, start + "<!-- SEO:START -->".length) + "\n    ";
  const shellAfter = "\n    " + shell.slice(end);

  const PHOTO_COLUMNS =
    "id,title,slug,description,storage_bucket,storage_path,image_url,aspect,is_featured,is_published,in_shop,shop_order,sort_order,location_id,captured_at,created_at,updated_at";

  const [locations, photos, settingRows, contentRows] = await Promise.all([
    rest("locations?is_visible=eq.true&select=id,slug,name,region,description,sort_order&order=sort_order.asc&limit=200"),
    rest(
      `photos?is_published=eq.true&select=${PHOTO_COLUMNS}&order=sort_order.asc,captured_at.desc,created_at.desc&limit=2000`,
    ),
    rest("site_settings?select=key,value,enabled&limit=200"),
    rest("site_content?id=eq.1&select=site_name,public_email,public_phone,public_location,instagram_url,instagram_handle"),
  ]);

  const content = contentRows?.[0] ?? {};
  const settingValue = new Map(settingRows.map((row) => [row.key, row.value]));
  const locationById = new Map(locations.map((l) => [l.id, l]));

  // Only photos in a VISIBLE location reach the public gallery — "Unsorted"
  // (null location_id) and hidden places are admin-only. Mirrors publicPhotos
  // in App.tsx.
  const publicPhotos = photos.filter((p) => p.location_id && locationById.has(p.location_id));

  // The landing hero, resolved exactly the way Home does (App.tsx heroPhoto):
  // the admin-chosen site_settings.hero_photo, else featured wide/landscape.
  const chosenHeroId = settingValue.get("hero_photo");
  const wideish = (p) => p.aspect === "landscape" || p.aspect === "wide";
  const heroPhoto =
    (chosenHeroId && publicPhotos.find((p) => p.id === chosenHeroId)) ||
    publicPhotos.find((p) => p.is_featured && wideish(p)) ||
    publicPhotos.find((p) => p.aspect === "wide") ||
    publicPhotos.find((p) => p.aspect === "landscape") ||
    publicPhotos[0];

  // The Hero renders photo.imageUrl, which getGalleryData() builds at 1800/76 —
  // preload and boot payload must use that exact variant or the browser
  // downloads the image twice.
  const heroSrc = heroPhoto ? photoImage(heroPhoto, 1800, 76) : null;

  // The hero IS the home page's Largest Contentful Paint, and the transform
  // endpoint hands back whatever format the source is — a PNG source stays a
  // multi-megabyte PNG no matter the width. That is invisible in /admin, so
  // shout about it here, on every deploy, rather than letting a 7 MB hero sit
  // unnoticed. Advisory only: never fails the build.
  if (heroSrc) {
    try {
      const head = await fetch(heroSrc, { method: "HEAD" });
      const bytes = Number(head.headers.get("content-length") ?? 0);
      if (bytes > 1_500_000) {
        console.warn(
          `[prerender] WARNING: the landing hero is ${(bytes / 1e6).toFixed(1)} MB (${head.headers.get("content-type")}). ` +
            `Re-upload it as a WebP (or pick a different hero in /admin) — this is the home page's LCP image.`,
        );
      }
    } catch {
      // Network hiccup on an advisory check — not worth a word.
    }
  }

  const locationNames = [];
  for (const location of locations) {
    if (publicPhotos.some((p) => p.location_id === location.id)) locationNames.push(location.name);
  }

  const graph = [person(content), localBusiness(content)];
  const homeGraph = { "@context": "https://schema.org", "@graph": graph };

  const routes = [];

  // -- home ----------------------------------------------------------------
  routes.push({
    path: "/",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    image: heroSrc ?? `${SITE_URL}/api/og-image`,
    preloadImage: heroSrc ?? undefined,
    structuredData: [
      homeGraph,
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        publisher: { "@id": `${SITE_URL}/#business` },
      },
    ],
    // Read synchronously by src/lib/boot.ts so the hero paints immediately.
    // Strictly a HINT — the admin can change the hero without a redeploy, so
    // live Supabase data always wins once it lands.
    boot: {
      hero: heroPhoto
        ? {
            id: heroPhoto.id,
            title: heroPhoto.title,
            location: locationById.get(heroPhoto.location_id)?.name ?? "",
            aspect: heroPhoto.aspect,
            imageUrl: heroSrc,
          }
        : null,
      locations: locationNames,
      content: {
        siteName: content.site_name ?? undefined,
        publicEmail: content.public_email ?? undefined,
        publicPhone: content.public_phone ?? undefined,
        publicLocation: content.public_location ?? undefined,
        instagramHandle: content.instagram_handle ?? undefined,
        instagramUrl: content.instagram_url ?? undefined,
      },
    },
  });

  // -- galleries -----------------------------------------------------------
  routes.push({
    path: "/galleries",
    title: "Gallery — Sam Duckworth Photography",
    description:
      "Browse the full archive of aerial, coastal and travel photography by Sam Duckworth, by place and by trip.",
    image: heroSrc ?? undefined,
    structuredData: [
      breadcrumbs([{ name: "Home", path: "/" }, { name: "Gallery", path: "/galleries" }]),
      { "@context": "https://schema.org", "@type": "CollectionPage", name: "Gallery", url: `${SITE_URL}/galleries` },
    ],
  });

  for (const location of locations) {
    const inLocation = publicPhotos.filter((p) => p.location_id === location.id);
    if (!inLocation.length) continue;
    const cover = inLocation.find(wideish) ?? inLocation[0];
    const description =
      location.description ||
      `Aerial and landscape photography from ${location.name}${location.region ? `, ${location.region}` : ""} — ${inLocation.length} photograph${inLocation.length === 1 ? "" : "s"} by Sam Duckworth.`;
    routes.push({
      path: `/galleries/${location.slug}`,
      title: `${location.name} — Aerial & Landscape Photography | Sam Duckworth`,
      description,
      image: photoImage(cover, 1200),
      structuredData: [
        {
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: `${location.name} photography`,
          description,
          url: `${SITE_URL}/galleries/${location.slug}`,
          isPartOf: { "@id": `${SITE_URL}/#website` },
          about: { "@type": "Place", name: location.name },
          // A representative sample, not the whole set — enough for image
          // search to associate the place with real photographs.
          hasPart: inLocation.slice(0, 12).map((photo) => ({
            "@type": "ImageObject",
            name: photo.title,
            caption: photo.description || `${photo.title}, ${location.name}`,
            contentUrl: photoImage(photo, 1800, 76),
            thumbnailUrl: photoImage(photo, 700),
            creator: { "@id": `${SITE_URL}/#sam` },
            copyrightNotice: `© ${SITE_NAME}`,
          })),
        },
        breadcrumbs([
          { name: "Home", path: "/" },
          { name: "Gallery", path: "/galleries" },
          { name: location.name, path: `/galleries/${location.slug}` },
        ]),
      ],
    });
  }

  // -- map / work ----------------------------------------------------------
  routes.push({
    path: "/map",
    title: "Photo Map — Sam Duckworth Photography",
    description:
      "Every photograph placed where it was taken — explore the archive by location on an interactive map.",
    image: heroSrc ?? undefined,
    structuredData: breadcrumbs([{ name: "Home", path: "/" }, { name: "Map", path: "/map" }]),
  });

  routes.push({
    path: "/work",
    title: "Professional Photography — Real Estate, Events & Brand Work | Sam Duckworth",
    description:
      "Aerial and ground photography for real estate listings, live events and brand campaigns, by Sam Duckworth — based on Sydney's Northern Beaches.",
    image: heroSrc ?? undefined,
    structuredData: [
      {
        "@context": "https://schema.org",
        "@graph": [
          ...graph,
          {
            "@type": "Service",
            serviceType: "Photography",
            name: "Professional photography — real estate, events & brand work",
            description:
              "Aerial and ground photography for real estate listings, live events and brand campaigns.",
            provider: { "@id": `${SITE_URL}/#business` },
            areaServed: ["Northern Beaches", "Sydney", "New South Wales", "Australia"],
            url: `${SITE_URL}/work`,
          },
        ],
      },
      breadcrumbs([{ name: "Home", path: "/" }, { name: "Professional work", path: "/work" }]),
    ],
  });

  // -- shop ----------------------------------------------------------------
  const shopPhotos = publicPhotos
    .filter((p) => p.in_shop && p.slug)
    .sort((a, b) => (a.shop_order ?? 1e9) - (b.shop_order ?? 1e9));

  routes.push({
    path: "/shop",
    title: "Framed Editions — Sam Duckworth Photography",
    description:
      "Fine-art aerial and coastal photography prints by Sam Duckworth, professionally framed in Australia and delivered Australia-wide.",
    image: shopPhotos[0] ? photoImage(shopPhotos[0], 1200) : heroSrc ?? undefined,
    structuredData: [
      breadcrumbs([{ name: "Home", path: "/" }, { name: "Framed Editions", path: "/shop" }]),
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Framed Editions",
        url: `${SITE_URL}/shop`,
        isPartOf: { "@id": `${SITE_URL}/#website` },
      },
    ],
  });

  // The Product price is the genuinely cheapest way to own an A5 — the same
  // "From $X" the gallery tiles and configurator show (cheapestPriceForSize in
  // src/lib/printCatalogue.ts: min of print-only, unmounted and mounted, natural
  // frame, clear glazing, archival matte). Computed from the same pricing
  // tables checkout charges from (server/shop/catalogue.mjs); fetchPricing
  // falls back wholesale, margin included, exactly like the browser now does.
  const livePricing = await fetchPricing(rest);
  const a5Cents = Math.min(
    priceCentsFor({ size: "A5", framed: false }, livePricing),
    priceCentsFor({ size: "A5", mounted: false, colour: "natural", glazing: "clear" }, livePricing),
    priceCentsFor({ size: "A5", mounted: true, colour: "natural", glazing: "clear" }, livePricing),
  );
  const basePrice = (a5Cents / 100).toFixed(2);

  for (const photo of shopPhotos) {
    const location = locationById.get(photo.location_id)?.name ?? "";
    const description = `${photo.title}, ${location} — a fine-art photography print by Sam Duckworth, framed to order in Australia.`;
    const image = photoImage(photo, 1200);
    routes.push({
      path: `/shop/${photo.slug}`,
      title: `${photo.title} print — Sam Duckworth Photography`,
      description,
      image,
      type: "product",
      structuredData: [
        {
          "@context": "https://schema.org",
          "@type": "Product",
          name: `${photo.title} — Framed photographic print`,
          description,
          image,
          url: `${SITE_URL}/shop/${photo.slug}`,
          category: "Fine-art photography print",
          material: "Archival fine-art paper with professional frame",
          brand: { "@type": "Brand", name: SITE_NAME },
          offers: {
            "@type": "Offer",
            priceCurrency: "AUD",
            price: basePrice,
            availability: "https://schema.org/InStock",
            itemCondition: "https://schema.org/NewCondition",
            url: `${SITE_URL}/shop/${photo.slug}`,
            seller: { "@type": "Organization", name: SITE_NAME },
            shippingDetails: {
              "@type": "OfferShippingDetails",
              shippingDestination: { "@type": "DefinedRegion", addressCountry: "AU" },
            },
          },
        },
        breadcrumbs([
          { name: "Home", path: "/" },
          { name: "Framed Editions", path: "/shop" },
          { name: photo.title, path: `/shop/${photo.slug}` },
        ]),
      ],
    });
  }

  const POLICIES = [
    { id: "shipping", title: "Shipping & delivery", intro: "Prints are made to order and currently delivered within Australia only." },
    { id: "returns", title: "Returns, damage & cancellations", intro: "We want your print to arrive in excellent condition and match what you ordered." },
    { id: "privacy", title: "Privacy policy", intro: "This explains what information the shop uses and why." },
    { id: "terms", title: "Terms of purchase", intro: "These terms apply when you order a print from Sam Duckworth Photography." },
  ];
  for (const policy of POLICIES) {
    routes.push({
      path: `/shop/policies/${policy.id}`,
      title: `${policy.title} — ${SITE_NAME}`,
      description: `${policy.intro} Shop policies for made-to-order photography prints from ${SITE_NAME}.`,
      structuredData: breadcrumbs([
        { name: "Home", path: "/" },
        { name: "Framed Editions", path: "/shop" },
        { name: policy.title, path: `/shop/policies/${policy.id}` },
      ]),
    });
  }

  routes.push({
    path: "/shop/gift-voucher",
    title: `Gift vouchers — ${SITE_NAME}`,
    description: "A gift voucher for a fine-art photography print by Sam Duckworth — the recipient chooses the photograph, size and frame.",
    structuredData: breadcrumbs([
      { name: "Home", path: "/" },
      { name: "Framed Editions", path: "/shop" },
      { name: "Gift vouchers", path: "/shop/gift-voucher" },
    ]),
  });

  for (const route of routes) await writePage(shellBefore, shellAfter, route);

  // The sitemap is generated here too, from the same rows — one query pass, no
  // runtime function, and lastmod values that are actually true.
  await writeSitemap({ locations, publicPhotos, shopPhotos });

  console.log(
    `[prerender] wrote ${routes.length} HTML files (${locationNames.length} places, ${shopPhotos.length} products) + sitemap.xml`,
  );
}

async function writeSitemap({ locations, publicPhotos, shopPhotos }) {
  const today = new Date().toISOString().slice(0, 10);
  const entries = [];
  const add = (path, lastmod, priority, changefreq) =>
    entries.push(
      [
        "  <url>",
        `    <loc>${esc(`${SITE_URL}${path}`)}</loc>`,
        `    <lastmod>${lastmod ?? today}</lastmod>`,
        `    <changefreq>${changefreq}</changefreq>`,
        `    <priority>${priority}</priority>`,
        "  </url>",
      ].join("\n"),
    );

  const newest = (rows) =>
    isoDay(rows.map((r) => r.updated_at ?? r.created_at).filter(Boolean).sort().at(-1));

  add("/", newest(publicPhotos), "1.0", "weekly");
  add("/galleries", newest(publicPhotos), "0.9", "weekly");
  add("/work", null, "0.8", "monthly");
  add("/map", newest(publicPhotos), "0.7", "monthly");
  add("/shop", newest(shopPhotos), "0.9", "weekly");
  add("/shop/gift-voucher", null, "0.5", "monthly");

  for (const location of locations) {
    const inLocation = publicPhotos.filter((p) => p.location_id === location.id);
    if (!inLocation.length) continue;
    add(`/galleries/${location.slug}`, newest(inLocation), "0.6", "monthly");
  }
  for (const photo of shopPhotos) {
    add(`/shop/${photo.slug}`, isoDay(photo.updated_at ?? photo.created_at), "0.7", "monthly");
  }
  for (const id of ["shipping", "returns"]) add(`/shop/policies/${id}`, null, "0.3", "yearly");
  for (const id of ["privacy", "terms"]) add(`/shop/policies/${id}`, null, "0.2", "yearly");

  await writeFile(
    join(DIST, "sitemap.xml"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...entries,
      "</urlset>",
      "",
    ].join("\n"),
    "utf8",
  );
}

main().catch(async (error) => {
  // A prerender failure must never take the deploy down: the SPA still works,
  // it just ships the generic head until the next successful build.
  console.warn(`[prerender] skipped — ${error.message}`);
  // There is no /api/sitemap function any more, so a skipped prerender would
  // otherwise leave /sitemap.xml missing entirely. Write the core routes at
  // least — they need no data from Supabase.
  try {
    const core = ["/", "/galleries", "/shop", "/work", "/map"];
    await writeFile(
      join(DIST, "sitemap.xml"),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...core.map((path) => `  <url><loc>${SITE_URL}${path === "/" ? "/" : path}</loc></url>`),
        "</urlset>",
        "",
      ].join("\n"),
      "utf8",
    );
    console.warn("[prerender] wrote a core-routes sitemap.xml as a fallback");
  } catch (fallbackError) {
    console.warn(`[prerender] could not write a fallback sitemap — ${fallbackError.message}`);
  }
});
