create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.admin_users (
  email text primary key,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  region text not null default 'Northern Beaches',
  description text,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  description text,
  location_id uuid references public.locations(id) on delete set null,
  kind text not null default 'Drone' check (kind in ('Drone', 'Landscape', 'Travel')),
  year_taken integer,
  aspect text not null default 'landscape' check (aspect in ('portrait', 'landscape', 'square', 'wide')),
  storage_bucket text not null default 'photos',
  storage_path text,
  image_url text,
  dominant_color text,
  is_featured boolean not null default false,
  is_published boolean not null default false,
  sort_order integer not null default 0,
  captured_at date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint photos_image_source_check check (storage_path is not null or image_url is not null)
);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.photo_tags (
  photo_id uuid not null references public.photos(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (photo_id, tag_id)
);

drop trigger if exists locations_set_updated_at on public.locations;
create trigger locations_set_updated_at
before update on public.locations
for each row execute function public.set_updated_at();

drop trigger if exists photos_set_updated_at on public.photos;
create trigger photos_set_updated_at
before update on public.photos
for each row execute function public.set_updated_at();

alter table public.admin_users enable row level security;
alter table public.locations enable row level security;
alter table public.photos enable row level security;
alter table public.tags enable row level security;
alter table public.photo_tags enable row level security;

drop policy if exists "Admins can read admin users" on public.admin_users;
create policy "Admins can read admin users"
on public.admin_users for select
to authenticated
using (public.is_admin());

drop policy if exists "Public can read visible locations" on public.locations;
create policy "Public can read visible locations"
on public.locations for select
to anon, authenticated
using (is_visible = true);

drop policy if exists "Admins can manage locations" on public.locations;
create policy "Admins can manage locations"
on public.locations for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Public can read published photos" on public.photos;
create policy "Public can read published photos"
on public.photos for select
to anon, authenticated
using (is_published = true);

drop policy if exists "Admins can manage photos" on public.photos;
create policy "Admins can manage photos"
on public.photos for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Public can read tags" on public.tags;
create policy "Public can read tags"
on public.tags for select
to anon, authenticated
using (true);

drop policy if exists "Admins can manage tags" on public.tags;
create policy "Admins can manage tags"
on public.tags for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Public can read published photo tags" on public.photo_tags;
create policy "Public can read published photo tags"
on public.photo_tags for select
to anon, authenticated
using (
  exists (
    select 1
    from public.photos
    where photos.id = photo_tags.photo_id
      and photos.is_published = true
  )
);

drop policy if exists "Admins can manage photo tags" on public.photo_tags;
create policy "Admins can manage photo tags"
on public.photo_tags for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos',
  'photos',
  true,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read gallery photos" on storage.objects;
create policy "Public can read gallery photos"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'photos');

drop policy if exists "Admins can upload gallery photos" on storage.objects;
create policy "Admins can upload gallery photos"
on storage.objects for insert
to authenticated
with check (bucket_id = 'photos' and public.is_admin());

drop policy if exists "Admins can update gallery photos" on storage.objects;
create policy "Admins can update gallery photos"
on storage.objects for update
to authenticated
using (bucket_id = 'photos' and public.is_admin())
with check (bucket_id = 'photos' and public.is_admin());

drop policy if exists "Admins can delete gallery photos" on storage.objects;
create policy "Admins can delete gallery photos"
on storage.objects for delete
to authenticated
using (bucket_id = 'photos' and public.is_admin());

insert into public.locations (slug, name, region, sort_order)
values
  ('palm-beach', 'Palm Beach', 'Northern Beaches', 10),
  ('avalon', 'Avalon', 'Northern Beaches', 20),
  ('whale-beach', 'Whale Beach', 'Northern Beaches', 30),
  ('narrabeen', 'Narrabeen', 'Northern Beaches', 40),
  ('manly', 'Manly', 'Northern Beaches', 50),
  ('travels', 'Travels', 'Elsewhere', 60)
on conflict (slug) do update
set name = excluded.name,
    region = excluded.region,
    sort_order = excluded.sort_order;

with seeded_photos as (
  select *
  from (
    values
      ('tide-lines', 'Tide Lines', 'Palm Beach', 'Drone', 2026, 'wide', true, 10, 'Early water lines cutting across the sand at first light.', 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1800&q=78'),
      ('green-room', 'Green Room', 'Avalon', 'Drone', 2025, 'portrait', true, 20, 'A clean wall of green water before it folds into shore.', 'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=1200&q=78'),
      ('sand-map', 'Sand Map', 'Whale Beach', 'Drone', 2025, 'landscape', true, 30, 'Tide, reef, and sand forming a temporary coastal drawing.', 'https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=1600&q=78'),
      ('lagoon-still', 'Lagoon Still', 'Narrabeen', 'Landscape', 2024, 'square', false, 40, 'A quiet ground frame near the lagoon edge.', 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1300&q=78'),
      ('ocean-pool', 'Ocean Pool', 'Manly', 'Drone', 2025, 'portrait', false, 50, 'Saltwater geometry against the edge of the beach.', 'https://images.unsplash.com/photo-1509233725247-49e657c54213?auto=format&fit=crop&w=1300&q=78'),
      ('ridge-light', 'Ridge Light', 'Travels', 'Travel', 2023, 'landscape', false, 60, 'A travel frame from the ridge line after weather moved through.', 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1500&q=78')
  ) as photo(slug, title, location_name, kind, year_taken, aspect, is_featured, sort_order, description, image_url)
)
insert into public.photos (
  slug,
  title,
  location_id,
  kind,
  year_taken,
  aspect,
  is_featured,
  is_published,
  sort_order,
  description,
  image_url
)
select
  seeded_photos.slug,
  seeded_photos.title,
  locations.id,
  seeded_photos.kind,
  seeded_photos.year_taken,
  seeded_photos.aspect,
  seeded_photos.is_featured,
  true,
  seeded_photos.sort_order,
  seeded_photos.description,
  seeded_photos.image_url
from seeded_photos
join public.locations on locations.name = seeded_photos.location_name
on conflict (slug) do update
set title = excluded.title,
    location_id = excluded.location_id,
    kind = excluded.kind,
    year_taken = excluded.year_taken,
    aspect = excluded.aspect,
    is_featured = excluded.is_featured,
    is_published = excluded.is_published,
    sort_order = excluded.sort_order,
    description = excluded.description,
    image_url = excluded.image_url;
