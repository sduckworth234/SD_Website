-- Production hardening (run by hand in the Supabase SQL editor, like the others).
--
-- 1) source_path was readable by ANY authenticated user: the `authenticated`
--    role kept blanket all-column SELECT, and the row policy admits every
--    published row. That was only safe while "Allow new users to sign up" is
--    OFF in the dashboard — a setting, not schema. This locks the column list
--    for `authenticated` down to the same public allow-list anon gets, and
--    moves the admin's full read (incl. source_path) behind an is_admin()-gated
--    view, so the schema no longer depends on the dashboard toggle.
--    >>> Still verify: Dashboard -> Authentication -> Sign In / Up ->
--    >>> "Allow new users to sign up" should be OFF (no OAuth providers).
--
-- 2) is_admin() trusted the JWT email claim. It now resolves the caller's
--    auth.uid() to their server-side auth.users record and matches THAT email
--    against admin_users — a forged/unverified email claim no longer matters.
--    Adding an admin stays the same: insert the email + create the Auth user.
--
-- 3) photos.created_by now defaults to auth.uid() server-side instead of
--    trusting the inserting client to supply it.

-- ---------------------------------------------------------------------------
-- (1) Column-level lock for the authenticated role.
-- Same fail-closed pattern as the anon lock in 202606060001: revoke the
-- blanket SELECT, re-grant an explicit allow-list that omits source_path
-- (and created_by). INSERT/UPDATE/DELETE privileges are untouched — writes
-- stay governed by the is_admin() RLS policies. Keep this list in sync with
-- the anon list whenever a new public column is added.
revoke select on public.photos from authenticated;
grant select (
  id, title, slug, description, location_id, kind, year_taken, captured_at,
  aspect, storage_bucket, storage_path, image_url, dominant_color,
  relative_altitude_m, latitude, longitude, is_map_feature, is_featured,
  is_published, sort_order, collection_order, in_shop, shop_order,
  created_at, updated_at
) on public.photos to authenticated;

-- Admin full read (every column, every row — drafts included) via a gated
-- view. Views run with definer (owner) rights, so this bypasses the column
-- grant above; the WHERE means non-admins get zero rows. The app reads it in
-- getAdminPhotos() and joins location names client-side.
create or replace view public.admin_photos as
  select * from public.photos where public.is_admin();

revoke all on public.admin_photos from anon;
grant select on public.admin_photos to authenticated;

-- ---------------------------------------------------------------------------
-- (2) Key the admin check on the caller's uid, not the JWT email claim.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users au
    join auth.users u on lower(u.email) = lower(au.email)
    where u.id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- (3) created_by is stamped server-side.
alter table public.photos
  alter column created_by set default auth.uid();
