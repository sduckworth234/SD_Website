-- Photo capture coordinates for the interactive map. Like altitude, GPS was only
-- used at import time to assign locations and was stripped by WebP compression, so
-- lat/lon are backfilled from the original source JPGs (EXIF GPS, with a DJI-XMP
-- fallback) — see scripts/coords-*.mjs. Nullable: photos without GPS fall back to
-- their location's centroid on the map. Stored rounded to ~3 decimals (~100 m).
alter table public.photos
  add column if not exists latitude numeric,
  add column if not exists longitude numeric;

comment on column public.photos.latitude is
  'Capture latitude (decimal degrees, ~3dp) from the source JPG. Null if no GPS.';
comment on column public.photos.longitude is
  'Capture longitude (decimal degrees, ~3dp) from the source JPG. Null if no GPS.';
