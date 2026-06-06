-- Two-way link between a gallery photo and the original full-res file it was
-- made from. `source_path` holds the absolute path at import time (drive folder
-- + filename, e.g. /Volumes/SamD2/2024/Drone/Europe/.../DroneDumpTBD-127.jpg) so
-- that, when someone wants to buy a print, the original is findable from the row.
-- Backfilled from the import manifests by scripts/source-path-backfill.mjs; new
-- imports (import-shoot.mjs) write it directly.
--
-- PRIVACY: source_path is a private drive path and must NEVER reach the public
-- (anon) API — the publishable key ships in the browser bundle, and the
-- "Public can read published photos" RLS policy lets anon select every column of
-- a published row. So we lock it down at the COLUMN level below.
alter table public.photos
  add column if not exists source_path text;

comment on column public.photos.source_path is
  'Absolute path to the original full-res source file at import time (drive folder + filename). Private — admin-only, never exposed to anon.';

-- Column-level lockdown. A table-level GRANT SELECT covers ALL columns including
-- any added later, so revoking a single column does nothing while the blanket
-- grant stands. To actually hide source_path from anon we revoke the blanket
-- SELECT and re-grant an explicit allow-list that omits it. Fail-closed: a NEW
-- column added in future is invisible to anon until added to this list — keep it
-- in sync whenever the PUBLIC gallery query needs a new field.
revoke select on public.photos from anon;
grant select (
  id, title, slug, description, location_id, kind, year_taken, captured_at,
  aspect, storage_bucket, storage_path, image_url, dominant_color,
  relative_altitude_m, latitude, longitude, is_map_feature, is_featured,
  is_published, sort_order, created_at, updated_at
) on public.photos to anon;

-- Admins authenticate, so the `authenticated` role keeps full-table SELECT
-- (including source_path). RLS still limits which rows each role can see; the
-- only authenticated users are admins (sign-up is closed).
grant select on public.photos to authenticated;
