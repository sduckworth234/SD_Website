-- Lets an admin choose which photo represents each place in the home page's
-- "drone feed" map promo. Flagged photos lead the feed; unflagged places fall
-- back to an auto-pick. Nullable not needed — defaults to false.
alter table public.photos
  add column if not exists is_map_feature boolean not null default false;

comment on column public.photos.is_map_feature is
  'Admin-picked feature photo for its location in the home page map promo feed.';
