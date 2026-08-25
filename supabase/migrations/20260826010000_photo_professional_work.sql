-- Professional client work gallery (real estate, events, brand shoots) shown
-- on the new /work page and linked from the home page + About. Independent of
-- the personal-gallery flags (in_shop, collection_order, is_featured) — a
-- photo can be a professional-work example without being for sale or in a
-- home collection card, and vice versa.
alter table public.photos
  add column if not exists is_professional_work boolean not null default false,
  add column if not exists professional_order int;

comment on column public.photos.is_professional_work is
  'Marks this photo as an example of paid professional client work shown on /work. Independent of in_shop/collection_order.';
comment on column public.photos.professional_order is
  'Manual ordering of is_professional_work photos on /work (asc; item 1 is also the page hero). NULL sorts last.';

-- The photos column grants are fail-closed allow-lists (see the source_path
-- and authenticated-hardening migrations) — a new public column must be
-- granted explicitly or the /work page cannot read it. Additive: this does
-- not touch the existing granted columns.
grant select (is_professional_work, professional_order) on public.photos to anon, authenticated;
