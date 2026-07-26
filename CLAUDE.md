# CLAUDE.md — Sam Duckworth Photography

Operating guide for this repo. Read this first; it captures how the project is
built, how we ship, and how photos get from the drive onto the live site.

## What this is

A minimalist photography gallery for **Sam Duckworth** (Northern Beaches drone +
travel work). React/Vite SPA, Supabase backend (Postgres + Storage + Auth),
deployed on Vercel at **https://samduckworth.com**.

- **Stack:** React 19, Vite 6, TypeScript, `@supabase/supabase-js`,
  `lucide-react` (icons), plain CSS (no Tailwind). `maplibre-gl` powers the `/map`
  page and is **lazy-loaded** (kept out of the main gallery bundle). `sharp` +
  `exif-reader` are used only by the Node import scripts, not the app bundle.
- **Hosting:** Vercel, auto-deploys on push to `main`. The gallery reads
  Supabase at runtime, so **published data changes go live with no redeploy**.

## Ways of working

- **Always push straight to `main`.** No PRs, no feature branches. Vercel
  auto-deploys. (Confirmed standing preference.)
- **Run `npm run build` before pushing** any code change (it runs `tsc -b` +
  `vite build`). Data-only changes (Supabase rows via scripts) don't need a
  build/redeploy.
- Commit messages end with the `Co-Authored-By` trailer.
- The build output `dist/`, `node_modules/`, `.env*`, and `imports/` are
  gitignored. **`imports/` is local scratch** (manifests, compressed copies);
  finished junk gets moved into `imports/DELETE/` to bin.

## Project layout

```
index.html            meta/title/favicon/OG tags + Google font (Bebas Neue)
src/
  App.tsx             gallery (/) + admin (/admin); hand-rolled router in App()
  MapPage.tsx         the /map page (MapLibre); lazy-loaded
  components/         shared bits: Header.tsx (nav), SmartImage.tsx
  lib/supabase.ts     all Supabase data access (read + write helpers)
  types.ts            Photo, GalleryLocation types
  data/photos.ts      fallback data when Supabase env is absent
  styles.css          all styling
public/               favicon.svg, apple-touch-icon.png, og-image.png
supabase/migrations/  DB schema + RLS + storage bucket
scripts/              import / geo / altitude / coords / ops pipeline (Node ESM .mjs)
```

Routing is hand-rolled in `App()` (reads `window.location.pathname`, `popstate`,
`history.pushState`): `/admin` → AdminApp, `/map` → lazy MapPage, else PublicGallery.

### Components
- **PublicGallery** (`/`): Hero (rotating location ticker), RecentWork mosaic,
  LocationRail (filter tabs), GalleryControls (flow/box toggle + **View on map**),
  Gallery, Lightbox, AboutOverlay, InstagramRail. Drone tiles + the lightbox show
  a bottom-right **altitude badge** (`relative_altitude_m`). Lands on a random
  category unless deep-linked via `/?location=Name` (used by the map). When an
  admin is signed in, tiles get inline edit/unpublish/send-to-top + RecentPicker.
- **MapPage** (`/map`): MapLibre + keyless **OpenFreeMap** basemap (warmed to the
  palette). Clustered location bubbles (count-sized, name-labelled) that hold
  regions like Europe together and split on zoom; cluster-click dives in; close up
  the bubble dissolves into individual photo pins; clicking a pin opens a lightbox
  of that image with a button to its gallery. Frame-to-extent on load.
- **AdminApp** (`/admin`): login → AdminDashboard (upload, bulk publish/rename/
  move, per-photo edit/delete/feature, create location).
- **GallerySkeleton / RecentWorkSkeleton / LocationRailSkeleton**: minimal shimmer
  placeholders mirroring the real layout during load.
- **SmartImage** (`components/`): shimmer skeleton + fade-in. **Header**
  (`components/`): shared nav (Galleries / Map / About / admin), used by both
  PublicGallery and MapPage.

## Data model & conventions (Supabase)

`photos`: `title`, `slug` (unique), `location_id` → `locations`, `kind`,
`year_taken`, `captured_at` (date), `aspect` (`portrait|landscape|square|wide`),
`ratio` (exact width/height, 4dp — reserves each gallery tile's true shape so
the masonry never reflows; backfill via `scripts/ratio-backfill.mjs`),
`storage_bucket`, `storage_path`, `source_path`, `is_featured`, `is_published`,
`sort_order`, `relative_altitude_m` (drone height above takeoff, nullable),
`latitude` / `longitude` (capture coords, nullable). The altitude/coords are
backfilled from the original JPGs (see the altitude/coords scripts) since WebP
compression strips EXIF/XMP.

**Every ingestion path extracts full metadata.** `import-shoot.mjs` (script
imports) and the `/admin` upload panel (browser: `src/lib/ingest.ts` — exifr +
canvas WebP, never the full-res original) both write GPS, DJI altitude, capture
date/year, aspect, exact ratio, and source_path, then warm the transform CDN
for the new photo's srcset variants. Safety nets: `scripts/ratio-backfill.mjs`
(idempotent) and `scripts/warm-transforms.mjs` (re-warm all variants).
- **`source_path`** = absolute path to the original full-res file at import time
  (drive folder + filename) — the link from a gallery photo back to the file to
  sell. **Private/admin-only**: it must never reach the public API, so migration
  `…_photo_source_path.sql` locks it at the COLUMN level (revoke anon's blanket
  table SELECT, re-grant an explicit allow-list that omits it). The public query
  (`getGalleryData`) selects an explicit column list without it; only the admin
  fetch (`getAdminPhotos`, authenticated role) includes it. **Gotcha:** that
  allow-list is fail-closed — a NEW public column must be added to the anon grant
  in that migration or anon can't read it. Backfill with
  `scripts/source-path-backfill.mjs` (maps `storage_path`→`sourcePath` from the
  manifests); new imports (`import-shoot.mjs`) write it directly.

`locations`: `name`, `slug` (unique), `region`, `sort_order`, `is_visible`.

Conventions the gallery relies on:
- **`location` = the filter category** (a place like `Manly` for local work; a
  **country** like `Italy` for overseas trips, to keep the selector tight).
- **`title` = the precise place** shown on the photo (e.g. `Positano`,
  `Freshwater`). For local work title often equals the location.
- **`is_published`** controls public visibility. Unpublished = drafts.
- **`is_featured` + `sort_order` 1–5** = the "Recent Work" mosaic slots
  (`assignRecentSlot`); empty slots auto-fill with most-recent published.
- **"Unsorted"** (null `location_id`) is hidden from the public gallery
  entirely; admins still see it to sort.
- Public gallery orders by `sort_order` asc then `created_at` desc;
  `sendPhotoToTop` lowers a photo's `sort_order` to lead its category.

## Supabase / env / auth

- Project ref `krixuiimabosiorzxzju`. Frontend uses the **publishable key**
  (in `.env.local` and README). RLS: anon can read published photos/visible
  locations; only **admins** (email in `public.admin_users`) can write.
- **Bulk import scripts** use the **service-role key** as
  `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (gitignored, server-only — never
  a `VITE_` var or it would leak into the browser bundle). Run scripts with
  `node --env-file=.env.local …`. The service key bypasses RLS, so no temp
  policies are needed.
- Admin = add the email to `public.admin_users` + create the Auth user, then
  sign in at `/admin`.
- **Schema changes can't be applied programmatically here.** The service key does
  rows, not DDL (PostgREST), and the `supabase` CLI is logged into a different
  account, so `db push` won't reach this project. Write the migration file in
  `supabase/migrations/`, then **Sam runs the SQL by hand in the Supabase SQL
  editor**. Data backfills then go through the service key as normal.

## Deploy / domain

- Push to `main` → Vercel builds + deploys.
- Domain **samduckworth.com** on GoDaddy DNS → Vercel: apex `A @ 216.198.79.1`,
  `CNAME www → <vercel-dns>`; Google Workspace MX records are untouched.
- Vercel env vars mirror `.env.local`'s `VITE_*`. Keep `VITE_SITE_URL` and the
  OG tags in `index.html` pointing at the live domain.

## Photo import & sync pipeline (`scripts/`, all Node ESM)

**Recommended path for any new batch — the `/import-photos` skill** (see
`.claude/skills/import-photos/`, driven by `scripts/import-shoot.mjs`). Drop JPGs
in a folder, invoke the skill: it reads each original's GPS/altitude/date/aspect
up front (before WebP strips EXIF/XMP), reverse-geocodes a location, compresses,
uploads, and inserts a fully-populated published row — one pass, no manifest
round-trip, idempotent, with a dry-run **plan** shown before anything goes live.
The multi-step routes below predate it and remain for reference/history.

Source photos live on the external drive **`/Volumes/SamD2`**. Two import
routes plus a backfill. All write-scripts need `--env-file=.env.local` (service
key) and, because the Bash sandbox blocks `/Volumes`, must run with the sandbox
disabled.

**Gotchas (learned the hard way):**
- Compression **strips EXIF** — uploaded WebPs have no GPS. To geolocate after
  upload, read the **original source JPGs** (mapped via the manifests below).
- `mdls` returns nothing — Spotlight doesn't index the exFAT drive. Read EXIF
  directly with `sharp` + `exif-reader`.
- Skip AppleDouble `._*` sidecars and `(1).jpg` resource forks; validate real
  JPEGs by magic bytes (`FF D8 FF`).
- Reverse geocoding uses OpenStreetMap **Nominatim** — rate-limit (~1.1–1.2s),
  cache by rounded coord, send a `User-Agent`.
- All upload scripts compress to **WebP ≤2400px, q78** and are **idempotent**
  (skip any `storage_path` already in `photos`). Knobs: `DRY_RUN=1`, `LIMIT=n`,
  `PUBLISH=0` (drafts).

**Route A — folder-based (curated "Final" exports):**
1. `scan-import-candidates.mjs` → `imports/import-candidates.json`
2. `refine-approved.mjs` → `imports/import-approved.json`
3. `import-batch.mjs` → compress, upload, insert published rows

**Route B — GPS-based (trips, e.g. the 2024 Europe batch):**
1. `geo-bucket.mjs` — read each JPG's GPS, reverse-geocode, **move into
   precise Location folders** (`_NoGPS/` for missing). `DRY=1` previews.
2. `geo-recountry.mjs` — nest precise folders under their **country**
   → `Country/Precise/`.
3. `import-folders.mjs` — nesting-aware: `Country/Precise/` imports as
   **location = country, title = precise**; flat folders import as
   location = title = folder.

**Backfill existing rows from GPS:**
- `geo-analyze-existing.mjs` (read-only) maps each photo's `storage_path` →
  source JPG via the upload manifests, reads GPS, reverse-geocodes →
  `imports/geo-existing-analysis.json`.
- `geo-update-existing.mjs` sets `location`+`title` from that analysis, skipping
  generic (city-only) and no-GPS photos.

**Backfill altitude + coordinates** (same manifest-mapping pattern; analyze→apply,
both read the original JPGs since WebP stripped EXIF/XMP). Run analyze with the
sandbox disabled (reads `/Volumes`); both need `--env-file=.env.local`:
- `altitude-analyze.mjs` → `imports/altitude-analysis.json`, then
  `altitude-backfill.mjs` writes `relative_altitude_m` (DJI XMP `RelativeAltitude`;
  drops one impossible reading). `probe-altitude.mjs` is a spot-check tool.
- `coords-analyze.mjs` → `imports/coords-analysis.json` (EXIF GPS, DJI-XMP
  fallback), then `coords-backfill.mjs` writes `latitude`/`longitude` (rounded to
  ~3dp). Both support `DRY_RUN=1`. Requires the columns to exist first (DDL — see
  Supabase section). Locations with no GPS get an app-side fallback coord in
  `MapPage.tsx` (`LOCATION_FALLBACK_COORDS`).

**Manifests** (in `imports/`, the storage_path → sourcePath maps):
`uploaded-drone-manifest.json` (original 103), `import-batch-manifest.json`
(2021+ batch), `europe-manifest.json` (Europe trip).

### Adding the next photo batch
For a phone/drone dump from a trip: drop the JPGs in a folder, then
`geo-bucket` → review/rename folders → `geo-recountry` → `import-folders`. For
curated drive exports, use Route A. Country→precise keeps the location selector
tight while preserving precise names per photo.

## Admin capabilities (built)

Publish/unpublish, delete (row + storage file), feature/Recent Work slots,
send-to-top, bulk rename, bulk move-to-location, create location — from `/admin`
and (edit/unpublish/send-to-top) inline on the live gallery when signed in.

**2026 Europe hero (`/admin` → Visibility):** the home page's crossfading "2026"
trip banner, sat between the landing hero and Recent Work and clicking through to
`/galleries`. Its photos are an **ordered id list in one `site_settings` row**
(`hero_2026_photos`, a JSON array string — the same trick the shop's `shop_preview`
wall uses), so it needed **no migration**. The picker offers Europe-region photos
only; order drives both the crossfade sequence and the location ticker (read off
the photos' own `location`, nothing hardcoded). No picks = the section doesn't
render at all. The `hero_2026` visibility flag hides it independently.

**Full per-photo editor (`/admin`):** every field is editable — title,
description, location, year, capture date, kind, aspect, altitude, lat/lon,
**source file path**, sort order, published/featured/map-feature — plus
read-only storage path / slug / id with copy buttons. A **catalogue search box**
filters the grid by title, location, or source filename (find the original when
someone wants to buy a print). The full editor is gated by a `full` prop on
`PhotoEditForm` + a hidden `_full` form marker, so the lightweight inline editor
on the public gallery (whose photos omit `source_path`) only touches the basic
fields and can't blank the admin-only ones.
