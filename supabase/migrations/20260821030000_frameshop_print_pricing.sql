-- Frameshop-based print pricing: replaces the old Prodigi-derived flat
-- per-size sell price with a component formula that prices every
-- size × mount × frame-colour × glazing combination from real Frameshop.com.au
-- costs (live-tested 2026-08-21 against their custom-picture-frames
-- configurator, frame 224RO/224F/224H).
--
-- Formula (mirrored in src/lib/printCatalogue.ts and server/shop/catalogue.mjs
-- — keep all three in sync):
--   product_cost = frame_cost_cents * colour multiplier
--                + (mounted ? mat_cost_cents : 0)
--                + glass_cost_cents * glazing multiplier
--   sell_cents   = round(product_cost * (1 + margin_percent/100))
--
-- Deliberately excludes shipping. Shipping stays the job of the site's
-- existing estimateShipping()/estimateShippingCents() (unchanged, still the
-- same verified AU courier quotes), which totals ONCE per cart with real
-- multi-item consolidation (+$5 for most extra prints, not a full shipping
-- charge each) rather than once per item — folding a shipping estimate into
-- every row here too would double-charge shipping on a multi-item order.
--
-- Colour and glazing multipliers were sampled once at A2 (see column
-- comments) and applied flat across all sizes — reasonable, not exact.
-- Frame cost and mat cost were verified LIVE at every size.

create table public.print_pricing_components (
  size               text primary key check (size in ('A5', 'A4', 'A3', 'A2', 'A1')),
  -- 224RO (Raw Oak / "Wood"), unmounted, Clear Glass, MDF backing — all
  -- verified live against frameshop.com.au on 2026-08-21.
  frame_cost_cents   integer not null check (frame_cost_cents > 0),
  mat_width_cm       numeric(4,1) not null,
  mat_cost_cents     integer not null check (mat_cost_cents >= 0),
  glass_cost_cents   integer not null check (glass_cost_cents > 0),
  updated_at         timestamptz not null default now()
);
comment on table public.print_pricing_components is
  'Per-size base costs (224RO frame, single mat, Clear Glass, MDF backing) that print_pricing_colours/print_pricing_glazing multiply and print_margin_percent turns into a sell price. Real Frameshop.com.au data, checked 2026-08-21 — see migration file header for the formula. Shipping is deliberately not here — see estimateShipping() in src/lib/printCatalogue.ts.';

insert into public.print_pricing_components (size, frame_cost_cents, mat_width_cm, mat_cost_cents, glass_cost_cents) values
  ('A5', 2190, 2.5, 680,  500),
  ('A4', 3170, 3.7, 1200, 700),
  ('A3', 4590, 4.8, 1740, 900),
  ('A2', 7050, 5.0, 2420, 1900),
  ('A1', 10980, 4.8, 4360, 3470)
on conflict (size) do nothing;

create table public.print_pricing_colours (
  id              text primary key check (id in ('natural', 'black', 'white')),
  label           text not null,
  frame_code      text not null,   -- real Frameshop moulding code, for reference/ordering
  -- Multiplied against frame_cost_cents only (mat/glass/backing are shared
  -- across colours — verified: Clear Glass cost was identical for 224RO and
  -- 224F at A2). Sampled once at A2: 224F/224RO ratio was 0.774 unmounted,
  -- 0.831 mounted — 0.80 splits the difference. 224H (white) shares 224F's
  -- Price Rate (both "Price Rate 2" vs 224RO's "Price Rate 3") so it's
  -- assumed to share the multiplier too — not independently verified.
  cost_multiplier numeric(4,3) not null check (cost_multiplier > 0),
  updated_at      timestamptz not null default now()
);
comment on table public.print_pricing_colours is
  'Frame colour cost multipliers vs. the 224RO (wood) base cost in print_pricing_components. Real Frameshop moulding codes kept for reference when ordering.';

insert into public.print_pricing_colours (id, label, frame_code, cost_multiplier) values
  ('natural', 'Wood', '224RO', 1.000),
  ('black',   'Black', '224F', 0.800),
  ('white',   'White', '224H', 0.800)
on conflict (id) do nothing;

create table public.print_pricing_glazing (
  id              text primary key check (id in ('clear', 'non_reflective', 'perspex', 'uv_clear', 'uv_non_reflective')),
  label           text not null,
  description     text not null,
  -- Multiplied against glass_cost_cents. Sampled once at A2 mounted
  -- (Clear Glass $25.20 baseline): Non-Reflective $50.40 (2.00x), Clear
  -- Perspex $50.60 (2.01x, rounded to 2.00), UV Clear $71.40 (2.83x),
  -- UV Non-Reflective $141.80 (5.63x).
  cost_multiplier numeric(4,3) not null check (cost_multiplier > 0),
  updated_at      timestamptz not null default now()
);
comment on table public.print_pricing_glazing is
  'Glazing (glass) type cost multipliers vs. Clear Glass cost in print_pricing_components. This is a different concept from the site''s existing "Canvas & glass" enquiry-only finishes — this is the glass IN FRONT of a framed print.';

insert into public.print_pricing_glazing (id, label, description, cost_multiplier) values
  ('clear',             'Clear Glass',            'Standard 2mm clear framing glass. The most cost-effective option.', 1.000),
  ('non_reflective',    'Non-Reflective Glass',    '2mm matte-coated glass that reduces glare — good for bright rooms.', 2.000),
  ('perspex',           'Clear Perspex (Acrylic)', 'Lightweight, shatter-resistant 2-3mm acrylic with 94% UV resistance.', 2.000),
  ('uv_clear',          'UV Clear Glass',          '2.5mm premium glass, 99% UV protection, same clear look as standard glass.', 2.830),
  ('uv_non_reflective', 'UV Non-Reflective Glass', '2.5mm glass combining anti-glare and 99% UV protection.', 5.630)
on conflict (id) do nothing;

-- Single margin figure, reusing the existing generic site_settings table
-- rather than a one-row table.
insert into public.site_settings (key, value) values ('print_margin_percent', '15')
on conflict (key) do nothing;

alter table public.print_pricing_components enable row level security;
alter table public.print_pricing_colours enable row level security;
alter table public.print_pricing_glazing enable row level security;

-- Same posture as print_pricing: public read (the shop needs these to show
-- a price), admin-only write. Costs here are less sensitive than Prodigi's
-- live-quoted costs (no ongoing API relationship to protect), so the whole
-- row is readable rather than a column-level split.
grant select on public.print_pricing_components, public.print_pricing_colours, public.print_pricing_glazing to anon, authenticated;
grant select on public.print_pricing_components, public.print_pricing_colours, public.print_pricing_glazing to service_role;

create policy "print_pricing_components_select" on public.print_pricing_components for select using (true);
create policy "print_pricing_components_admin_write" on public.print_pricing_components for all
  using (public.is_admin()) with check (public.is_admin());

create policy "print_pricing_colours_select" on public.print_pricing_colours for select using (true);
create policy "print_pricing_colours_admin_write" on public.print_pricing_colours for all
  using (public.is_admin()) with check (public.is_admin());

create policy "print_pricing_glazing_select" on public.print_pricing_glazing for select using (true);
create policy "print_pricing_glazing_admin_write" on public.print_pricing_glazing for all
  using (public.is_admin()) with check (public.is_admin());

-- order_items needs to remember which glazing a customer chose, same as it
-- already does for colour. Nullable-free: default to 'clear' so this reads
-- correctly for any order placed before this column existed (there should be
-- none yet — the shop only just launched — but this is the safe pattern).
alter table public.order_items
  add column if not exists glazing text not null default 'clear'
    check (glazing in ('clear', 'non_reflective', 'perspex', 'uv_clear', 'uv_non_reflective'));

comment on column public.order_items.glazing is
  'Glazing (glass) type chosen for this print. Added alongside colour once glazing became a priced, selectable option — see print_pricing_glazing.';

-- create_paid_order needs to write the new column. Recreated in full (can't
-- ALTER a function's body, only replace it) — identical to the version in
-- 20260816112601_manual_fulfilment_provider.sql (the orders insert, with
-- fulfilment_provider + Stripe receipt/invoice columns, is unchanged) except
-- order_items now also inserts glazing.
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
    stripe_invoice_url, stripe_invoice_pdf
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
    nullif(p_order->>'stripe_invoice_pdf', '')
  ) returning id into new_order_id;

  insert into public.order_items (
    order_id, photo_id, title, location, thumb_url, size, mounted,
    colour, glazing, sku, unit_price_cents, print_master_path,
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
