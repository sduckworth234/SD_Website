-- "Collections" — the galleries page's second filter axis (trips/bodies of work),
-- sitting above the existing location tabs. Choosing one narrows the places rail
-- to just the places inside it, which is what makes "Italy" legible now that it
-- spans 2022, 2024 and 2026.
--
-- NAMING — read this before writing any SQL against it:
--   The tables are `series` / `photo_series`, but the UI (and the TypeScript
--   type) calls them **Collections**. The mismatch is deliberate: this codebase
--   ALREADY uses "collection" for something else entirely —
--   `photos.collection_order` and the `collection_cards` visibility flag drive
--   the HOME PAGE's per-location cards. Reusing the word in the schema would
--   make `collection_order` permanently ambiguous. So: DB says series, humans
--   say Collections.
--
--   1) public.series        — one row per collection ("2024 Europe").
--   2) public.photo_series  — many-to-many membership, so a photo can sit in
--      both "2024 Europe" and a later cross-cutting set ("Favourites") without
--      a migration to undo a single-FK decision.

-- 1: the collections themselves ---------------------------------------------
create table if not exists public.series (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,
  name       text not null,
  period     text,
  subtitle   text,
  sort_order int not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.series is
  'A gallery "Collection" (trip or body of work). Named series to avoid colliding with photos.collection_order, which means the home page location cards.';
comment on column public.series.name is
  'The collection name, shown as the small line in the rail. E.g. "Europe".';
comment on column public.series.period is
  'Free-text big line in the rail — "2026", "Ongoing", "Road trips". Combined with name for the page title ("2026 Europe"). NULL shows the name alone.';
comment on column public.series.subtitle is
  'Optional longer blurb for the collection.';
comment on column public.series.sort_order is
  'Rail order, ascending. Newest trip first is sort_order 0.';

drop trigger if exists series_set_updated_at on public.series;
create trigger series_set_updated_at
  before update on public.series
  for each row execute function public.set_updated_at();

-- 2: membership -------------------------------------------------------------
create table if not exists public.photo_series (
  photo_id   uuid not null references public.photos(id) on delete cascade,
  series_id  uuid not null references public.series(id) on delete cascade,
  sort_order int not null default 0,
  primary key (photo_id, series_id)
);

comment on table public.photo_series is
  'Which photos belong to which Collection. Many-to-many on purpose.';

create index if not exists photo_series_series_idx on public.photo_series (series_id);
create index if not exists photo_series_photo_idx  on public.photo_series (photo_id);

-- RLS -----------------------------------------------------------------------
-- Anon reads visible collections + all membership rows. Membership is not
-- sensitive on its own: an unpublished photo's id leaking through a join is
-- harmless because the photos table's own RLS still refuses to return the row.
alter table public.series        enable row level security;
alter table public.photo_series  enable row level security;

drop policy if exists "Anon can read visible series" on public.series;
create policy "Anon can read visible series"
on public.series for select
to anon
using (is_visible = true);

drop policy if exists "Authenticated can read all series" on public.series;
create policy "Authenticated can read all series"
on public.series for select
to authenticated
using (true);

drop policy if exists "Admins can insert series" on public.series;
create policy "Admins can insert series"
on public.series for insert
to authenticated
with check (public.is_admin());

drop policy if exists "Admins can update series" on public.series;
create policy "Admins can update series"
on public.series for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can delete series" on public.series;
create policy "Admins can delete series"
on public.series for delete
to authenticated
using (public.is_admin());

drop policy if exists "Anon can read photo series" on public.photo_series;
create policy "Anon can read photo series"
on public.photo_series for select
to anon
using (true);

drop policy if exists "Authenticated can read photo series" on public.photo_series;
create policy "Authenticated can read photo series"
on public.photo_series for select
to authenticated
using (true);

drop policy if exists "Admins can insert photo series" on public.photo_series;
create policy "Admins can insert photo series"
on public.photo_series for insert
to authenticated
with check (public.is_admin());

drop policy if exists "Admins can update photo series" on public.photo_series;
create policy "Admins can update photo series"
on public.photo_series for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can delete photo series" on public.photo_series;
create policy "Admins can delete photo series"
on public.photo_series for delete
to authenticated
using (public.is_admin());

-- Grants. NOTE: unlike public.photos (whose anon SELECT is a fail-closed column
-- allow-list — see 202606060001_photo_source_path), these tables hold nothing
-- private, so a table-level grant is correct here.
grant select on public.series       to anon;
grant select on public.photo_series to anon;
grant select, insert, update, delete on public.series       to authenticated;
grant select, insert, update, delete on public.photo_series to authenticated;

-- Backfill ------------------------------------------------------------------
-- The two past Europe trips fall straight out of region + year, so they need no
-- tagging session. Idempotent: re-running adds nothing new.
insert into public.series (slug, name, period, sort_order) values
  ('europe-2026',      'Europe',           '2026',       0),
  ('europe-2024',      'Europe',           '2024',       1),
  ('europe-2022',      'Europe',           '2022',       2),
  ('northern-beaches', 'Northern Beaches', 'Ongoing',    3),
  ('australia',        'Australia',        'Road trips', 4)
on conflict (slug) do nothing;

insert into public.photo_series (photo_id, series_id)
select p.id, s.id
from public.photos p
join public.locations l on l.id = p.location_id
join public.series s on s.slug = case
  when l.region = 'Europe'           and p.year_taken = '2024' then 'europe-2024'
  when l.region = 'Europe'           and p.year_taken = '2022' then 'europe-2022'
  when l.region = 'Northern Beaches'                           then 'northern-beaches'
  when l.region = 'Australia'                                  then 'australia'
  else null
end
on conflict (photo_id, series_id) do nothing;
