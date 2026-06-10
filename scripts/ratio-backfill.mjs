// Backfill photos.ratio (width / height) by reading each stored image's
// dimensions. Uses a small storage transform (400px) — the ratio is identical
// at any size and the download stays tiny. Idempotent: rows with a ratio are
// skipped, so it's safe to re-run after every import until the import script
// writes ratio itself.
//
// Run AFTER applying supabase/migrations/202606100002_photo_ratio.sql:
//   node --env-file=.env.local scripts/ratio-backfill.mjs
// Knobs: DRY_RUN=1 (report only), LIMIT=n (first n missing rows).

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (use --env-file=.env.local)");
  process.exit(1);
}
const supabase = createClient(url, key);
const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT) || 0;

const { data: rows, error } = await supabase
  .from("photos")
  .select("id, title, storage_bucket, storage_path, ratio")
  .is("ratio", null)
  .not("storage_path", "is", null)
  .order("created_at", { ascending: true });
if (error) {
  console.error("Could not list photos (has the ratio migration been applied?):", error.message);
  process.exit(1);
}

const todo = LIMIT ? rows.slice(0, LIMIT) : rows;
console.log(`${rows.length} photo(s) missing ratio; processing ${todo.length}${DRY_RUN ? " (dry run)" : ""}.`);

let ok = 0;
let failed = 0;
for (const row of todo) {
  try {
    const { data } = supabase.storage
      .from(row.storage_bucket)
      .getPublicUrl(row.storage_path, { transform: { width: 400, resize: "contain" } });
    const res = await fetch(data.publicUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) throw new Error("no dimensions");
    const ratio = Number((meta.width / meta.height).toFixed(4));
    if (DRY_RUN) {
      console.log(`would set ${ratio}  ${row.title} (${row.storage_path})`);
    } else {
      const { error: updateError } = await supabase.from("photos").update({ ratio }).eq("id", row.id);
      if (updateError) throw updateError;
      console.log(`set ${ratio}  ${row.title}`);
    }
    ok += 1;
  } catch (err) {
    failed += 1;
    console.warn(`FAILED  ${row.title} (${row.storage_path}): ${err.message}`);
  }
}
console.log(`Done: ${ok} set, ${failed} failed.`);
