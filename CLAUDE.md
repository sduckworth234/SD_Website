# CLAUDE.md — Sam Duckworth Photography

Operating guide for this repo. Read this first; it captures how the project is
built, how we ship, and how photos get from the drive onto the live site.

## What this is

A minimalist photography gallery for **Sam Duckworth** (Northern Beaches drone +
travel work). React/Vite SPA, Supabase backend (Postgres + Storage + Auth),
deployed on Vercel at **https://samduckworth.com**.

- **Stack:** React 19, Vite 6, TypeScript, `@supabase/supabase-js`,
  `lucide-react` (icons), plain CSS (no Tailwind). `sharp` + `exif-reader` are
  used only by the Node import scripts, not the app bundle.
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
  App.tsx             the whole app — public gallery (/) + admin (/admin)
  lib/supabase.ts     all Supabase data access (read + write helpers)
  types.ts            Photo, GalleryLocation types
  data/photos.ts      fallback data when Supabase env is absent
  styles.css          all styling
public/               favicon.svg, apple-touch-icon.png, og-image.png
supabase/migrations/  DB schema + RLS + storage bucket
scripts/              import / geo / ops pipeline (Node ESM .mjs)
```

### App.tsx components (single file)
- **PublicGallery** (`/`): Hero (rotating location ticker), RecentWork mosaic,
  LocationRail (filter tabs), GalleryControls (flow/box view toggle), Gallery,
  Lightbox, AboutOverlay, InstagramRail. When an admin is signed in, tiles get
  inline edit/unpublish/send-to-top and a RecentPicker.
- **AdminApp** (`/admin`): email/password login → AdminDashboard (upload,
  bulk publish/rename/move, per-photo edit/delete/feature, create location).
- **SmartImage**: shimmer skeleton + fade-in so images never flash half-loaded.

## Data model & conventions (Supabase)

`photos`: `title`, `slug` (unique), `location_id` → `locations`, `kind`,
`year_taken`, `aspect` (`portrait|landscape|square|wide`), `storage_bucket`,
`storage_path`, `is_featured`, `is_published`, `sort_order`.

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

## Deploy / domain

- Push to `main` → Vercel builds + deploys.
- Domain **samduckworth.com** on GoDaddy DNS → Vercel: apex `A @ 216.198.79.1`,
  `CNAME www → <vercel-dns>`; Google Workspace MX records are untouched.
- Vercel env vars mirror `.env.local`'s `VITE_*`. Keep `VITE_SITE_URL` and the
  OG tags in `index.html` pointing at the live domain.

## Photo import & sync pipeline (`scripts/`, all Node ESM)

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

**Manifests** (in `imports/`, the storage_path → sourcePath maps):
`uploaded-drone-manifest.json` (original 103), `import-batch-manifest.json`
(2021+ batch), `europe-manifest.json` (Europe trip).

### Adding the next photo batch
For a phone/drone dump from a trip: drop the JPGs in a folder, then
`geo-bucket` → review/rename folders → `geo-recountry` → `import-folders`. For
curated drive exports, use Route A. Country→precise keeps the location selector
tight while preserving precise names per photo.

## Admin capabilities (built)

Edit details, publish/unpublish, delete (row + storage file), feature/Recent
Work slots, send-to-top, bulk rename, bulk move-to-location, create location —
from `/admin` and (edit/unpublish/send-to-top) inline on the live gallery when
signed in.
