const SITE_URL = "https://www.samduckworth.com";
const LAST_MODIFIED = "2026-08-17";
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

function urlEntry(path, priority, changefreq = "weekly") {
  return [
    "  <url>",
    `    <loc>${escapeXml(`${SITE_URL}${path}`)}</loc>`,
    `    <lastmod>${LAST_MODIFIED}</lastmod>`,
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
  try {
    [products, locations] = await Promise.all([
      publicRows("photos?is_published=eq.true&in_shop=eq.true&slug=not.is.null&select=slug&order=shop_order.asc.nullslast&limit=1000"),
      publicRows("locations?is_visible=eq.true&select=name&order=sort_order.asc&limit=100"),
    ]);
  } catch {
    // Core routes remain discoverable if Supabase is temporarily unavailable.
  }

  const entries = [
    urlEntry("/", "1.0", "weekly"),
    urlEntry("/galleries", "0.9", "weekly"),
    urlEntry("/map", "0.7", "monthly"),
    urlEntry("/shop", "0.9", "weekly"),
    urlEntry("/shop/policies/shipping", "0.3", "yearly"),
    urlEntry("/shop/policies/returns", "0.3", "yearly"),
    urlEntry("/shop/policies/privacy", "0.2", "yearly"),
    urlEntry("/shop/policies/terms", "0.2", "yearly"),
    ...locations
      .filter((location) => location?.name)
      .map((location) => urlEntry(`/galleries?location=${encodeURIComponent(location.name)}`, "0.6", "monthly")),
    ...products
      .filter((product) => product?.slug)
      .map((product) => urlEntry(`/shop/${encodeURIComponent(product.slug)}`, "0.7", "monthly")),
  ];

  response.status(200).send([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    "</urlset>",
  ].join("\n"));
}
