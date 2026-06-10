-- Exact image proportion (width / height) per photo, so the gallery masonry
-- can reserve every tile's true shape BEFORE the image loads — the layout is
-- final from the first frame instead of reflowing as each image arrives.
-- Backfilled by scripts/ratio-backfill.mjs (reads each stored WebP's
-- dimensions); photos without it fall back to a nominal ratio per aspect
-- bucket in the app.
alter table public.photos
  add column if not exists ratio numeric(6, 4);

comment on column public.photos.ratio is
  'Image width / height (e.g. 1.5 for 3:2). Drives stable gallery tile sizing; null falls back to the aspect bucket.';

-- The photos column grants are fail-closed allow-lists (see the source_path
-- and authenticated-hardening migrations) — a new public column must be
-- granted explicitly or the gallery cannot read it.
grant select (ratio) on public.photos to anon, authenticated;
