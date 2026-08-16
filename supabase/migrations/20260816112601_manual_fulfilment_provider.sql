-- Lock every paid order to the fulfilment route selected when the payment is
-- recorded. Changing the deployment from manual to Prodigi therefore affects
-- new orders only and cannot unexpectedly submit an older manual order.

alter table public.orders
  add column if not exists fulfilment_provider text not null default 'manual',
  add column if not exists tracking_carrier text,
  add column if not exists stripe_receipt_url text,
  add column if not exists stripe_invoice_id text,
  add column if not exists stripe_invoice_url text,
  add column if not exists stripe_invoice_pdf text;

alter table public.orders
  drop constraint if exists orders_fulfilment_provider_format,
  add constraint orders_fulfilment_provider_format
    check (fulfilment_provider ~ '^[a-z][a-z0-9_-]{0,39}$'),
  drop constraint if exists orders_tracking_carrier_length,
  add constraint orders_tracking_carrier_length
    check (tracking_carrier is null or char_length(tracking_carrier) <= 80);

comment on column public.orders.fulfilment_provider is
  'Provider snapshot chosen at payment time. manual is the safe fallback; automated jobs only claim explicit prodigi rows.';

create index if not exists orders_provider_fulfilment_queue_idx
  on public.orders (fulfilment_provider, submit_after, created_at)
  where status in ('paid', 'awaiting_master', 'queued', 'failed');

-- Keep paid order + line item creation atomic while adding the provider and
-- Stripe proof-of-payment links. This remains SECURITY INVOKER and executable
-- only by service_role, matching the original migration.
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
    colour, sku, unit_price_cents, print_master_path,
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
