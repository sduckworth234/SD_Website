# SD Website

Minimal React/Vite photography gallery backed by Supabase.

## Supabase

Project URL:

```txt
https://krixuiimabosiorzxzju.supabase.co
```

Required Vercel environment variables:

```txt
VITE_SUPABASE_URL=https://krixuiimabosiorzxzju.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_f0wHsXRdEcLb6-7b3walPw_xt2Ii5uM
VITE_SUPABASE_PHOTO_BUCKET=photos
VITE_SITE_URL=https://sdwebsite-rho.vercel.app
```

Also add the same Vercel URL in Supabase Dashboard under
**Authentication > URL Configuration**:

- Site URL: `https://sdwebsite-rho.vercel.app`
- Redirect URLs: `https://sdwebsite-rho.vercel.app/admin`

If you use a custom domain later, add that domain there too.

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
npm run dev
```

## Database

The gallery schema is in:

```txt
supabase/migrations/202606030001_gallery_schema.sql
```
