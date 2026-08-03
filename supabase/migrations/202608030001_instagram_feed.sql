-- Live Instagram feed for the bottom of the home page.
--
-- Two tables, deliberately different in who can read them:
--
--   1) public.instagram_posts   — the cached feed. Anon reads it exactly like
--      photos and locations, so the browser never talks to Instagram and the
--      site's Content-Security-Policy needs no loosening.
--   2) public.integration_secrets — the long-lived Instagram token. This one is
--      NOT readable by anon under any circumstances. It cannot live in
--      site_settings, which anon can read in full.
--
-- Why a cached table rather than calling Instagram from the page:
--   * Instagram's media_url values are SIGNED CDN links that expire. The sync
--     job mirrors each image into the photos bucket, so the feed can't rot.
--   * Tokens must be refreshed inside 60 days. The job re-writes the refreshed
--     token into integration_secrets, so nothing depends on remembering.
--   * If Instagram (or the token) is down, the last good feed still renders.

-- 1: the cached posts -------------------------------------------------------
create table if not exists public.instagram_posts (
  id           text primary key,
  caption      text,
  permalink    text not null,
  media_type   text,
  posted_at    timestamptz,
  storage_path text,
  like_count   int,
  comments_count int,
  sort_order   int not null default 0,
  synced_at    timestamptz not null default now()
);

comment on table public.instagram_posts is
  'Cached copy of the latest Instagram posts. Images are mirrored into the photos bucket because Instagram CDN links expire. Refreshed by api/instagram-sync.';
comment on column public.instagram_posts.id is 'Instagram media id — the upsert key, so re-syncing is idempotent.';
comment on column public.instagram_posts.storage_path is 'Path in the photos bucket of the mirrored image. NULL if the mirror failed.';
comment on column public.instagram_posts.sort_order is 'Newest first, 0-based, assigned at sync time.';

create index if not exists instagram_posts_order_idx on public.instagram_posts (sort_order);

alter table public.instagram_posts enable row level security;

drop policy if exists "Anon can read instagram posts" on public.instagram_posts;
create policy "Anon can read instagram posts"
on public.instagram_posts for select to anon using (true);

drop policy if exists "Authenticated can read instagram posts" on public.instagram_posts;
create policy "Authenticated can read instagram posts"
on public.instagram_posts for select to authenticated using (true);

-- Writes come from the sync job using the service-role key, which bypasses RLS.
-- Admins may also clear the cache by hand from /admin.
drop policy if exists "Admins can write instagram posts" on public.instagram_posts;
create policy "Admins can write instagram posts"
on public.instagram_posts for all to authenticated
using (public.is_admin()) with check (public.is_admin());

grant select on public.instagram_posts to anon;
grant select, insert, update, delete on public.instagram_posts to authenticated;

-- 2: the token store --------------------------------------------------------
-- No anon grant, no anon policy: the access token must never be reachable from
-- the browser. Only the service-role key (server-side, in the sync job) reads it.
create table if not exists public.integration_secrets (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

comment on table public.integration_secrets is
  'Server-only credentials (e.g. the rotating Instagram long-lived token). Deliberately unreadable by anon — do NOT move these into site_settings, which anon can read.';

drop trigger if exists integration_secrets_set_updated_at on public.integration_secrets;
create trigger integration_secrets_set_updated_at
  before update on public.integration_secrets
  for each row execute function public.set_updated_at();

alter table public.integration_secrets enable row level security;
-- Intentionally no policies for anon or authenticated: with RLS on and no
-- permissive policy, every non-service-role read returns nothing.

revoke all on public.integration_secrets from anon;
revoke all on public.integration_secrets from authenticated;

-- 3: the visibility flag ----------------------------------------------------
insert into public.site_settings (key, enabled, label) values
  ('instagram_feed', true, 'Home — Instagram feed')
on conflict (key) do nothing;
