-- Admin-editable print pricing. Was two hand-kept-in-sync hardcoded constants
-- (server/shop/catalogue.mjs PRINT_SIZES, src/lib/printCatalogue.ts SIZES) —
-- this table is now the single source of truth both read from. Flat pricing:
-- one sell price per size/mount combo, same for every photo (per Sam's
-- instruction, 2026-08-17) — no per-photo column here by design.
create table public.print_pricing (
  size text not null check (size in ('A5', 'A4', 'A3', 'A2', 'A1')),
  mounted boolean not null,
  sell_cents integer not null check (sell_cents >= 0),
  -- Cached from Prodigi's live /quotes endpoint (server/shop/prodigi.mjs) —
  -- refreshed on demand from the admin Pricing tab, not on every read. Null
  -- until the first refresh. Cost is business-sensitive: admin-only, never
  -- granted to anon (contrast with sell_cents below).
  cost_cents integer,
  shipping_cents integer,
  cost_source text,
  cost_checked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (size, mounted)
);

comment on table public.print_pricing is
  'Admin-editable flat print pricing (one row per size/mount combo, same price for every photo). sell_cents is what customers pay — public. cost_cents/shipping_cents are Prodigi''s live cost, refreshed on demand — admin-only, for margin visibility.';

-- Seed with the exact values that were hardcoded before this table existed,
-- so nothing changes price-wise the moment this migration runs.
insert into public.print_pricing (size, mounted, sell_cents) values
  ('A5', false, 5110), ('A5', true, 5710),
  ('A4', false, 5710), ('A4', true, 5710),
  ('A3', false, 7510), ('A3', true, 7710),
  ('A2', false, 9510), ('A2', true, 11010),
  ('A1', false, 13655), ('A1', true, 16155)
on conflict (size, mounted) do nothing;

alter table public.print_pricing enable row level security;

-- Column-level split, same fail-closed pattern as photos (202606060001):
-- anon/authenticated get only what the shop UI needs to display a price.
-- cost_cents/shipping_cents/cost_source/cost_checked_at stay admin-only.
grant select (size, mounted, sell_cents, updated_at) on public.print_pricing to anon, authenticated;
grant select on public.print_pricing to service_role;

-- Reads are open (it's not per-user data); writes require is_admin(). No
-- policy needed for the public read since RLS + the column grant above
-- already combine to expose only the safe columns to anon/authenticated —
-- but RLS is still enabled, so an explicit permissive SELECT policy is
-- required or every role (including admins) would see zero rows.
create policy "print_pricing_select" on public.print_pricing for select using (true);
create policy "print_pricing_admin_write" on public.print_pricing for all
  using (public.is_admin()) with check (public.is_admin());
