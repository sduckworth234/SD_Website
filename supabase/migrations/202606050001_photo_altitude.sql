-- Drone photos carry their flight height (metres above the takeoff point) in the
-- DJI XMP packet (drone-dji:RelativeAltitude). Compression to WebP strips EXIF/XMP,
-- so this is backfilled from the original source JPGs (see scripts/altitude-*.mjs)
-- and stored here. Nullable: non-drone photos (and any drone shot without the tag)
-- simply have no altitude and get no badge in the gallery.
alter table public.photos
  add column if not exists relative_altitude_m numeric;

comment on column public.photos.relative_altitude_m is
  'Drone flight height in metres above the takeoff point (DJI RelativeAltitude). Null for non-drone photos.';
