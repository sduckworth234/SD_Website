-- Paid shop orders and their immutable line-item snapshots. Browser clients
-- never read or write these tables directly: public endpoints use the service
-- role after Stripe/Prodigi verification, and /admin goes through an
-- authenticated server endpoint.

create table if not exists public.orders (
  id                         uuid primary key default gen_random_uuid(),
  stripe_checkout_session_id text unique not null,
  stripe_payment_intent_id   text unique,
  status                     text not null default 'paid'
    check (status in (
      'paid', 'awaiting_master', 'queued', 'submitting', 'submitted',
      'in_production', 'shipped', 'cancelled', 'refunded', 'failed'
    )),
  customer_email             text not null,
  customer_name              text not null,
  shipping_address           jsonb not null,
  currency                   text not null default 'AUD' check (currency = 'AUD'),
  subtotal_cents             integer not null check (subtotal_cents >= 0),
  shipping_cents             integer not null check (shipping_cents >= 0),
  discount_cents             integer not null default 0 check (discount_cents >= 0),
  discount_code              text,
  total_cents                integer not null check (total_cents >= 0),
  prodigi_order_id           text unique,
  prodigi_stage              text,
  prodigi_status             jsonb,
  tracking_number            text,
  tracking_url               text,
  submit_after               timestamptz not null default (now() + interval '45 minutes'),
  submitted_at               timestamptz,
  shipped_at                 timestamptz,
  last_fulfilment_error      text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  check (discount_cents <= subtotal_cents),
  check (total_cents = subtotal_cents + shipping_cents - discount_cents)
);

comment on table public.orders is
  'Server-only paid shop orders. Stripe Checkout session id is the webhook idempotency key; submit_after provides the customer change/cancel window.';

create table if not exists public.order_items (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.orders(id) on delete cascade,
  photo_id              uuid references public.photos(id) on delete set null,
  title                 text not null,
  location              text not null,
  thumb_url             text not null,
  size                  text not null check (size in ('A5', 'A4', 'A3', 'A2', 'A1')),
  mounted               boolean not null,
  colour                text not null check (colour in ('natural', 'black', 'white')),
  sku                   text not null,
  unit_price_cents      integer not null check (unit_price_cents > 0),
  print_master_path     text,
  print_master_width    integer check (print_master_width is null or print_master_width > 0),
  print_master_height   integer check (print_master_height is null or print_master_height > 0),
  created_at            timestamptz not null default now()
);

comment on table public.order_items is
  'Immutable print snapshots for each order. print_master_path points into the private print-masters bucket and can be reused for later orders of the same photo.';

create index if not exists orders_fulfilment_queue_idx
  on public.orders (submit_after, created_at)
  where status in ('paid', 'awaiting_master', 'queued', 'failed');
create index if not exists orders_customer_email_idx on public.orders (lower(customer_email));
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_photo_master_idx
  on public.order_items (photo_id, created_at desc)
  where print_master_path is not null;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Defense in depth for projects where public tables are Data API-exposed.
-- The service role keeps full access; anon/authenticated get no table grants
-- and there are intentionally no permissive RLS policies.
revoke all on public.orders from anon, authenticated;
revoke all on public.order_items from anon, authenticated;
grant all on public.orders to service_role;
grant all on public.order_items to service_role;

-- Stripe webhooks must commit the order header and every item atomically. This
-- is SECURITY INVOKER (the service role already has table access), and execute
-- is explicitly withheld from browser roles.
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
    subtotal_cents, shipping_cents, discount_cents, discount_code, total_cents
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
    (p_order->>'total_cents')::integer
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

-- Full-resolution JPEGs are private. Admins may upload/remove masters from the
-- browser using their authenticated session; only server code creates signed
-- download URLs for Prodigi. A 100 MB cap leaves room for high-quality A1
-- masters without accepting arbitrary file types.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('print-masters', 'print-masters', false, 104857600, array['image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admins can read print masters" on storage.objects;
create policy "Admins can read print masters"
on storage.objects for select to authenticated
using (bucket_id = 'print-masters' and public.is_admin());

drop policy if exists "Admins can upload print masters" on storage.objects;
create policy "Admins can upload print masters"
on storage.objects for insert to authenticated
with check (bucket_id = 'print-masters' and public.is_admin());

drop policy if exists "Admins can replace print masters" on storage.objects;
create policy "Admins can replace print masters"
on storage.objects for update to authenticated
using (bucket_id = 'print-masters' and public.is_admin())
with check (bucket_id = 'print-masters' and public.is_admin());

drop policy if exists "Admins can remove print masters" on storage.objects;
create policy "Admins can remove print masters"
on storage.objects for delete to authenticated
using (bucket_id = 'print-masters' and public.is_admin());

-- Run fulfilment independently of Vercel plan limits. The job intentionally
-- no-ops until the two Vault secrets are created after deployment:
--   shop_fulfilment_url    = https://www.samduckworth.com/api/submit-orders
--   shop_cron_secret       = the same random value as Vercel CRON_SECRET
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'shop-fulfilment-every-10-minutes',
  '*/10 * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'shop_fulfilment_url' limit 1),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'shop_cron_secret' limit 1)
      ),
      body := jsonb_build_object('triggered_at', now()),
      timeout_milliseconds := 55000
    )
    where exists (select 1 from vault.decrypted_secrets where name = 'shop_fulfilment_url')
      and exists (select 1 from vault.decrypted_secrets where name = 'shop_cron_secret');
  $job$
);
