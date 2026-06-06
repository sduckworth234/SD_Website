// Backfill photos.source_path from the import manifests: for every uploaded
// photo, look up the original full-res file it was made from (storage_path ->
// sourcePath) and write that path onto the row. This is the website->file half
// of the two-way link — find the original when someone wants to buy a print.
//
// Pure manifest lookup (no /Volumes reads needed). Idempotent: re-running writes
// the same value. Photos with no manifest entry or no storage_path are left for
// manual entry via the admin edit panel.
//
// Requires the source_path column (migration 202606060001) to exist first.
// Usage: DRY_RUN=1 node --env-file=.env.local scripts/source-path-backfill.mjs
import { readFile, readdir } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const dryRun = process.env.DRY_RUN === "1";

// Build storage_path -> sourcePath from every manifest in imports/.
const manifestFiles = (await readdir("imports"))
  .filter((f) => /manifest.*\.json$/i.test(f))
  .map((f) => `imports/${f}`);

const map = new Map();
for (const f of manifestFiles) {
  try {
    const j = JSON.parse(await readFile(f, "utf8"));
    for (const e of j.uploaded || j) {
      if (e.storagePath && e.sourcePath) map.set(e.storagePath, e.sourcePath);
    }
  } catch (err) {
    console.warn(`(skip manifest ${f}: ${err.message})`);
  }
}
console.log(`Manifests: ${manifestFiles.length} | storage_path -> sourcePath entries: ${map.size}`);

const { data: photos, error } = await sb
  .from("photos")
  .select("id, title, storage_path, source_path, locations(name)");
if (error) throw error;

const updates = [];
const noStorage = [];
const unmapped = [];
for (const p of photos) {
  if (!p.storage_path) { noStorage.push(p); continue; }
  const src = map.get(p.storage_path);
  if (!src) { unmapped.push(p); continue; }
  if (p.source_path === src) continue; // already set, skip
  updates.push({ id: p.id, source_path: src, label: `${p.locations?.name ?? "?"} / ${p.title}` });
}

console.log(`\nPhotos: ${photos.length}`);
console.log(`  to write source_path : ${updates.length}`);
console.log(`  already set          : ${photos.filter((p) => p.storage_path && map.get(p.storage_path) === p.source_path && p.source_path).length}`);
console.log(`  no manifest entry    : ${unmapped.length}${unmapped.length ? "  (set manually in /admin)" : ""}`);
console.log(`  no storage_path      : ${noStorage.length}${noStorage.length ? "  (seed/external rows; set manually)" : ""}`);
for (const p of unmapped.slice(0, 20)) console.log(`     - ${p.locations?.name ?? "?"} / ${p.title}`);

if (dryRun) {
  console.log("\n[DRY] no writes. Sample of planned updates:");
  for (const u of updates.slice(0, 8)) console.log(`  ${u.label}\n      -> ${u.source_path}`);
  process.exit(0);
}

let done = 0;
for (const u of updates) {
  const { error: e } = await sb.from("photos").update({ source_path: u.source_path }).eq("id", u.id);
  if (e) throw e;
  done += 1;
  if (done % 50 === 0) console.log(`...${done}/${updates.length}`);
}
console.log(`\nUpdated ${done} photos with source_path.`);
