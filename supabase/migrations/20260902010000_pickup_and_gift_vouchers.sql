-- Local pickup + gift vouchers.
--
-- 1. orders.delivery_method records which Stripe shipping option the customer
--    actually paid for ('delivery' = tracked courier, 'pickup' = collected on
--    the Northern Beaches). Existing rows are delivery by definition.
-- 2. public.gift_vouchers records each voucher sold. Like orders it is
--    service-role only: no browser role gets a grant or a policy. The Stripe
--    promotion code is the redeemable secret, so it must never be readable by
--    anon.

alter table public.orders
  add column if not exists delivery_method text not null default 'delivery';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_delivery_method_check'
  ) then
    alter table public.orders
      add constraint orders_delivery_method_check
      check (delivery_method in ('delivery', 'pickup'));
  end if;
end
$$;

comment on column public.orders.delivery_method is
  'Which Stripe shipping option was paid for. pickup orders are collected in person; the pickup address is emailed, never published.';

-- create_paid_order is replaced rather than altered so the webhook can persist
-- the method atomically with the order. Every other column is unchanged.
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

create table if not exists public.gift_vouchers (
  id                         uuid primary key default gen_random_uuid(),
  stripe_checkout_session_id text unique not null,
  stripe_payment_intent_id   text,
  stripe_coupon_id           text,
  stripe_promotion_code_id   text,
  code                       text unique not null,
  amount_cents               integer not null check (amount_cents > 0),
  currency                   text not null default 'AUD' check (currency = 'AUD'),
  buyer_email                text not null,
  buyer_name                 text,
  recipient_name             text,
  message                    text,
  emailed_at                 timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

comment on table public.gift_vouchers is
  'Server-only gift vouchers. Each row mirrors one Stripe coupon + single-use promotion code; the code is redeemed through the normal checkout promotion field.';

create index if not exists gift_vouchers_buyer_email_idx on public.gift_vouchers (lower(buyer_email));

drop trigger if exists gift_vouchers_set_updated_at on public.gift_vouchers;
create trigger gift_vouchers_set_updated_at
  before update on public.gift_vouchers
  for each row execute function public.set_updated_at();

alter table public.gift_vouchers enable row level security;
revoke all on public.gift_vouchers from anon, authenticated;
grant all on public.gift_vouchers to service_role;
