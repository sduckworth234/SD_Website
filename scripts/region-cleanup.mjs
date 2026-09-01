#!/usr/bin/env node
// Tidy the two taxonomies the galleries page filters on:
//
//   1. `series` (the UI's "Collections") — three visible rows were all named
//      "Europe", told apart only by their `period`. Give each a unique name
//      ("Europe 2026" / "Europe 2024" / "Europe 2022") while keeping the slugs,
//      so every shared link and `hero_2026_collection` keeps working.
//   2. `locations.region` — collapse the ad-hoc regions onto a small fixed set
//      (Northern Beaches / Sydney / New South Wales / Australia / Europe) and
//      move the misfiled places (Jindabyne and Hunter Valley were "Northern
//      Beaches"; Pie in the Sky is Cowan, in Sydney; the South Coast and
//      Freemans Waterhole rows were the catch-all "Australia").
//
// Idempotent, and a DRY RUN by default — nothing is written unless APPLY=1.
//
//   node --env-file=.env.local scripts/region-cleanup.mjs          # preview
//   APPLY=1 node --env-file=.env.local scripts/region-cleanup.mjs  # write
//
// Needs SUPABASE_SERVICE_ROLE_KEY (server-only; see CLAUDE.md).

import { createClient } from "@supabase/supabase-js";

const APPLY = process.env.APPLY === "1";
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run with --env-file=.env.local.");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

// The fixed region set. Keep in sync with REGION_ORDER in src/lib/regions.ts.
const REGIONS = ["Northern Beaches", "Sydney", "New South Wales", "Australia", "Europe"];

// Collections that share a name. Keyed by slug so the public URLs never move.
const SERIES_NAMES = {
  "europe-2026": "Europe 2026",
  "europe-2024": "Europe 2024",
  "europe-2022": "Europe 2022",
};

// Places whose region was wrong. Keyed by location slug.
const REGION_BY_SLUG = {
  jindabyne: "New South Wales",        // Snowy Mountains, not the Northern Beaches
  "hunter-valley": "New South Wales",
  "freemans-waterhole": "New South Wales",
  "denhams-beach": "New South Wales",  // South Coast
  "malua-bay": "New South Wales",      // South Coast
  "pie-in-the-sky": "Sydney",          // Cowan, Hornsby LGA
  sydney: "Sydney",
  travels: "Australia",                // legacy catch-all, hidden below
};

// Anything still outside the fixed set lands in the broadest sensible bucket.
const FALLBACK_REGION = "Australia";

const [{ data: locations, error: locError }, { data: series, error: seriesError }, { data: photos, error: photoError }] =
  await Promise.all([
    sb.from("locations").select("id, slug, name, region, is_visible").order("name"),
    sb.from("series").select("id, slug, name, period, subtitle, is_visible").order("sort_order"),
    sb.from("photos").select("id, title, slug, location_id, is_published"),
  ]);
if (locError) throw locError;
if (seriesError) throw seriesError;
if (photoError) throw photoError;

const publishedByLocation = new Map();
for (const photo of photos) {
  if (!photo.is_published || !photo.location_id) continue;
  publishedByLocation.set(photo.location_id, (publishedByLocation.get(photo.location_id) ?? 0) + 1);
}

console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (set APPLY=1 to write) ===");

// ---- 1. Collections -------------------------------------------------------
const seriesUpdates = [];
for (const row of series) {
  const wanted = SERIES_NAMES[row.slug];
  if (!wanted || row.name === wanted) continue;
  seriesUpdates.push({ id: row.id, slug: row.slug, from: row.name, to: wanted });
}
console.log("\nCollections (series):");
if (!seriesUpdates.length) console.log("  nothing to rename");
for (const u of seriesUpdates) console.log(`  ${u.slug}: "${u.from}" -> "${u.to}"`);

// The rail prints `period` over `name`, so "2026" + "Europe 2026" would read
// "2026 / EUROPE 2026". The app now strips the repeat at render time
// (collectionDisplayName in src/types.ts) — flag it here so it stays visible.
for (const row of series) {
  const wanted = SERIES_NAMES[row.slug] ?? row.name;
  if (row.period && wanted.toLowerCase().includes(row.period.trim().toLowerCase())) {
    console.log(`  note: ${row.slug} keeps period "${row.period}"; the rail de-duplicates it against "${wanted}"`);
  }
}

// ---- 2. Regions -----------------------------------------------------------
const locationUpdates = [];
for (const loc of locations) {
  const current = (loc.region ?? "").trim();
  const wanted = REGION_BY_SLUG[loc.slug] ?? (REGIONS.includes(current) ? current : FALLBACK_REGION);
  if (wanted === current) continue;
  locationUpdates.push({ id: loc.id, name: loc.name, slug: loc.slug, from: current || "(none)", to: wanted });
}
console.log("\nLocation regions:");
if (!locationUpdates.length) console.log("  nothing to move");
for (const u of locationUpdates) console.log(`  ${u.name} (${u.slug}): ${u.from} -> ${u.to}`);

// ---- 3. The legacy "Travels" bucket ---------------------------------------
const travels = locations.find((l) => l.slug === "travels");
let hideTravels = false;
console.log("\nLegacy \"Travels\" location:");
if (!travels) {
  console.log("  absent");
} else {
  const count = publishedByLocation.get(travels.id) ?? 0;
  const all = photos.filter((p) => p.location_id === travels.id);
  console.log(`  ${all.length} photos total, ${count} published, visible=${travels.is_visible}`);
  for (const p of all) console.log(`    - ${p.title} (${p.slug}, published=${p.is_published})`);
  if (count === 0 && travels.is_visible) {
    hideTravels = true;
    console.log("  -> no published photos: hiding it (is_visible=false)");
  } else if (count === 0) {
    console.log("  -> already hidden");
  } else {
    console.log("  -> HAS published photos: left visible. Move them to a real place first.");
  }
}

// ---- 4. Resulting shape ---------------------------------------------------
const regionTotals = new Map();
for (const loc of locations) {
  const wanted = REGION_BY_SLUG[loc.slug] ?? (REGIONS.includes((loc.region ?? "").trim()) ? loc.region.trim() : FALLBACK_REGION);
  const hidden = loc.slug === "travels" && (hideTravels || !loc.is_visible);
  if (hidden) continue;
  regionTotals.set(wanted, (regionTotals.get(wanted) ?? 0) + (publishedByLocation.get(loc.id) ?? 0));
}
console.log("\nPublished photos per region afterwards:");
for (const region of REGIONS) console.log(`  ${region}: ${regionTotals.get(region) ?? 0}`);

if (!APPLY) {
  console.log("\nDry run only. Re-run with APPLY=1 to write.");
  process.exit(0);
}

for (const u of seriesUpdates) {
  const { error } = await sb.from("series").update({ name: u.to }).eq("id", u.id);
  if (error) throw error;
  console.log(`renamed series ${u.slug} -> ${u.to}`);
}
for (const u of locationUpdates) {
  const { error } = await sb.from("locations").update({ region: u.to }).eq("id", u.id);
  if (error) throw error;
  console.log(`moved ${u.name} -> ${u.to}`);
}
if (hideTravels) {
  const { error } = await sb.from("locations").update({ is_visible: false }).eq("id", travels.id);
  if (error) throw error;
  console.log("hid the empty \"Travels\" location");
}
console.log("\nDone.");
