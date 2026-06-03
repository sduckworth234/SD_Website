import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const manifestPath = process.argv[2] ?? "imports/uploaded-drone-manifest.json";
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.");
}

const titleMap = {
  "Bayview Sunset": "Bayview Sunset",
  "Manly Wharf Sunset": "Manly Wharf Sunset",
  "North Narrabeen": "North Narrabeen",
  "Manly Beach Clear Water": "Manly Beach Clear Water",
  Warriewood: "Warriewood",
  "South Mona Vale": "South Mona Vale",
  "Warriewood:Mona Vale": "Warriewood Mona Vale",
  "Pie in the Sky": "Pie in the Sky",
  "Hunter Valley": "Hunter Valley",
  "Manly Sunrise Steyne": "Manly Sunrise",
  "Ned Farm": "Ned Farm",
  "Tommy Freshy": "Freshwater",
  "Wharf Bar Anzac Day": "Wharf Bar Anzac Day",
};

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

const roman = [
  "",
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
  "XIII",
  "XIV",
  "XV",
  "XVI",
  "XVII",
  "XVIII",
  "XIX",
  "XX",
  "XXI",
  "XXII",
  "XXIII",
  "XXIV",
  "XXV",
  "XXVI",
  "XXVII",
  "XXVIII",
  "XXIX",
  "XXX",
];

const supabase = createClient(supabaseUrl, supabaseKey);
const manifest = JSON.parse(await readFile(manifestPath, "utf8")).uploaded;
const counts = new Map();

const { data: locations, error: locationError } = await supabase
  .from("locations")
  .select("id, name");

if (locationError) throw locationError;

const locationByName = new Map(locations.map((location) => [location.name, location.id]));

for (const [index, photo] of manifest.entries()) {
  const group = photo.description;
  const sequence = (counts.get(group) ?? 0) + 1;
  counts.set(group, sequence);

  const baseTitle = titleMap[group] ?? group;
  const locationName = locationMap[group] ?? photo.locationName;
  const locationId = locationByName.get(locationName);
  const title = `${baseTitle} ${roman[sequence] ?? sequence}`;

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
