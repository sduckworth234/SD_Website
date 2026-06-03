import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const manifestPath = process.argv[2] ?? "imports/uploaded-drone-manifest.json";
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const locationMap = {
  "Bayview Sunset": "Bayview",
  "Manly Wharf Sunset": "Manly",
  "North Narrabeen": "Narrabeen",
  "Manly Beach Clear Water": "Manly",
  Warriewood: "Warriewood",
  "South Mona Vale": "Mona Vale",
  "Warriewood:Mona Vale": "Warriewood",
  "Pie in the Sky": "Travels",
  "Hunter Valley": "Travels",
  "Manly Sunrise Steyne": "Manly",
  "Ned Farm": "Travels",
  "Tommy Freshy": "Freshwater",
  "Wharf Bar Anzac Day": "Manly",
};

const supabase = createClient(supabaseUrl, supabaseKey);
const manifest = JSON.parse(await readFile(manifestPath, "utf8")).uploaded;

const { data: locations, error: locationError } = await supabase
  .from("locations")
  .select("id, name");

if (locationError) throw locationError;

const locationByName = new Map(locations.map((location) => [location.name, location.id]));

for (const [index, photo] of manifest.entries()) {
  const locationName = locationMap[photo.description] ?? photo.locationName;
  const locationId = locationByName.get(locationName);
  const title = locationName;

  const { error } = await supabase
    .from("photos")
    .update({
      title,
      description: null,
      location_id: locationId,
    })
    .eq("storage_path", photo.storagePath);

  if (error) throw error;
  console.log(`${index + 1}/${manifest.length} ${title}`);
}
