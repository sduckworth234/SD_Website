// Warm the Supabase image-transform CDN: request every grid srcset variant of
// every published photo once, so real visitors get cache HITs instead of
// paying the cold per-variant generation cost (the "first load trickles in"
// effect). Safe to run any time; re-run after a big import.
//
//   node --env-file=.env.local scripts/warm-transforms.mjs
// Knobs: LIMIT=n (first n photos), WIDTHS=400,700 (override variant widths).

import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (use --env-file=.env.local)");
  process.exit(1);
}
const supabase = createClient(url, key);

// Keep in sync with SRCSET_WIDTHS in src/App.tsx (+1800 is also the lightbox/hero size).
const WIDTHS = (process.env.WIDTHS ?? "400,700,1000,1400,1800").split(",").map(Number);
const LIMIT = Number(process.env.LIMIT) || 0;
const CONCURRENCY = 8;

const { data: rows, error } = await supabase
  .from("photos")
  .select("storage_bucket, storage_path")
  .eq("is_published", true)
  .not("storage_path", "is", null);
if (error) {
  console.error(error.message);
  process.exit(1);
}

const photos = LIMIT ? rows.slice(0, LIMIT) : rows;
const jobs = photos.flatMap((row) =>
  WIDTHS.map(
    (width) =>
      supabase.storage
        .from(row.storage_bucket)
        .getPublicUrl(row.storage_path, { transform: { width, quality: width >= 1800 ? 76 : 72, resize: "contain" } })
        .data.publicUrl,
  ),
);
console.log(`Warming ${jobs.length} variant URLs (${photos.length} photos × ${WIDTHS.length} widths)…`);

let hit = 0;
let miss = 0;
let failed = 0;
let i = 0;
async function worker() {
  while (i < jobs.length) {
    const u = jobs[i++];
    try {
      const res = await fetch(u, { method: "GET" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Drain minimally; the CDN caches regardless once generated.
      await res.arrayBuffer();
      const status = res.headers.get("cf-cache-status") ?? "?";
      if (status === "HIT") hit += 1;
      else miss += 1;
      if ((hit + miss) % 100 === 0) console.log(`…${hit + miss}/${jobs.length} (${hit} already hot)`);
    } catch (err) {
      failed += 1;
      console.warn(`FAILED ${u}: ${err.message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`Done: ${hit} were already cached, ${miss} generated/warmed, ${failed} failed.`);
