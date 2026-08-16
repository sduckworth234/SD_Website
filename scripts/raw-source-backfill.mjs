// Backfills photos.raw_source_path / raw_width / raw_height / raw_match_confidence /
// raw_match_notes from imports/photo-source-lookup.json (built by a one-off drive
// audit — see supabase/migrations/20260816010000_photo_raw_source.sql).
// Requires that migration to be applied first (Sam runs it by hand in the SQL editor).
// Run with: node --env-file=.env.local scripts/raw-source-backfill.mjs
// DRY_RUN=1 to preview without writing.
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

const DRY_RUN = process.env.DRY_RUN === "1";
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const lookup = JSON.parse(await readFile("imports/photo-source-lookup.json", "utf8"));

let updated = 0, skipped = 0;
for (const p of lookup) {
  const patch = {
    raw_source_path: p.raw_path || null,
    raw_width: p.raw_width || null,
    raw_height: p.raw_height || null,
    raw_match_confidence: p.raw_match_confidence || null,
    raw_match_notes: p.raw_match_notes || null,
  };

  if (DRY_RUN) {
    console.log(`[dry-run] ${p.title} (${p.id}) ->`, patch);
    updated++;
    continue;
  }

  const { error } = await supabase.from("photos").update(patch).eq("id", p.id);
  if (error) {
    console.error(`FAILED ${p.title} (${p.id}):`, error.message);
    skipped++;
  } else {
    updated++;
  }
}

console.log(`\n${DRY_RUN ? "[dry-run] would update" : "Updated"} ${updated}, failed ${skipped}, total ${lookup.length}`);
