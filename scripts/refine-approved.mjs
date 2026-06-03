// Take the discovery candidates, drop the excluded (client/private) buckets,
// and assign a final location per photo. Writes imports/import-approved.json
// and prints the location counts. No Supabase, no uploads.
import { openSync, readSync, closeSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

// Real JPEGs start with FF D8 FF. AppleDouble sidecars ("name (1).jpg") start
// with 00 05 16 07 — drop those and anything else that isn't a JPEG.
function isJpeg(path) {
  let fd;
  try { fd = openSync(path, "r"); } catch { return false; }
  try {
    const b = Buffer.alloc(3);
    readSync(fd, b, 0, 3, 0);
    return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  } catch { return false; } finally { closeSync(fd); }
}

const inJson = process.argv[2] ?? "imports/import-candidates.json";
const outJson = process.argv[3] ?? "imports/import-approved.json";

// Buckets the user chose NOT to include.
const EXCLUDE = new Set([
  "Max Hoysted Boat", "Sid House", "Kinahan Farm", "USYD",
  "SAM TO SORT 19.11.23 Merge", "New Prints 21.11.23",
]);

function fromFilename(file) {
  const f = file.toLowerCase();
  if (f.includes("manly")) return "Manly";
  if (f.includes("bower")) return "Bower";
  if (f.includes("jindabyne")) return "Jindabyne";
  if (f.includes("queens")) return "Queenscliff";
  if (/\bnh\b/.test(f) || f.includes("samsidnh")) return "North Head";
  return null;
}

const data = JSON.parse(await readFile(inJson, "utf8")).candidates;
const approved = [];
let droppedJunk = 0;

for (const c of data) {
  if (EXCLUDE.has(c.location)) continue;
  if (!isJpeg(c.sourcePath)) { droppedJunk += 1; continue; }

  let location = c.location;
  if (location === "Steyne (LACIE)") {
    location = "Manly";
  } else if (location === "Compressed Website") {
    location = fromFilename(basename(c.sourcePath)) ?? "Unsorted";
  } else if (location.startsWith("Pink Moon")) {
    location = "Unsorted";
  }

  approved.push({ sourcePath: c.sourcePath, year: c.year, location });
}

approved.sort((a, b) =>
  a.location.localeCompare(b.location) || a.sourcePath.localeCompare(b.sourcePath),
);

await writeFile(outJson, JSON.stringify({ count: approved.length, photos: approved }, null, 2));

const byLoc = new Map();
for (const p of approved) byLoc.set(p.location, (byLoc.get(p.location) ?? 0) + 1);

console.log(`\nFinal approved set: ${approved.length} photos (dropped ${droppedJunk} non-JPEG/AppleDouble)\n`);
for (const [loc, n] of [...byLoc.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
  console.log(`  ${String(n).padStart(4)}  ${loc}`);
}
console.log(`\nDistinct locations: ${byLoc.size}`);
console.log(`Wrote ${outJson}`);
