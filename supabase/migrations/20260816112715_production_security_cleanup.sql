-- Close advisor findings that can be fixed without changing the deliberately
-- admin-gated admin_photos view. The view remains SECURITY DEFINER because
-- authenticated users intentionally lack SELECT on private photos columns;
-- its WHERE public.is_admin() guard is the column-security boundary.

alter function public.set_updated_at()
  set search_path = pg_catalog, public;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- This event-trigger helper is not part of the public API. Some projects have
-- it installed by the automatic-RLS hardening recipe; fresh projects may not.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;

create index if not exists photos_location_id_idx on public.photos(location_id);
create index if not exists photos_created_by_idx on public.photos(created_by);
create index if not exists photo_tags_tag_id_idx on public.photo_tags(tag_id);
