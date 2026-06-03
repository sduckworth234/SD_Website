create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "Public can read gallery photos" on storage.objects;

create index if not exists photos_location_id_idx on public.photos(location_id);
create index if not exists photos_created_by_idx on public.photos(created_by);
create index if not exists photo_tags_tag_id_idx on public.photo_tags(tag_id);
create index if not exists photos_public_gallery_idx
  on public.photos(is_published, sort_order, created_at desc);

drop policy if exists "Public can read visible locations" on public.locations;
drop policy if exists "Admins can manage locations" on public.locations;
create policy "Anon can read visible locations"
on public.locations for select
to anon
using (is_visible = true);
create policy "Authenticated can read visible or admin locations"
on public.locations for select
to authenticated
using (is_visible = true or public.is_admin());
create policy "Admins can insert locations"
on public.locations for insert
to authenticated
with check (public.is_admin());
create policy "Admins can update locations"
on public.locations for update
to authenticated
using (public.is_admin())
with check (public.is_admin());
create policy "Admins can delete locations"
on public.locations for delete
to authenticated
using (public.is_admin());

drop policy if exists "Public can read published photos" on public.photos;
drop policy if exists "Admins can manage photos" on public.photos;
create policy "Anon can read published photos"
on public.photos for select
to anon
using (is_published = true);
create policy "Authenticated can read published or admin photos"
on public.photos for select
to authenticated
using (is_published = true or public.is_admin());
create policy "Admins can insert photos"
on public.photos for insert
to authenticated
with check (public.is_admin());
create policy "Admins can update photos"
on public.photos for update
to authenticated
using (public.is_admin())
with check (public.is_admin());
create policy "Admins can delete photos"
on public.photos for delete
to authenticated
using (public.is_admin());

drop policy if exists "Public can read tags" on public.tags;
drop policy if exists "Admins can manage tags" on public.tags;
create policy "Anon can read tags"
on public.tags for select
to anon
using (true);
create policy "Authenticated can read tags"
on public.tags for select
to authenticated
using (true);
create policy "Admins can insert tags"
on public.tags for insert
to authenticated
with check (public.is_admin());
create policy "Admins can update tags"
on public.tags for update
to authenticated
using (public.is_admin())
with check (public.is_admin());
create policy "Admins can delete tags"
on public.tags for delete
to authenticated
using (public.is_admin());

drop policy if exists "Public can read published photo tags" on public.photo_tags;
drop policy if exists "Admins can manage photo tags" on public.photo_tags;
create policy "Anon can read published photo tags"
on public.photo_tags for select
to anon
using (
  exists (
    select 1
    from public.photos
    where photos.id = photo_tags.photo_id
      and photos.is_published = true
  )
);
create policy "Authenticated can read published or admin photo tags"
on public.photo_tags for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.photos
    where photos.id = photo_tags.photo_id
      and photos.is_published = true
  )
);
create policy "Admins can insert photo tags"
on public.photo_tags for insert
to authenticated
with check (public.is_admin());
create policy "Admins can delete photo tags"
on public.photo_tags for delete
to authenticated
using (public.is_admin());
