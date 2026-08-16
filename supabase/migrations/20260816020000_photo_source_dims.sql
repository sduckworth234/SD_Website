-- Companion to raw_width/raw_height (20260816010000): those record the RAW
-- file's true pixel dimensions. source_width/source_height record the same
-- for the EXPORT at source_path — needed because most of the catalogue has
-- no raw master (only ~72% do; the 2022 Europe trip and a handful of others
-- genuinely have none, per Sam's confirmation the export is the sellable
-- asset there), so print-size gating needs a resolution figure to fall back
-- to. The production server has no filesystem access to the drive/export
-- files, so this has to be persisted at backfill/import time, not read live.
--
-- App-level "effective" dimensions for sizing = COALESCE(raw_width,
-- source_width), same for height. See server/shop/printSizing.mjs and
-- src/lib/printSizing.ts.
--
-- PRIVACY: same posture as source_path/raw_*columns — plain pixel counts,
-- not sensitive on their own, but kept out of the anon allow-list for
-- consistency (no legitimate anon use case) and because print-size gating
-- is computed server-side, never shipped to the browser as raw numbers.
alter table public.photos
  add column if not exists source_width integer,
  add column if not exists source_height integer;

comment on column public.photos.source_width is
  'True pixel width of the export at source_path (read via macOS `sips`). Fallback resolution figure for print-size gating when no raw master exists.';
comment on column public.photos.source_height is
  'True pixel height of the export at source_path.';

-- Derived, PUBLIC-safe print-size gating. The shop's product page needs to
-- know the largest size a given photo can be sold at (to disable oversized
-- options and show a subtle "best up to A2" hint) without a per-product API
-- round trip — it already loads the whole public catalogue in one batch
-- (getGalleryData / PUBLIC_PHOTO_COLUMNS). Storing just the derived size
-- label (not the pixel dimensions themselves) keeps raw_width/raw_height/
-- source_width/source_height genuinely private while still letting anon
-- read "this photo tops out at A2" — a size name leaks nothing about the
-- source file. Computed from effective dims (raw, falling back to export)
-- against src/lib/printCatalogue.ts's REQUIRED_PX table at backfill/import
-- time — see scripts/raw-source-backfill.mjs and the /import-photos skill.
alter table public.photos
  add column if not exists max_sellable_mounted text,
  add column if not exists max_sellable_unmounted text;

comment on column public.photos.max_sellable_mounted is
  'Largest size (A5..A1) sellable as a MOUNTED print at >=200dpi given the best available source file, or null if not even A5 mounted clears the floor. Derived, not raw pixel data — safe for anon.';
comment on column public.photos.max_sellable_unmounted is
  'Same as max_sellable_mounted but for UNMOUNTED prints (larger required pixel area for the same size).';

grant select (max_sellable_mounted, max_sellable_unmounted) on public.photos to anon;
