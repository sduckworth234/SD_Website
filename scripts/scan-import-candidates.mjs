// Discovery pass: find JPG exports under "Final" folders across 2021+, drop
// duplicates and anything already uploaded, then write a candidate manifest and
// print a year/location summary for approval. No uploads, no Supabase writes.
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const ROOT = process.env.SCAN_ROOT ?? "/Volumes/SamD2";
const YEARS = (process.env.SCAN_YEARS ?? "2021,2022,2023,2024,2025,2026").split(",");
// Folders to scan wholesale (every jpg, no "Final" requirement) — curated sets
// that don't live under a year/Final folder.
const EXTRA_DIRS = (process.env.EXTRA_DIRS ??
  "Archive/Website Stuff/Website Stuff (LACIE)/Compressed Website")
  .split("\n").map((s) => s.trim()).filter(Boolean);
const manifestPath = process.env.UPLOADED_MANIFEST ?? "imports/uploaded-drone-manifest.json";
const outJson = process.argv[2] ?? "imports/import-candidates.json";

const SKIP_DIR = /^\.|^\$RECYCLE\.BIN$|^System Volume Information$/i;
const RAW_DIR = /\b(raw|tiff?|dng|cr2|arw|nef|psd|original|originals|lightroom|catalog|video|videos|footage)\b/i;
const FINAL_DIR = /final/i;
const GENERIC_DIR = /^(photos?|final|finals|edits?|edited|jpe?gs?|exports?|web|web ?ready|selects?|keepers?|best|favou?rites?|photos final)$/i;
const JPG = /\.jpe?g$/i;

const KNOWN = [
  "Palm Beach", "Whale Beach", "Avalon", "Bilgola", "Newport", "Bungan",
  "Mona Vale", "Warriewood", "Turimetta", "North Narrabeen", "Narrabeen",
  "Collaroy", "Long Reef", "Dee Why", "North Curl Curl", "Curl Curl",
  "Freshwater", "Queenscliff", "Shelly Beach", "Manly", "North Head",
  "Bayview", "Church Point", "Barrenjoey", "Bondi", "Maroubra", "North Curly",
];

function matchKnown(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  const tNo = t.replace(/[^a-z]/g, "");
  for (const name of KNOWN) {
    const n = name.toLowerCase();
    if (t.includes(n) || tNo.includes(n.replace(/\s+/g, ""))) {
      return name === "North Curly" ? "North Curl Curl" : name;
    }
  }
  return null;
}

function deriveLocation(fullPath) {
  const parts = fullPath.split("/").filter(Boolean);
  let finalIdx = -1;
  for (let i = parts.length - 2; i >= 0; i--) {
    if (FINAL_DIR.test(parts[i])) { finalIdx = i; break; }
  }
  // Walk up from the folder above "Final" to the first descriptive folder.
  let idx = finalIdx > 0 ? finalIdx - 1 : parts.length - 2;
  while (idx > 0) {
    const stripped = stripDate(parts[idx]);
    if (stripped && !GENERIC_DIR.test(stripped) && !/^\d+$/.test(stripped) && !RAW_DIR.test(stripped)) break;
    idx -= 1;
  }
  const folderLabel = stripDate(parts[idx] ?? "");

  // Prefer a known location named in the folder, then a non-generic folder
  // label, then fall back to the filename (handles the Compressed Website set).
  const fromFolder = matchKnown(folderLabel);
  if (fromFolder) return fromFolder;
  if (folderLabel && !GENERIC_DIR.test(folderLabel)) return folderLabel;

  const file = basename(fullPath).replace(/\.[^.]+$/, "");
  const fromFile = matchKnown(file);
  if (fromFile) return fromFile;

  const cleaned = file
    .replace(/[_-]?\d{1,2}[._-]\d{1,2}([._-]\d{2,4})?.*$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return cleaned || folderLabel || "Unsorted";
}

function stripDate(folder) {
  return folder
    .replace(/^\d{1,2}[._-]\d{1,2}([._-]\d{2,4})?\s+/, "")
    .replace(/^\d{4}[-_.]\d{1,2}[-_.]\d{1,2}\s+/, "")
    .replace(/^\d{4}\s+/, "")
    .trim();
}

function deriveYear(fullPath) {
  const p = fullPath.split("/").find((x) => /^20\d{2}$/.test(x));
  if (p) return Number(p);
  const file = basename(fullPath);
  const dmy = file.match(/(\d{1,2})[._-](\d{1,2})[._-](\d{2,4})/);
  if (dmy) {
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    if (y >= 2000 && y <= 2099) return y;
  }
  const yy = file.match(/20\d{2}/);
  return yy ? Number(yy[0]) : null;
}

async function walk(dir, inFinal, acc) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR.test(e.name) || RAW_DIR.test(e.name)) continue;
      await walk(full, inFinal || FINAL_DIR.test(e.name), acc);
    } else if (e.isFile()) {
      if (e.name.startsWith("._") || !JPG.test(e.name)) continue;
      if (inFinal) acc.candidates.push(full);
      else acc.skippedNonFinal += 1;
    }
  }
}

// Already-uploaded fingerprints (path + name|size) so LACIE copies dedupe too.
const uploadedManifest = JSON.parse(await readFile(manifestPath, "utf8")).uploaded;
const uploadedPaths = new Set(uploadedManifest.map((p) => p.sourcePath));
const uploadedFingerprints = new Set();
for (const p of uploadedManifest) {
  try {
    const s = await stat(p.sourcePath);
    uploadedFingerprints.add(`${basename(p.sourcePath).toLowerCase()}|${s.size}`);
  } catch { /* original may be offline; path-match still applies */ }
}

const acc = { candidates: [], skippedNonFinal: 0 };
for (const year of YEARS) {
  await walk(join(ROOT, year), false, acc);
}
// Extra curated folders: include every jpg (no "Final" gate).
for (const rel of EXTRA_DIRS) {
  await walk(join(ROOT, rel), true, acc);
}

let alreadyUploaded = 0;
let dupes = 0;
const seen = new Map(); // fingerprint -> kept sourcePath
const kept = [];

for (const sourcePath of acc.candidates) {
  let size = 0;
  try { size = (await stat(sourcePath)).size; } catch { continue; }
  const fingerprint = `${basename(sourcePath).toLowerCase()}|${size}`;

  if (uploadedPaths.has(sourcePath) || uploadedFingerprints.has(fingerprint)) {
    alreadyUploaded += 1;
    continue;
  }
  if (seen.has(fingerprint)) { dupes += 1; continue; }
  seen.set(fingerprint, sourcePath);

  kept.push({
    sourcePath,
    year: deriveYear(sourcePath),
    location: deriveLocation(sourcePath),
    sizeBytes: size,
  });
}

kept.sort((a, b) =>
  (a.year ?? 0) - (b.year ?? 0) ||
  a.location.localeCompare(b.location) ||
  a.sourcePath.localeCompare(b.sourcePath),
);

await writeFile(outJson, JSON.stringify({ scannedAt: null, count: kept.length, candidates: kept }, null, 2));

// ---- Summary ----
const byYear = new Map();
const byLocation = new Map();
let totalBytes = 0;
for (const c of kept) {
  totalBytes += c.sizeBytes;
  const yKey = c.year ?? "unknown";
  if (!byYear.has(yKey)) byYear.set(yKey, new Map());
  const locMap = byYear.get(yKey);
  locMap.set(c.location, (locMap.get(c.location) ?? 0) + 1);
  byLocation.set(c.location, (byLocation.get(c.location) ?? 0) + 1);
}

console.log("\n========================================");
console.log("IMPORT CANDIDATES (JPG exports under 'Final' folders)");
console.log("========================================");
console.log(`Years scanned        : ${YEARS.join(", ")}`);
console.log(`New to upload        : ${kept.length}`);
console.log(`Skipped (already up) : ${alreadyUploaded}`);
console.log(`Skipped (duplicates) : ${dupes}`);
console.log(`Skipped (non-Final)  : ${acc.skippedNonFinal}`);
console.log(`Total size           : ${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB`);

for (const [year, locMap] of [...byYear.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
  const yearTotal = [...locMap.values()].reduce((a, b) => a + b, 0);
  console.log(`\n--- ${year}  (${yearTotal}) ---`);
  for (const [loc, n] of [...locMap.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`  ${String(n).padStart(4)}  ${loc}`);
  }
}

console.log(`\nLocations overall: ${byLocation.size}`);
console.log(`Wrote ${outJson}`);
