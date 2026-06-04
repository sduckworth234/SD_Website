# Sam Duckworth Photography

Minimal React/Vite photography gallery backed by Supabase, live at
**https://samduckworth.com** (deployed on Vercel, auto-deploys on push to
`main`).

> **Working on this? Read [`CLAUDE.md`](./CLAUDE.md) first** — it covers the
> architecture, how we ship, the data model, and the photo import pipeline.

## Supabase

Project URL:

```txt
https://krixuiimabosiorzxzju.supabase.co
```

Required Vercel / `.env.local` environment variables:

```txt
VITE_SUPABASE_URL=https://krixuiimabosiorzxzju.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_f0wHsXRdEcLb6-7b3walPw_xt2Ii5uM
VITE_SUPABASE_PHOTO_BUCKET=photos
VITE_SITE_URL=https://samduckworth.com
# server-only (bulk import scripts) — never committed, never a VITE_ var:
SUPABASE_SERVICE_ROLE_KEY=…
```

Also set in Supabase Dashboard under **Authentication > URL Configuration**:

- Site URL: `https://samduckworth.com`
- Redirect URLs: `https://samduckworth.com/admin`

## Admin Access

The `/admin` route uses Supabase email/password auth. A signed-in user can manage
photos only when their email exists in `public.admin_users`.

Add yourself in Supabase SQL Editor:

```sql
insert into public.admin_users (email)
values ('your-email@example.com')
on conflict (email) do nothing;
```

After that, create or update the matching user in Supabase
**Authentication > Users** and set their password. Then visit `/admin` and sign in.

## Local Dev

```bash
npm install
npm run dev      # vite dev server
npm run build    # tsc -b && vite build (run before pushing)
```

## Database

Schema, RLS policies, and the storage bucket live in:

```txt
supabase/migrations/202606030001_gallery_schema.sql
supabase/migrations/202606030002_gallery_hardening.sql
```

## Photo imports

Bulk photo import/sync runs from `scripts/` (Node ESM) against the external
drive `/Volumes/SamD2`, using the service-role key. See **[`CLAUDE.md`](./CLAUDE.md)**
→ "Photo import & sync pipeline" for the full workflow (folder-based, GPS-based,
and backfill routes), gotchas, and how to add the next batch.
