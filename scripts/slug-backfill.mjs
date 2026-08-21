// Regenerate photos.slug from the current title for every photo whose slug
// doesn't already read that way — cleans up slugs left over from the old
// filename/location+hash generation (e.g. "dji-20231130060558-0014-d-62b7642dfb1a"
// for a photo titled "The Pines") into readable ones ("the-pines"). Safe to
// re-run: rows whose slug already matches slugify(title) are left untouched.
//
//   node --env-file=.env.local scripts/slug-backfill.mjs
// Knobs: DRY_RUN=1 (report only, no writes)

import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (use --env-file=.env.local)");
  process.exit(1);
}
const supabase = createClient(url, key);
const DRY_RUN = process.env.DRY_RUN === "1";

function slugify(value) {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const { data: rows, error } = await supabase
  .from("photos")
  .select("id, title, slug")
  .order("created_at", { ascending: true });
if (error) {
  console.error("Could not list photos:", error.message);
  process.exit(1);
}

const usedSlugs = new Set(rows.map((r) => r.slug).filter(Boolean));

let changed = 0;
let unchanged = 0;
for (const row of rows) {
  const base = slugify(row.title) || "untitled";
  if (row.slug === base) {
    unchanged += 1;
    continue;
  }
  // Reserve the clean base for this row first (removing its own old slug
  // from the pool so it doesn't collide with itself), then dedupe against
  // everything else.
  usedSlugs.delete(row.slug);
  let candidate = base;
  let n = 2;
  while (usedSlugs.has(candidate)) candidate = `${base}-${n++}`;
  usedSlugs.add(candidate);

  console.log(`${row.slug}  ->  ${candidate}   (${row.title})`);
  if (!DRY_RUN) {
    const { error: updErr } = await supabase.from("photos").update({ slug: candidate }).eq("id", row.id);
    if (updErr) {
      console.error(`  failed: ${updErr.message}`);
      continue;
    }
  }
  changed += 1;
}

console.log(`${changed} slug(s) ${DRY_RUN ? "would change" : "changed"}, ${unchanged} already clean.`);
