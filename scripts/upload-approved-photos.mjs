import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const listPath = process.argv[2] ?? "imports/approved-drone-files.txt";
const outputManifestPath = process.argv[3] ?? "imports/uploaded-drone-manifest.json";
const compressedDir = process.argv[4] ?? "imports/compressed-drone";

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY;
const bucket = process.env.VITE_SUPABASE_PHOTO_BUCKET ?? "photos";
const skipUpload = process.env.SKIP_UPLOAD === "1";

if (!skipUpload && (!supabaseUrl || !supabaseKey)) {
  throw new Error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

await mkdir(compressedDir, { recursive: true });

const supabase = skipUpload ? null : createClient(supabaseUrl, supabaseKey);
const files = (await readFile(listPath, "utf8"))
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const uploaded = [];

for (const [index, sourcePath] of files.entries()) {
  const hash = createHash("sha1").update(sourcePath).digest("hex").slice(0, 12);
  const parsed = parseSourcePath(sourcePath);
  const title = titleFromFilename(sourcePath);
  const safeTitle = slugify(title) || `photo-${index + 1}`;
  const localOutput = `${compressedDir}/${String(index + 1).padStart(3, "0")}-${hash}.webp`;
  const storagePath = `approved/${parsed.year ?? "unknown"}/${parsed.locationSlug}/${safeTitle}-${hash}.webp`;

  const image = sharp(sourcePath, { failOn: "none" }).rotate();
  const metadata = await image.metadata();
  const aspect = inferAspect(metadata.width, metadata.height);

  await image
    .resize({
      width: 2400,
      height: 2400,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 78, effort: 5 })
    .toFile(localOutput);

  if (supabase) {
    const fileBody = await readFile(localOutput);
    const { error } = await supabase.storage.from(bucket).upload(storagePath, fileBody, {
      cacheControl: "31536000",
      contentType: "image/webp",
      upsert: true,
    });

    if (error) {
      throw new Error(`Upload failed for ${sourcePath}: ${error.message}`);
    }
  }

  uploaded.push({
    sourcePath,
    storageBucket: bucket,
    storagePath,
    title,
    slug: `${safeTitle}-${hash}`,
    description: parsed.description,
    locationName: parsed.locationName,
    kind: "Drone",
    yearTaken: parsed.year,
    aspect,
    isFeatured: false,
    isPublished: false,
    sortOrder: index + 100,
    originalWidth: metadata.width ?? null,
    originalHeight: metadata.height ?? null,
  });

  console.log(`${index + 1}/${files.length} ${skipUpload ? "compressed" : "uploaded"} ${storagePath}`);
}

await writeFile(outputManifestPath, JSON.stringify({ uploadedAt: new Date().toISOString(), uploaded }, null, 2));
console.log(`Wrote ${outputManifestPath}`);

function parseSourcePath(sourcePath) {
  const parts = sourcePath.split("/");
  const year = Number(parts.find((part) => /^20\d{2}$/.test(part))) || null;
  const folder = dirname(sourcePath).split("/").filter(Boolean).at(-2) ?? dirname(sourcePath).split("/").filter(Boolean).at(-1) ?? "Unsorted";
  const withoutDate = folder.replace(/^\d{1,2}\.\d{1,2}\.\d{2,4}\s+/, "").trim();
  const locationName = inferLocation(withoutDate);

  return {
    year,
    locationName,
    locationSlug: slugify(locationName),
    description: withoutDate,
  };
}

function inferLocation(value) {
  const lower = value.toLowerCase();
  const known = [
    "Palm Beach",
    "Avalon",
    "Whale Beach",
    "Narrabeen",
    "Manly",
    "Warriewood",
    "Mona Vale",
    "Bayview",
    "Freshwater",
    "North Head",
  ];

  return known.find((name) => lower.includes(name.toLowerCase())) ?? "Travels";
}

function inferAspect(width = 0, height = 0) {
  if (!width || !height) return "landscape";
  const ratio = width / height;
  if (ratio > 1.85) return "wide";
  if (ratio < 0.8) return "portrait";
  if (ratio > 0.92 && ratio < 1.08) return "square";
  return "landscape";
}

function titleFromFilename(sourcePath) {
  return basename(sourcePath, extname(sourcePath))
    .replace(/[_-]+/g, " ")
    .replace(/\s+\(\d+\)$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
