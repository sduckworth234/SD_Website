-- Companion to source_path (202606060001): source_path records the EDITED
-- export a photo was published from; raw_source_path records the original
-- camera RAW/high-res file it was derived from, where one could be found on
-- the drive. Built by matching each export's own EXIF capture timestamp
-- against raw files found near it (sibling "Original"/"Raw" folders, the
-- Lightroom catalog, or embedded-filename matches) — see
-- imports/photo-source-lookup.json for the full audit trail this was built
-- from, and scripts/raw-source-backfill.mjs for the one-shot backfill.
--
-- Purpose: this is the resolution ceiling for what a photo can be sold as —
-- the shop's REQUIRED pixel-dimension map (src/components/AdminOrders.tsx)
-- validates a print master against these dims at upload time, but until now
-- there was no way to know in advance, across the whole catalogue, which
-- photos could even support A2/A1 prints without going and looking.
--
-- PRIVACY: same posture as source_path — a private drive path, admin-only,
-- must never reach the anon API. Simply omitting these columns from the
-- anon SELECT allow-list in 202606060001 is sufficient (that grant is an
-- allow-list, fail-closed for any new column), so no grant changes needed
-- here.
alter table public.photos
  add column if not exists raw_source_path text,
  add column if not exists raw_width integer,
  add column if not exists raw_height integer,
  add column if not exists raw_match_confidence text,
  add column if not exists raw_match_notes text;

comment on column public.photos.raw_source_path is
  'Absolute path to the original camera RAW/high-res file the export was derived from, where found. Private — admin-only, never exposed to anon.';
comment on column public.photos.raw_width is
  'True pixel width of the raw file at raw_source_path (read via macOS `sips`, which decodes RAW/DNG correctly — sharp/exifr often only see an embedded thumbnail).';
comment on column public.photos.raw_height is
  'True pixel height of the raw file at raw_source_path.';
comment on column public.photos.raw_match_confidence is
  'How raw_source_path was determined: exact_timestamp | filename_match | none. "none" means no raw was found after a genuine search — source_path (the export) is the highest-quality file available for that photo.';
comment on column public.photos.raw_match_notes is
  'Free-text note on how the match was made or, for confidence=none, what was checked before concluding no raw exists.';
