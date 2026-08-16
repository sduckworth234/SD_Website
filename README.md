# Sam Duckworth Photography

Photography gallery and framed-print shop at **https://samduckworth.com**. It is
a React/Vite application deployed by Vercel from `main`, with Supabase for data,
auth and storage, Stripe for payment, manual or optional Prodigi print fulfilment,
and Resend for transactional email.

> **Working on this? Read [`CLAUDE.md`](./CLAUDE.md) first.** For shop activation,
> use [`Shop Setup/Shop Checkout — Setup Handoff.md`](./Shop%20Setup/Shop%20Checkout%20%E2%80%94%20Setup%20Handoff.md).

## Main routes

- `/` — homepage
- `/galleries` — gallery archive and collections
- `/map` — location map
- `/shop` and `/shop/<slug>` — shop and product configurator
- `/checkout` — embedded Stripe Payment Element checkout
- `/admin` — authenticated site, catalogue and order management

## Local development

```bash
npm install
npm run dev      # frontend only, http://localhost:5173
npm run build    # tsc -b && vite build; required before pushing
set -a; source .env.local; set +a
npx vercel dev -A vercel.dev.json  # frontend + /api; checkout testing
```

Create a gitignored `.env.local` from [`.env.example`](./.env.example). Never
commit real secret keys. Browser-safe variables use the `VITE_` prefix; Stripe,
Prodigi, Supabase service-role, Cron and Resend secrets are server-only.

The shop has two public deployment gates and a safe fulfilment selector:

```dotenv
VITE_SHOP_ENABLED=false
SHOP_CHECKOUT_ENABLED=false
SHOP_FULFILMENT_PROVIDER=manual
```

Keep both gates false and the provider manual until the activation checklist and
test-mode cycle are complete. Supabase settings `shop_public` and `print_configurator` provide a
second, admin-managed public visibility gate. A verified signed-in admin can
still open the shop, products and Stripe test flow while the two public gates are
false. Manual mode keeps checkout/order admin live, makes no Prodigi API calls,
and locks each paid order to manual even if later orders switch to Prodigi.

## Supabase

Project URL:

```txt
https://krixuiimabosiorzxzju.supabase.co
```

Minimum gallery variables:

```dotenv
VITE_SUPABASE_URL=https://krixuiimabosiorzxzju.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_f0wHsXRdEcLb6-7b3walPw_xt2Ii5uM
VITE_SUPABASE_PHOTO_BUCKET=photos
VITE_SITE_URL=https://samduckworth.com
```

The complete variable list, with safe placeholders, is in [`.env.example`](./.env.example).

Also set in Supabase Dashboard under **Authentication → URL Configuration**:

- Site URL: `https://samduckworth.com`
- Redirect URLs: `https://samduckworth.com/admin`

Schema, RLS, Storage and Cron definitions live in [`supabase/migrations/`](./supabase/migrations/).
The shop migrations include
[`20260816000132_shop_checkout_fulfilment.sql`](./supabase/migrations/20260816000132_shop_checkout_fulfilment.sql)
and [`20260816112601_manual_fulfilment_provider.sql`](./supabase/migrations/20260816112601_manual_fulfilment_provider.sql).

## Admin access and shop catalogue

The `/admin` route uses Supabase email/password auth. A signed-in user can manage
the site only when their email exists in `public.admin_users`:

```sql
insert into public.admin_users (email)
values ('your-email@example.com')
on conflict (email) do nothing;
```

Create or update the matching user under **Supabase → Authentication → Users**,
then sign in at `/admin`.

Admin is organised into **Photos, Collections, Homepage, Locations, Shop, and
Site settings**. The Shop tab controls each photo's **For sale** state and contains
Orders. A photo is purchasable only when it is both published and marked for sale;
removing it from sale also makes stale carts fail server validation. The Shop tab
also links to the admin-only live shop preview when public access is disabled.

## Checkout and fulfilment

The browser never supplies trusted prices and never handles raw card details.
The server validates the catalogue, reprices the basket, asks Prodigi for live
shipping, validates Stripe Promotion Codes, and creates an embedded Stripe
Checkout Session. A signed Stripe webhook is the only path that atomically creates
an order. Orders pause for 45 minutes, then Supabase Cron submits eligible orders
to Prodigi using private JPEG masters and short-lived signed URLs.

See [`Shop Setup/README.md`](./Shop%20Setup/README.md) for the shop documentation
index and the account activation handoff.

## Photo imports

Bulk photo import/sync runs from `scripts/` (Node ESM) against the external drive
`/Volumes/SamD2`, using the service-role key. See [`CLAUDE.md`](./CLAUDE.md) →
“Photo import & sync pipeline” for folder-based, GPS-based and backfill workflows.
