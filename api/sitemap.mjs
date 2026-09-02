// Fallback sitemap. The real one is generated at build time by
// scripts/prerender.mjs straight into dist/sitemap.xml, from the same rows it
// prerenders — Vercel serves that static file and never reaches this handler.
// This exists for a build where the prerender was skipped (no Supabase env at
// build time), so /sitemap.xml is never a 404.
//
// Both list the SAME canonical URL shapes: /galleries/<location-slug> and
// /shop/<slug>. The old `/galleries?location=Name` query URLs are gone — they
// were ~670 near-duplicate parameter URLs that Google mostly ignores, and the
// slug pages are now prerendered with their own tags. /portfolio is
// deliberately absent: it is indexable but is not photography.
const SITE_URL = "https://www.samduckworth.com";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function publicRows(path) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!response.ok) throw new Error(`Supabase sitemap query failed (${response.status})`);
  return response.json();
}

const isoDay = (value) => (value ? String(value).slice(0, 10) : new Date().toISOString().slice(0, 10));

function urlEntry(path, priority, changefreq = "weekly", lastmod = null) {
  return [
    "  <url>",
    `    <loc>${escapeXml(`${SITE_URL}${path}`)}</loc>`,
    `    <lastmod>${isoDay(lastmod)}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    "  </url>",
  ].join("\n");
}

export default async function handler(_request, response) {
  response.setHeader("Content-Type", "application/xml; charset=utf-8");
  response.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");

  let products = [];
  let locations = [];
  let places = [];
  try {
    [products, locations, places] = await Promise.all([
      publicRows("photos?is_published=eq.true&in_shop=eq.true&slug=not.is.null&select=slug,updated_at,created_at&order=shop_order.asc.nullslast&limit=1000"),
      // is_visible only: a hidden place (e.g. the legacy "Travels" bucket)
      // must not be advertised.
      publicRows("locations?is_visible=eq.true&select=id,slug&order=sort_order.asc&limit=200"),
      publicRows("photos?is_published=eq.true&location_id=not.is.null&select=location_id,updated_at,created_at&limit=2000"),
    ]);
  } catch {
    // Core routes remain discoverable if Supabase is temporarily unavailable.
  }

  const newestByLocation = new Map();
  for (const photo of places) {
    const stamp = photo.updated_at ?? photo.created_at ?? null;
    const current = newestByLocation.get(photo.location_id);
    if (!current || (stamp && stamp > current)) newestByLocation.set(photo.location_id, stamp);
  }
  const newestOverall = [...newestByLocation.values()].filter(Boolean).sort().at(-1) ?? null;

  const entries = [
    urlEntry("/", "1.0", "weekly", newestOverall),
    urlEntry("/galleries", "0.9", "weekly", newestOverall),
    urlEntry("/work", "0.8", "monthly"),
    urlEntry("/map", "0.7", "monthly", newestOverall),
    urlEntry("/shop", "0.9", "weekly"),
    urlEntry("/shop/policies/shipping", "0.3", "yearly"),
    urlEntry("/shop/policies/returns", "0.3", "yearly"),
    urlEntry("/shop/policies/privacy", "0.2", "yearly"),
    urlEntry("/shop/policies/terms", "0.2", "yearly"),
    ...locations
      .filter((location) => location?.slug && newestByLocation.has(location.id))
      .map((location) => urlEntry(`/galleries/${encodeURIComponent(location.slug)}`, "0.6", "monthly", newestByLocation.get(location.id))),
    ...products
      .filter((product) => product?.slug)
      .map((product) => urlEntry(`/shop/${encodeURIComponent(product.slug)}`, "0.7", "monthly", product.updated_at ?? product.created_at)),
  ];

  response.status(200).send([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    "</urlset>",
  ].join("\n"));
}
