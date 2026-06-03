import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const manifestPath = process.argv[2] ?? "imports/uploaded-drone-manifest.json";
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.");
}

const supabase = createClient(supabaseUrl, supabaseKey);
const manifest = JSON.parse(await readFile(manifestPath, "utf8")).uploaded;

const { data: locations, error: locationError } = await supabase
  .from("locations")
  .select("id, name, slug");

if (locationError) throw locationError;

const locationByName = new Map(locations.map((location) => [location.name, location.id]));
const rows = manifest.map((photo) => ({
  title: photo.locationName,
  slug: `${slugify(photo.locationName) || "photo"}-${photo.slug.split("-").at(-1)}`,
  description: photo.description,
  location_id: locationByName.get(photo.locationName) ?? locationByName.get("Travels") ?? null,
  kind: photo.kind,
  year_taken: photo.yearTaken,
  aspect: photo.aspect,
  storage_bucket: photo.storageBucket,
  storage_path: photo.storagePath,
  is_featured: false,
  is_published: false,
  sort_order: photo.sortOrder,
}));

for (let index = 0; index < rows.length; index += 25) {
  const chunk = rows.slice(index, index + 25);
  const { error } = await supabase.from("photos").insert(chunk);
  if (error) throw error;
  console.log(`Inserted ${Math.min(index + 25, rows.length)}/${rows.length}`);
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
