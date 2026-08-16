-- Replace the SECURITY DEFINER view with an explicit, authenticated RPC. The
-- function returns no rows unless the verified caller is present in
-- admin_users; anon/public cannot execute it. This keeps private source paths
-- available to the admin without granting those columns on public.photos.

create or replace function public.get_admin_photos()
returns setof public.photos
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select photos.*
  from public.photos
  where public.is_admin()
  order by photos.created_at desc;
$$;

revoke all on function public.get_admin_photos() from public, anon;
grant execute on function public.get_admin_photos() to authenticated;

drop view if exists public.admin_photos;
