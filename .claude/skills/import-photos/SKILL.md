---
name: import-photos
description: >-
  Add a batch of photos to the live Sam Duckworth gallery from a folder of
  full-res JPGs (e.g. a Lightroom export). Use whenever Sam wants to import,
  upload, add, or publish new photos to the site — "import these photos",
  "add this shoot to the website", "upload the drone dump", "publish my Italy
  pics", or points at a folder of images to put on samduckworth.com. Reads each
  original's GPS, drone altitude, capture date + aspect, reverse-geocodes a
  location, compresses to WebP, uploads to Supabase Storage, and inserts a fully
  populated, published photo row — all in one pass. Always previews a plan
  before writing anything live.
---

# Import photos to the gallery

This skill takes a folder of full-res JPGs and gets them onto the live gallery
at **samduckworth.com** — compressed, geolocated, altitude-tagged, and
published — with one confirmation step in the middle. The data lands straight in
Supabase, so it's **live immediately, no redeploy**.

It is driven by **`scripts/import-shoot.mjs`** (one-pass importer). You orchestrate:
preflight → dry-run **plan** → Sam confirms → real import → report.

## How the importer works (so you can explain it / debug it)

For every JPG under the source folder (recursive; AppleDouble `._*` sidecars and
non-JPEGs skipped) it reads the **original** — because WebP compression strips
EXIF/XMP — and derives:

- **Coordinates** — EXIF GPS first, then DJI-XMP fallback (`drone-dji:GpsLatitude/
  Longitude`); rejects (0,0). → `latitude`/`longitude` (rounded ~3dp).
- **Drone height** — DJI-XMP `RelativeAltitude` (metres above takeoff), clamped to
  a plausible −200…1000 m band. → `relative_altitude_m`.
- **Year + capture date** — EXIF `DateTimeOriginal`. → `year_taken`, `captured_at`.
- **Aspect + exact ratio** — measured from the compressed output dimensions, so
  EXIF rotation is honoured. → `aspect` (`portrait | landscape | square | wide`)
  and `ratio` (width/height, 4dp — reserves the gallery tile's true shape so the
  masonry never reflows while images load).
- **Location + title** — reverse-geocodes the coords via OpenStreetMap Nominatim
  (cached, rate-limited). Convention: **location = the gallery filter category**
  (a *suburb* for local AU work, a *country* for overseas trips); **title = the
  precise place** shown on the photo. Creates the `locations` row if it's new.
- **Kind** — `Drone` if DJI markers are present, else `Landscape` (home) / `Travel`
  (overseas). Override with `KIND=`.
- **Source file** — the original's absolute path is written to `source_path`
  (admin-only) so the gallery photo links back to the full-res file. Editable
  later in the `/admin` full editor; backfill old rows with
  `scripts/source-path-backfill.mjs`.

Then it compresses (sharp `rotate → fit-inside 2400px → WebP q78`), uploads to the
`photos` bucket (`upsert`), inserts a published row, and **warms the transform
CDN** (fetches each new photo's srcset variants once so first viewers get cache
HITs, not cold generation). **Idempotent**: any `storage_path` already in
`photos` is skipped, so re-running the same folder is safe. A provenance
manifest is written to `imports/import-<folder>-manifest.json`.

Safety nets if anything is ever missed: `scripts/ratio-backfill.mjs` (fills
missing `ratio`, idempotent) and `scripts/warm-transforms.mjs` (re-warms every
published photo's variants).

### Knobs (env vars on the `node` command)
- `DRY_RUN=1` — plan only: read + geocode + compress, **no upload, no DB**.
- `LOCATION="Manly"` — force every photo into one location (skip geocoding the
  category). Best for a single-spot shoot, geotagged or not. Titles still come
  from each photo's own GPS when present.
- `KIND="Drone|Landscape|Travel"` — force the kind.
- `REGION="Europe"` — region for any **new** location rows (defaults: home →
  "Northern Beaches", overseas → the geocoded region/country).
- `PUBLISH=0` — insert as drafts instead of publishing.
- `LIMIT=n` — only the first n photos (smoke test).

## Procedure

### 1. Get the source folder + intent
- The folder may be in the user's message/args. If not, ask for the path.
- Ask **one** batched question if it isn't already clear (use AskUserQuestion):
  - **Locations**: auto-detect per photo from GPS, **or** is this one known place?
    (If one place → use `LOCATION="…"`.)
  - **Publish now or drafts?** (default: publish live.)
  - Only ask if genuinely ambiguous; a clearly-named single-trip folder with GPS
    can go straight to auto + publish.

### 2. Preflight
- Confirm the folder exists and count JPGs:
  `find "<DIR>" -type f \( -iname '*.jpg' -o -iname '*.jpeg' \) | wc -l`
- If the path is under **`/Volumes/`**, every `node`/`find` call here must run with
  the **Bash sandbox disabled** (the sandbox blocks `/Volumes`, and the import
  needs outbound network for Supabase + Nominatim regardless).
- `.env.local` must hold `VITE_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
  (it does in this repo). All real runs use `node --env-file=.env.local`.

### 3. Dry-run the plan (ALWAYS first)
```
DRY_RUN=1 node --env-file=.env.local scripts/import-shoot.mjs "<DIR>"
```
(add `LOCATION=`/`REGION=`/`KIND=` as decided). Read the `=== PLAN ===` summary
back to Sam: total photos, **NEW** locations to be created, the per-location
counts, how many have **no GPS** (those import as Unsorted drafts unless a
`LOCATION` is given), and altitude coverage. Spot-check a few `[location] title`
lines look right.

### 4. Confirm, then import for real
Only after Sam okays the plan, run the same command **without** `DRY_RUN`:
```
node --env-file=.env.local scripts/import-shoot.mjs "<DIR>"
```
(sandbox disabled). This compresses, uploads, and inserts. It's idempotent, so if
it's interrupted you can re-run the exact command to finish.

### 5. Report
- State what landed: N photos published across which locations (flag any NEW ones),
  any no-GPS photos parked as Unsorted drafts, altitude coverage.
- Remind Sam it's **already live** at samduckworth.com (no deploy needed), shows on
  the **/map** for geolocated photos, and that he can curate from `/admin` or inline
  on the gallery — set Recent-Work slots, send-to-top, rename, or fix any
  mis-geocoded location/title. No-GPS drafts need a location set before they show.

## Notes & gotchas
- **No GPS + no `LOCATION`** → photo is parked as an *Unsorted draft* (hidden from
  the public gallery) for manual sorting, never silently mislocated.
- Reverse geocoding can mis-pick a category (e.g. a bushland point returns "Sydney"
  not the beach suburb). That's why the dry-run plan exists — if it's off, re-run
  with `LOCATION="<right place>"`, or let it import and fix titles/locations in
  `/admin`.
- This **supersedes** the old multi-step flow (`geo-bucket` → `geo-recountry` →
  `import-folders` + the `altitude`/`coords` backfills) for new batches by reading
  all metadata up front. Those scripts remain for reference/history.
- Schema/DDL changes still need Sam to run SQL by hand — but this skill only writes
  rows + storage, never DDL, so no migration is involved.
