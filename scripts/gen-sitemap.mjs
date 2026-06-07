// Generate public/sitemap.xml from the live gallery: the home, galleries and map
// pages plus one URL per published location. Run with:
//   node --env-file=.env.local scripts/gen-sitemap.mjs
// Re-run after adding locations (or wire into the build). Read-only (anon key).
import { createClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SITE = (process.env.VITE_SITE_URL || "https://samduckworth.com").replace(/\/$/, "");
if (!url || !key) throw new Error("Missing VITE_SUPABASE_URL / key in env (use --env-file=.env.local).");

const sb = createClient(url, key);
const { data, error } = await sb
  .from("photos")
  .select("locations(name)")
  .eq("is_published", true);
if (error) throw error;

const names = [...new Set((data ?? [])
  .map((r) => r.locations?.name)
  .filter((n) => n && n !== "Unsorted"))]
  .sort();

const today = new Date().toISOString().slice(0, 10);
const entries = [
  { loc: `${SITE}/`, pri: "1.0" },
  { loc: `${SITE}/galleries`, pri: "0.8" },
  { loc: `${SITE}/map`, pri: "0.6" },
  ...names.map((n) => ({ loc: `${SITE}/galleries?location=${encodeURIComponent(n)}`, pri: "0.7" })),
];

const xml =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  entries
    .map((e) => `  <url>\n    <loc>${e.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${e.pri}</priority>\n  </url>`)
    .join("\n") +
  `\n</urlset>\n`;

await writeFile("public/sitemap.xml", xml);
console.log(`Wrote public/sitemap.xml — ${entries.length} URLs (${names.length} locations).`);
