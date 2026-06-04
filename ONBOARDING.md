# Onboarding — Sam Duckworth Photography

Welcome. This is the photography gallery at **https://samduckworth.com** —
a React/Vite SPA backed by Supabase, deployed on Vercel. This guide gets you
productive fast. For the deep reference, read **`CLAUDE.md`**.

## 1. Run it locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc -b && vite build — run this before pushing code
```

You need `.env.local` (gitignored) with the Supabase vars — see `README.md`.
Without it the app falls back to bundled sample data (`src/data/photos.ts`).

## 2. How we ship

- **Push straight to `main`.** No PRs. Vercel auto-deploys on push.
- **Build before pushing code changes** (`npm run build`).
- Data changes (Supabase rows via the import scripts) go live instantly — the
  gallery reads Supabase at runtime, no redeploy needed.

## 3. The shape of it

- `src/App.tsx` — the entire app: public gallery (`/`) and admin (`/admin`).
- `src/lib/supabase.ts` — every read/write to Supabase.
- `src/styles.css` — all styling (plain CSS).
- `supabase/migrations/` — schema, RLS, storage bucket.
- `scripts/` — Node import/geo/ops pipeline.

**Data model:** `photos` (title, location_id, year_taken, aspect, storage_path,
is_published, is_featured, sort_order) + `locations` (the filter tabs).
Key conventions:
- `location` = the **filter category** (a place like *Manly* for local work,
  a **country** like *Italy* for overseas trips, to keep the selector tight).
- `title` = the **precise place** shown on the photo.
- `is_published` = public visibility; `is_featured`+`sort_order 1–5` = the
  "Recent Work" mosaic; "Unsorted" (no location) is hidden from the public.

## 4. Admin

`/admin` → email/password (the user must be in `public.admin_users`). From
there: upload, edit/delete, publish, feature/Recent Work, bulk rename + move,
create locations, send-to-top. When signed in, photos are also editable inline
on the live gallery.

## 5. Adding photos (the important bit)

Photos come from the external drive `/Volumes/SamD2`. Two routes, run from
`scripts/` with `node --env-file=.env.local` and the Bash sandbox disabled
(drive access). Bulk writes use the **service-role key**
(`SUPABASE_SERVICE_ROLE_KEY` in `.env.local`).

- **Trip dump (GPS-based):** `geo-bucket.mjs` (GPS → reverse-geocode → move into
  precise folders) → review/rename folders → `geo-recountry.mjs` (nest under
  country) → `import-folders.mjs` (compress to WebP, upload, insert as
  Country → precise).
- **Curated drive exports:** `scan-import-candidates.mjs` → `refine-approved.mjs`
  → `import-batch.mjs`.
- **Backfill GPS onto old rows:** `geo-analyze-existing.mjs` (read-only) →
  `geo-update-existing.mjs`.

**Gotchas:** compression strips EXIF (read GPS from the *original* JPGs, mapped
via the `imports/*-manifest.json` files); `mdls` can't read the exFAT drive
(use `sharp` + `exif-reader`); reverse geocoding (Nominatim) is rate-limited;
all upload scripts are idempotent on `storage_path`. Full details + every knob
in `CLAUDE.md`.

## 6. Where to ask

`CLAUDE.md` is the source of truth for architecture, conventions, deploy, and
the pipeline. Start there for anything not covered here.
