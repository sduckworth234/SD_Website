# Onboarding — Sam Duckworth Photography

This is the photography gallery and framed-print shop at
**https://samduckworth.com**. It is a React/Vite app backed by Supabase and
deployed on Vercel. Read [`CLAUDE.md`](./CLAUDE.md) for the deep reference.

## 1. Run it locally

```bash
npm install
npm run dev        # frontend only, http://localhost:5173
npm run build      # tsc -b && vite build — required before pushing
vercel dev         # frontend + serverless API; required for checkout testing
```

Copy the variable names from [`.env.example`](./.env.example) into a gitignored
`.env.local`. Without Supabase variables, public gallery data falls back to
`src/data/photos.ts`. Never add secrets to a `VITE_` variable.

## 2. How we ship

- Push straight to `main`; Vercel auto-deploys it.
- Run `npm run build` and `npm audit` before pushing code changes.
- Keep `VITE_SHOP_ENABLED`, `SHOP_CHECKOUT_ENABLED`, and
  `SHOP_FULFILMENT_ENABLED` false in Production until launch is deliberately
  approved. Missing flags are false.
- Supabase runtime settings `shop_public` and `print_configurator` are an
  additional public visibility gate controlled in Admin.
- Supabase row changes are live immediately; code and `VITE_` changes require a
  deployment.

## 3. Project shape

- `src/App.tsx` — hand-rolled routing, public pages and the admin workspace.
- `src/components/CheckoutPage.tsx` — custom embedded Stripe checkout.
- `src/components/AdminOrders.tsx` — order review, master upload, submit/refund.
- `src/lib/supabase.ts` — browser-side Supabase access.
- `src/lib/features.ts` — public build-time shop gate.
- `api/` — Vercel endpoints for checkout, Stripe, Prodigi, order admin and Cron.
- `server/shop/` — shared server-only pricing, Supabase, Prodigi and email logic.
- `src/styles.css` — all styling (plain CSS).
- `supabase/migrations/` — schema, RLS, Storage and Cron.
- `scripts/` — Node import, geo and maintenance pipeline.
- `Shop Setup/` — current activation handoff and historical integration research.

Core photo fields include `is_published`, `is_featured`, `sort_order`,
`source_path`, `in_shop`, `shop_order` and collection membership. `is_published`
controls gallery visibility; `in_shop` independently controls whether the photo
can enter the sales flow. A photo must satisfy both to be purchasable.

## 4. Admin

`/admin` uses Supabase email/password auth; the user must also be in
`public.admin_users`. The workspace has six tabs:

- **Photos** — upload, search, edit, publish, feature and bulk actions.
- **Collections** — create, order and curate gallery collections.
- **Homepage** — curate homepage imagery.
- **Locations** — create and arrange places.
- **Shop** — toggle photos for sale, bulk-manage sale status, inspect feature
  gates, upload JPEG masters, submit orders and refund held orders.
- **Site settings** — visibility, banners and runtime feature switches.

Removing **For sale** immediately removes the product from the shop flow, direct
product routes and checkout validation. Existing paid orders retain their
immutable item snapshot.

## 5. Purchase flow

1. The browser sends photo and product choices to the server.
2. The server verifies published/for-sale status, SKU and price, obtains live
   Prodigi shipping, and validates any Stripe Promotion Code.
3. Stripe's embedded Payment Element collects payment details directly.
4. Only a verified Stripe webhook creates the order and items atomically.
5. The order waits 45 minutes and waits for every private full-resolution JPEG.
6. Supabase Cron submits eligible orders to Prodigi every ten minutes when the
   fulfilment flag is enabled.
7. Prodigi callbacks are re-verified against the API; Resend sends confirmation
   and tracking email.

Use [`Shop Setup/Shop Checkout — Setup Handoff.md`](./Shop%20Setup/Shop%20Checkout%20%E2%80%94%20Setup%20Handoff.md)
for environment setup, webhook testing and the launch proof checklist.

## 6. Adding photos

Source photos live on `/Volumes/SamD2`. The import scripts require
`SUPABASE_SERVICE_ROLE_KEY` and are run with `node --env-file=.env.local`.

- **Trip dump:** `geo-bucket.mjs` → review/rename → `geo-recountry.mjs` →
  `import-folders.mjs`.
- **Curated exports:** `scan-import-candidates.mjs` → `refine-approved.mjs` →
  `import-batch.mjs`.
- **Metadata backfills:** use the matching analyse/apply scripts in `scripts/`.

Compression strips EXIF, so scripts read metadata from original JPEGs before or
alongside conversion. Full detail and safeguards are in [`CLAUDE.md`](./CLAUDE.md).
