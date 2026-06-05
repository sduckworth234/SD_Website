-- Admin-controlled ordering of locations in the home page map-promo "drone feed".
-- Lower = appears earlier. Defaults to 0 (then the app falls back to photo count).
alter table public.locations
  add column if not exists map_feed_order integer not null default 0;

comment on column public.locations.map_feed_order is
  'Order of this location in the home page map-promo feed (lower = earlier).';
