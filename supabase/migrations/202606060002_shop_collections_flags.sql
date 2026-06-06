-- Phase 3: Framed Editions print shop + home collection curation + public
-- visibility flags. Three concerns, one migration:
--
--  1) photos.collection_order  — per-location "feature in the home card" pick.
--     The home page's slowly-cycling location tiles default to a location's
--     first few photos by gallery order; setting collection_order pins an
--     explicit, ordered set instead (asc; NULL = not pinned / auto-fill).
--  2) photos.in_shop / shop_order — which photos are sold as Framed Editions on
--     /shop and in what order (asc). Frame orientation derives from `aspect`.
--  3) public.site_settings — a tiny key/value + on/off table powering the admin
--     "Visibility" panel (toggle pages/cards public vs hidden) and storing the
--     two chosen Framed Editions banner photos. Anon reads; only admins write.

-- 1 + 2: new photo columns --------------------------------------------------
alter table public.photos
  add column if not exists collection_order int,
  add column if not exists in_shop boolean not null default false,
  add column if not exists shop_order int;

comment on column public.photos.collection_order is
  'If set, pins this photo into its location''s home collection card at this order (asc). NULL = auto-fill by gallery order.';
comment on column public.photos.in_shop is
  'Whether this photo is offered as a Framed Edition print on /shop.';
comment on column public.photos.shop_order is
  'Manual ordering of in_shop photos on /shop (asc). NULL sorts last.';

-- These three are display-only (unlike the private source_path), so the public
-- gallery may read them. The anon SELECT is a column allow-list (see
-- 202606060001_photo_source_path) — extend it additively for the new columns.
grant select (collection_order, in_shop, shop_order) on public.photos to anon;

-- 3: site_settings ----------------------------------------------------------
create table if not exists public.site_settings (
  key        text primary key,
  enabled    boolean not null default true,
  value      text,
  label      text,
  updated_at timestamptz not null default now()
);

comment on table public.site_settings is
  'Key/value + on-off switches: public visibility flags and small site settings (e.g. chosen banner photos). Anon reads; admins write.';

drop trigger if exists site_settings_set_updated_at on public.site_settings;
create trigger site_settings_set_updated_at
  before update on public.site_settings
  for each row execute function public.set_updated_at();

alter table public.site_settings enable row level security;

drop policy if exists "Anon can read site settings" on public.site_settings;
create policy "Anon can read site settings"
on public.site_settings for select
to anon
using (true);

drop policy if exists "Authenticated can read site settings" on public.site_settings;
create policy "Authenticated can read site settings"
on public.site_settings for select
to authenticated
using (true);

drop policy if exists "Admins can insert site settings" on public.site_settings;
create policy "Admins can insert site settings"
on public.site_settings for insert
to authenticated
with check (public.is_admin());

drop policy if exists "Admins can update site settings" on public.site_settings;
create policy "Admins can update site settings"
on public.site_settings for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can delete site settings" on public.site_settings;
create policy "Admins can delete site settings"
on public.site_settings for delete
to authenticated
using (public.is_admin());

grant select on public.site_settings to anon;
grant select, insert, update, delete on public.site_settings to authenticated;

-- Seed the visibility flags (idempotent). Shop starts hidden (admin-only).
insert into public.site_settings (key, enabled, label) values
  ('shop_public',      false, 'Shop page — public'),
  ('framed_banner',    true,  'Home — Framed Editions banner'),
  ('collection_cards', true,  'Home — location collection cards'),
  ('map_promo',        true,  'Home — map promo card')
on conflict (key) do nothing;

-- Banner photo slots (value = photo id). Created empty; admin picks them.
insert into public.site_settings (key, enabled, value, label) values
  ('banner_portrait',  true, null, 'Banner frame — portrait photo'),
  ('banner_landscape', true, null, 'Banner frame — landscape photo')
on conflict (key) do nothing;
