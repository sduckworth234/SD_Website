-- Pricing repair + paper/artist-fee/print-only.
--
-- WHY THIS EXISTS
-- ---------------
-- 20260821030000_frameshop_print_pricing.sql was never applied to production.
-- Verified live on 2026-09-02, production still had the ORIGINAL shape of
-- public.print_pricing_components (size, frame_cost_cents, mat_width_cm,
-- mat_cost_cents, glass_cost_cents), while print_pricing_colours HAD been
-- hand-edited to the old 224-series multipliers (black 0.9, natural 1.1,
-- white 0.9), print_pricing_glazing had no 'none' row (20260821130000 also
-- unapplied), and site_settings.print_margin_percent had been raised to 40.
--
-- Consequence: the browser's pricing read 400'd on the components select and
-- silently kept its hardcoded fallback components while still applying the
-- live colour multipliers and the live 40% margin; the server's read threw on
-- the same 400 and fell back to a COMPLETE fallback with a 15% margin and 1.0
-- multipliers. Customers were shown one price (A3 wood mounted clear
-- $175.17) and charged another ($134.09). Nothing compared the two.
--
-- This migration is written to be safe against BOTH live states — the old
-- shape and the 20260821 shape — and against a database where the table does
-- not exist at all. Every step is idempotent.
--
-- The code side of the fix is independent of this migration: the client now
-- applies live pricing ALL-OR-NOTHING (any failed read falls back to the
-- complete hardcoded constants, margin included), those constants are
-- byte-identical to the server's, and checkout now rejects a cart whose
-- client-quoted price does not match the server-computed price. So the site
-- prices correctly and consistently even while this migration is unapplied.
--
-- THE FORMULA (mirrored exactly in src/lib/printCatalogue.ts and
-- server/shop/catalogue.mjs — all three must stay in sync; integer cents on
-- both sides so client and server always agree to the cent):
--
--   frame_cents   = framed ? (mounted ? frame_cost_mounted_cents
--                                     : frame_cost_unmounted_cents)
--                            * colour.cost_multiplier
--                          : 0
--   mat_cents     = (framed and mounted) ? mat_cost_cents : 0
--   glass_cents   = framed ? (mounted ? glass_cost_mounted_cents
--                                     : glass_cost_unmounted_cents)
--                            * glazing.cost_multiplier
--                          : 0
--   paper_cents   = print_pricing_paper.cost_<size>_cents
--
--   product_cost  = frame_cents + mat_cents + glass_cents + paper_cents
--   sell_cents    = round_to_price_point(
--                     round(product_cost * (1 + margin_percent/100))
--                     + artist_fee_cents )
--
--   round_to_price_point(c) = ceil(c / 500) * 500 - 100
--     i.e. round UP to the next whole $5 then take $1 off, so every
--     customer-facing price is a clean point: $176.17 -> $179, $48.33 -> $49.
--
-- Shipping is deliberately NOT part of this — see estimateShipping() /
-- estimateShippingCents(), which total once per cart with real multi-item
-- consolidation (and now a cheaper rolled-tube tier for print-only orders)
-- rather than once per item.

-- ---------------------------------------------------------------------------
-- 1. print_pricing_components — converge on the 20260821 shape, + artist fee
-- ---------------------------------------------------------------------------

-- Covers a database where the table was never created at all. Columns are
-- created nullable so the "already exists in some shape" path below is
-- identical either way.
create table if not exists public.print_pricing_components (
  size       text primary key check (size in ('A5', 'A4', 'A3', 'A2', 'A1')),
  updated_at timestamptz not null default now()
);

alter table public.print_pricing_components
  add column if not exists frame_cost_unmounted_cents integer,
  add column if not exists frame_cost_mounted_cents   integer,
  add column if not exists mat_width_cm               numeric(4,1),
  add column if not exists mat_cost_cents             integer,
  add column if not exists glass_cost_unmounted_cents integer,
  add column if not exists glass_cost_mounted_cents   integer,
  -- NEW: the value of the photograph itself, on top of Frameshop's cost.
  -- Added after margin (margin covers the fulfilment cost; the artist fee is
  -- not marked up), so raising it raises the price dollar for dollar.
  -- Seeded with sensible defaults — Sam edits these in Admin -> Shop.
  add column if not exists artist_fee_cents           integer;

-- Canonical, live-verified Frameshop 103RO numbers (checked 2026-08-21, frame
-- + mat; glass re-checked unmounted 2026-09-02 and unchanged). Inserted for
-- any missing size, then used to fill any column that is still null — which
-- is exactly the set of columns the old production shape was missing.
insert into public.print_pricing_components (
  size, frame_cost_unmounted_cents, frame_cost_mounted_cents, mat_width_cm,
  mat_cost_cents, glass_cost_unmounted_cents, glass_cost_mounted_cents, artist_fee_cents
) values
  ('A5',  3280,  4370, 2.5,  680,  500,  600,  2000),
  ('A4',  5020,  6880, 3.7, 1200,  700,  800,  3500),
  ('A3',  7210,  8520, 4.8, 1740,  900, 1400,  6000),
  ('A2', 10050, 12010, 5.0, 2420, 1900, 2520, 11000),
  ('A1', 14530, 16600, 4.8, 4360, 3470, 5150, 18000)
on conflict (size) do nothing;

update public.print_pricing_components as c
set frame_cost_unmounted_cents = coalesce(c.frame_cost_unmounted_cents, v.frame_unmounted),
    frame_cost_mounted_cents   = coalesce(c.frame_cost_mounted_cents,   v.frame_mounted),
    mat_width_cm               = coalesce(c.mat_width_cm,               v.mat_width),
    mat_cost_cents             = coalesce(c.mat_cost_cents,             v.mat_cost),
    glass_cost_unmounted_cents = coalesce(c.glass_cost_unmounted_cents, v.glass_unmounted),
    glass_cost_mounted_cents   = coalesce(c.glass_cost_mounted_cents,   v.glass_mounted),
    artist_fee_cents           = coalesce(c.artist_fee_cents,           v.artist_fee)
from (values
  ('A5',  3280,  4370, 2.5::numeric,  680,  500,  600,  2000),
  ('A4',  5020,  6880, 3.7::numeric, 1200,  700,  800,  3500),
  ('A3',  7210,  8520, 4.8::numeric, 1740,  900, 1400,  6000),
  ('A2', 10050, 12010, 5.0::numeric, 2420, 1900, 2520, 11000),
  ('A1', 14530, 16600, 4.8::numeric, 4360, 3470, 5150, 18000)
) as v(size, frame_unmounted, frame_mounted, mat_width, mat_cost, glass_unmounted, glass_mounted, artist_fee)
where c.size = v.size;

-- The pre-20260821 columns. Dropped only now that everything above them is
-- populated, so a partially-applied run can be re-run safely.
alter table public.print_pricing_components
  drop column if exists frame_cost_cents,
  drop column if exists glass_cost_cents;

alter table public.print_pricing_components
  alter column frame_cost_unmounted_cents set not null,
  alter column frame_cost_mounted_cents   set not null,
  alter column mat_width_cm               set not null,
  alter column mat_cost_cents             set not null,
  alter column glass_cost_unmounted_cents set not null,
  alter column glass_cost_mounted_cents   set not null,
  alter column artist_fee_cents           set not null;

alter table public.print_pricing_components
  drop constraint if exists print_pricing_components_frame_cost_unmounted_cents_check,
  drop constraint if exists print_pricing_components_frame_cost_mounted_cents_check,
  drop constraint if exists print_pricing_components_mat_cost_cents_check,
  drop constraint if exists print_pricing_components_glass_cost_unmounted_cents_check,
  drop constraint if exists print_pricing_components_glass_cost_mounted_cents_check,
  drop constraint if exists print_pricing_components_artist_fee_cents_check;

alter table public.print_pricing_components
  add constraint print_pricing_components_frame_cost_unmounted_cents_check check (frame_cost_unmounted_cents > 0),
  add constraint print_pricing_components_frame_cost_mounted_cents_check   check (frame_cost_mounted_cents > 0),
  add constraint print_pricing_components_mat_cost_cents_check             check (mat_cost_cents >= 0),
  add constraint print_pricing_components_glass_cost_unmounted_cents_check check (glass_cost_unmounted_cents > 0),
  add constraint print_pricing_components_glass_cost_mounted_cents_check   check (glass_cost_mounted_cents > 0),
  add constraint print_pricing_components_artist_fee_cents_check           check (artist_fee_cents >= 0);

comment on table public.print_pricing_components is
  'Per-size Frameshop base costs (103RO frame, single mat, Clear Glass, MDF backing) plus the per-size artist fee. Frame and glass costs are genuinely different mounted vs unmounted (a mounted print needs a physically bigger frame and glazing to cover the mat) — not the unmounted cost plus a mat on top. Shipping is not here; see estimateShipping() in src/lib/printCatalogue.ts.';
comment on column public.print_pricing_components.artist_fee_cents is
  'The value of the photograph itself, added AFTER margin (margin covers fulfilment cost; the artist fee is not marked up). Seeded 2026-09-02 with A5 $20 / A4 $35 / A3 $60 / A2 $110 / A1 $180 as a starting point — admin-editable.';

-- ---------------------------------------------------------------------------
-- 2. print_pricing_colours — make sure the table exists, every id is seeded,
--    and any leftover 224-series multiplier is reset.
-- ---------------------------------------------------------------------------

create table if not exists public.print_pricing_colours (
  id              text primary key check (id in ('natural', 'black', 'white')),
  label           text not null,
  frame_code      text not null,
  cost_multiplier numeric(4,3) not null check (cost_multiplier > 0),
  updated_at      timestamptz not null default now()
);

insert into public.print_pricing_colours (id, label, frame_code, cost_multiplier) values
  ('natural', 'Wood',  '103RO', 1.000),
  ('black',   'Black', '103F',  1.000),
  ('white',   'White', '103H',  1.000)
on conflict (id) do nothing;

-- Production's rows still carried the 224-series codes and multipliers
-- (natural 1.1, black/white 0.9) from a frame choice that was abandoned:
-- 224 was too thin a moulding for A2/A1 and Frameshop's own configurator
-- rejected it. The components above are 103-series costs, and 103RO/103F/103H
-- all share Frameshop's Price Rate 5 — verified identical at A2 — so every
-- multiplier must be 1.0 against them. Reset only rows still pointing at a
-- 224 moulding, so a deliberate future edit on the 103 codes is not clobbered.
update public.print_pricing_colours
set frame_code = case id when 'natural' then '103RO' when 'black' then '103F' else '103H' end,
    cost_multiplier = 1.000,
    updated_at = now()
where frame_code like '224%';

-- ---------------------------------------------------------------------------
-- 3. print_pricing_glazing — table, the relaxed constraints and the 'none' row
--    from 20260821130000, all made idempotent.
-- ---------------------------------------------------------------------------

create table if not exists public.print_pricing_glazing (
  id              text primary key,
  label           text not null,
  description     text not null,
  cost_multiplier numeric(4,3) not null,
  updated_at      timestamptz not null default now()
);

alter table public.print_pricing_glazing
  drop constraint if exists print_pricing_glazing_id_check,
  drop constraint if exists print_pricing_glazing_cost_multiplier_check;

alter table public.print_pricing_glazing
  add constraint print_pricing_glazing_id_check
    check (id in ('clear', 'non_reflective', 'perspex', 'uv_clear', 'uv_non_reflective', 'none')),
  -- Glazing (unlike colour) can legitimately cost nothing — an empty frame.
  add constraint print_pricing_glazing_cost_multiplier_check check (cost_multiplier >= 0);

insert into public.print_pricing_glazing (id, label, description, cost_multiplier) values
  ('clear',             'Clear Glass',             'Standard 2mm clear framing glass. The most cost-effective option.', 1.000),
  ('non_reflective',    'Non-Reflective Glass',    '2mm matte-coated glass that reduces glare — good for bright rooms.', 2.000),
  ('perspex',           'Clear Perspex (Acrylic)', 'Lightweight, shatter-resistant 2-3mm acrylic with 94% UV resistance.', 2.000),
  ('uv_clear',          'UV Clear Glass',          '2.5mm premium glass, 99% UV protection, same clear look as standard glass.', 2.830),
  ('uv_non_reflective', 'UV Non-Reflective Glass', '2.5mm glass combining anti-glare and 99% UV protection.', 5.630),
  ('none',              'No Glass',                'An empty frame with no glazing — for canvas or already-protected artwork.', 0.000)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. print_pricing_paper — NEW. Frameshop prices printing by paper AND size
--    (Epson P20070), so this is explicit per-size cents rather than a
--    multiplier. Read live from frameshop.com.au's "Printing" tab on
--    2026-09-02.
--
--    Semi-Gloss (Luster) and Matte Smooth (Archival) are the same price;
--    High Gloss (Metallic) is 1.3x and Cotton Rag (Smooth) is 1.8x. Only the
--    two that fit the brand are seeded and offered: Matte Smooth (Archival)
--    as the default — it is what the site's "archival matte" copy already
--    promises — with Cotton Rag as the premium upgrade. The gloss papers are
--    deliberately not sold.
--
--    A5 Cotton Rag ($18.36) is derived at exactly 1.8x the archival price;
--    the live reading for that one cell was stale. Every other cell is a
--    direct reading.
-- ---------------------------------------------------------------------------

create table if not exists public.print_pricing_paper (
  id            text primary key check (id in ('archival_matte', 'cotton_rag')),
  label         text not null,
  description   text not null,
  cost_a5_cents integer not null check (cost_a5_cents >= 0),
  cost_a4_cents integer not null check (cost_a4_cents >= 0),
  cost_a3_cents integer not null check (cost_a3_cents >= 0),
  cost_a2_cents integer not null check (cost_a2_cents >= 0),
  cost_a1_cents integer not null check (cost_a1_cents >= 0),
  sort_order    integer not null default 0,
  updated_at    timestamptz not null default now()
);

comment on table public.print_pricing_paper is
  'Per-size printing (paper) cost, read live from frameshop.com.au''s Printing tab on 2026-09-02. Explicit cents per size rather than a multiplier because Frameshop prices printing by paper and size independently. Applies to framed prints AND to the unframed "print only" (rolled) product, which is paper + artist fee only.';

insert into public.print_pricing_paper (id, label, description, cost_a5_cents, cost_a4_cents, cost_a3_cents, cost_a2_cents, cost_a1_cents, sort_order) values
  ('archival_matte', 'Archival matte',
   'Matte smooth archival paper — deep blacks, no glare, the house standard.',
   1020, 1560, 2730, 4480, 7680, 0),
  ('cotton_rag',     'Cotton rag',
   '100% cotton rag, smooth textured surface — the softest, most tactile finish.',
   1836, 2808, 4914, 8064, 13824, 1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. RLS + grants — same posture as the other pricing tables: public read
--    (the shop has to be able to show a price), admin-only write.
-- ---------------------------------------------------------------------------

alter table public.print_pricing_components enable row level security;
alter table public.print_pricing_colours    enable row level security;
alter table public.print_pricing_glazing    enable row level security;
alter table public.print_pricing_paper      enable row level security;

grant select on public.print_pricing_components, public.print_pricing_colours,
                public.print_pricing_glazing, public.print_pricing_paper
  to anon, authenticated;
grant select on public.print_pricing_components, public.print_pricing_colours,
                public.print_pricing_glazing, public.print_pricing_paper
  to service_role;

drop policy if exists "print_pricing_components_select"      on public.print_pricing_components;
drop policy if exists "print_pricing_components_admin_write" on public.print_pricing_components;
create policy "print_pricing_components_select" on public.print_pricing_components for select using (true);
create policy "print_pricing_components_admin_write" on public.print_pricing_components for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "print_pricing_colours_select"      on public.print_pricing_colours;
drop policy if exists "print_pricing_colours_admin_write" on public.print_pricing_colours;
create policy "print_pricing_colours_select" on public.print_pricing_colours for select using (true);
create policy "print_pricing_colours_admin_write" on public.print_pricing_colours for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "print_pricing_glazing_select"      on public.print_pricing_glazing;
drop policy if exists "print_pricing_glazing_admin_write" on public.print_pricing_glazing;
create policy "print_pricing_glazing_select" on public.print_pricing_glazing for select using (true);
create policy "print_pricing_glazing_admin_write" on public.print_pricing_glazing for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "print_pricing_paper_select"      on public.print_pricing_paper;
drop policy if exists "print_pricing_paper_admin_write" on public.print_pricing_paper;
create policy "print_pricing_paper_select" on public.print_pricing_paper for select using (true);
create policy "print_pricing_paper_admin_write" on public.print_pricing_paper for all
  using (public.is_admin()) with check (public.is_admin());

-- Margin lives in the generic settings table. Production already has this set
-- to 40; the insert only seeds a fresh environment.
insert into public.site_settings (key, value) values ('print_margin_percent', '40')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 6. order_items — remember the paper and whether the order was framed at all
-- ---------------------------------------------------------------------------

alter table public.order_items
  add column if not exists paper text not null default 'archival_matte',
  -- false = the new unframed "print only" product: a rolled print in a tube,
  -- no frame, no mat, no glazing.
  add column if not exists framed boolean not null default true;

alter table public.order_items drop constraint if exists order_items_paper_check;
alter table public.order_items
  add constraint order_items_paper_check check (paper in ('archival_matte', 'cotton_rag'));

alter table public.order_items drop constraint if exists order_items_glazing_check;
alter table public.order_items
  add constraint order_items_glazing_check
    check (glazing in ('clear', 'non_reflective', 'perspex', 'uv_clear', 'uv_non_reflective', 'none'));

comment on column public.order_items.paper is
  'Paper stock chosen for this print — see print_pricing_paper. Defaults to archival_matte for orders placed before paper was selectable.';
comment on column public.order_items.framed is
  'False for the unframed "print only" product (rolled in a tube). Defaults true so pre-existing orders read correctly.';

-- create_paid_order has to write the two new columns. Recreated in full
-- (a function body can only be replaced, not altered) — identical to the
-- version in 20260821030000_frameshop_print_pricing.sql apart from the
-- order_items insert now also carrying paper and framed.
create or replace function public.create_paid_order(p_order jsonb, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  new_order_id uuid;
begin
  insert into public.orders (
    stripe_checkout_session_id, stripe_payment_intent_id, status,
    customer_email, customer_name, shipping_address, currency,
    subtotal_cents, shipping_cents, discount_cents, discount_code, total_cents,
    fulfilment_provider, stripe_receipt_url, stripe_invoice_id,
    stripe_invoice_url, stripe_invoice_pdf, delivery_method
  ) values (
    p_order->>'stripe_checkout_session_id',
    nullif(p_order->>'stripe_payment_intent_id', ''),
    p_order->>'status',
    p_order->>'customer_email',
    p_order->>'customer_name',
    p_order->'shipping_address',
    coalesce(p_order->>'currency', 'AUD'),
    (p_order->>'subtotal_cents')::integer,
    (p_order->>'shipping_cents')::integer,
    coalesce((p_order->>'discount_cents')::integer, 0),
    nullif(p_order->>'discount_code', ''),
    (p_order->>'total_cents')::integer,
    coalesce(nullif(p_order->>'fulfilment_provider', ''), 'manual'),
    nullif(p_order->>'stripe_receipt_url', ''),
    nullif(p_order->>'stripe_invoice_id', ''),
    nullif(p_order->>'stripe_invoice_url', ''),
    nullif(p_order->>'stripe_invoice_pdf', ''),
    coalesce(nullif(p_order->>'delivery_method', ''), 'delivery')
  ) returning id into new_order_id;

  insert into public.order_items (
    order_id, photo_id, title, location, thumb_url, size, mounted,
    colour, glazing, paper, framed, sku, unit_price_cents, print_master_path,
    print_master_width, print_master_height
  )
  select
    new_order_id,
    (item->>'photo_id')::uuid,
    item->>'title',
    item->>'location',
    item->>'thumb_url',
    item->>'size',
    (item->>'mounted')::boolean,
    item->>'colour',
    coalesce(item->>'glazing', 'clear'),
    coalesce(item->>'paper', 'archival_matte'),
    coalesce((item->>'framed')::boolean, true),
    item->>'sku',
    (item->>'unit_price_cents')::integer,
    nullif(item->>'print_master_path', ''),
    (item->>'print_master_width')::integer,
    (item->>'print_master_height')::integer
  from jsonb_array_elements(p_items) as entries(item);

  if jsonb_array_length(p_items) = 0 then
    raise exception 'A paid order must contain at least one item';
  end if;

  return new_order_id;
end;
$$;

revoke all on function public.create_paid_order(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_paid_order(jsonb, jsonb) to service_role;
