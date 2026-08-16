# Shop checkout — account handoff

The code, schema, custom checkout, webhook, held fulfilment queue, Prodigi callback,
emails, order admin and reactive print-master upload are implemented. This file is
the short account-side checklist needed to activate them.

**Code status (2026-08-16):** production build and dependency audit pass; the
desktop/mobile checkout and default-off states have been checked without console
errors. Deployment is safe with the environment gates below left false. Account
activation and a complete Stripe test-mode/webhook/Prodigi sandbox cycle are still
required before public launch.

## Purchase and fulfilment workflow

1. A customer can only open a product that is published and marked `in_shop`.
   Removing “For sale” also makes stale carts fail server validation.
2. The browser cart stores only the customer's choices. On checkout, the server
   validates every photo and SKU, recalculates all prices, requests shipping
   from Prodigi (when configured), and validates any Stripe Promotion Code.
3. The server creates an embedded Stripe Checkout Session. Stripe's Payment
   Element receives the card/wallet details directly; the website never handles
   or stores raw payment credentials.
4. Stripe authorises and captures the payment, redirects the customer to the
   success page, and independently sends a signed webhook. The redirect is for
   customer experience only and is never trusted to create an order.
5. The webhook verifies Stripe's signature, fetches the authoritative Checkout
   Session, confirms it is paid, then calls one Supabase database function that
   atomically creates the order and all line items. Replayed webhooks return the
   existing order instead of duplicating it.
6. The order receives a 45-minute `submit_after` hold. During this window the
   admin can refund it. If a photo lacks a print-master JPEG, the order remains
   `awaiting_master`; uploading one attaches it to every order for that photo.
7. Supabase Cron calls the fulfilment endpoint every ten minutes. Once the hold
   has elapsed, all masters exist and `SHOP_FULFILMENT_ENABLED=true`, the server
   atomically claims the order and gives Prodigi short-lived signed image URLs.
8. Prodigi charges the merchant account separately, prints and ships the work.
   Stripe does not transfer the customer's payment to Prodigi; Stripe revenue
   and Prodigi production costs are two separate account flows.
9. Prodigi callbacks are authenticated with the callback secret, then the server
   re-fetches the order from Prodigi before trusting its production/tracking
   state. The cron also monitors submitted orders as a callback fallback.
10. Confirmation and tracking emails are sent through Resend. Email failure is
    reported but never rolls back a valid payment or fulfilment state.

## 1. Local Stripe test mode

Add these to `.env.local` (never paste the secret values into chat or commit them):

```dotenv
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
VITE_SHOP_ENABLED=true
SHOP_CHECKOUT_ENABLED=true
SHOP_FULFILMENT_ENABLED=true
```

Run the app through `vercel dev`, not only `npm run dev`, because checkout calls
the serverless endpoints under `/api`.

For local webhook testing, install/login to Stripe CLI and run:

```sh
stripe listen --forward-to localhost:3000/api/stripe-webhook
```

Copy the temporary `whsec_...` value into `.env.local` as
`STRIPE_WEBHOOK_SECRET`, restart `vercel dev`, then use Stripe test card
`4242 4242 4242 4242`, any future date, any CVC.

## 2. Supabase migration (applied)

The target Supabase project was verified on 2026-08-16 with the order tables and
runtime shop settings present. The source-of-truth migration is
`supabase/migrations/20260816000132_shop_checkout_fulfilment.sql`. Run it in the
Supabase SQL editor only for a fresh/restored environment. It creates:

- private `orders` and `order_items` tables (service-role only);
- the private, JPEG-only `print-masters` bucket;
- admin-only bucket upload policies;
- a Supabase Cron job every ten minutes.

The Cron job sends no request until both Vault secrets in step 4 exist. Even after
they exist, the endpoint refuses Prodigi submission while
`SHOP_FULFILMENT_ENABLED` is not exactly `true`.

## 3. Vercel environment

Set the server-only variables for Production, Preview and Development as useful:

```dotenv
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
PRODIGI_API_KEY=...
PRODIGI_API_BASE_URL=https://api.sandbox.prodigi.com/v4.0
PRODIGI_CALLBACK_SECRET=<random 32+ character value>
SUPABASE_SERVICE_ROLE_KEY=...
CRON_SECRET=<random 32+ character value>
SITE_URL=https://www.samduckworth.com
RESEND_API_KEY=re_...
SHOP_EMAIL_FROM=Sam Duckworth Photography <orders@samduckworth.com>
SHOP_ALERT_EMAIL=<Sam's email>
```

Also set `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...` as a public build variable.

## 3a. Deployment feature gates

The shop has three environment-level gates and they all default to disabled
when missing:

```dotenv
VITE_SHOP_ENABLED=false
SHOP_CHECKOUT_ENABLED=false
SHOP_FULFILMENT_ENABLED=false
```

- `VITE_SHOP_ENABLED` hides public shop links and blocks public access to shop,
  product and checkout pages. Verified signed-in admins retain access.
- `SHOP_CHECKOUT_ENABLED` prevents public creation of Stripe Checkout Sessions.
  An admin shop request includes its Supabase access token; the server verifies
  both the Auth user and `admin_users` membership before allowing a test Session.
- `SHOP_FULFILMENT_ENABLED` prevents the cron/admin from submitting work to
  Prodigi and has no admin bypass. Refunds, order inspection and callbacks for
  existing orders remain available.

Keep all three `false` in Vercel Production while deploying and testing the
rest of the site. Preview/Development may use `true` with Stripe test and
Prodigi sandbox credentials. Launch still requires the database visibility
flags `shop_public` and `print_configurator`; these are a second, admin-managed
gate rather than a replacement for the environment kill switches.

| Environment | Public UI | Public checkout | Admin shop/test checkout | Prodigi fulfilment |
|---|---:|---:|---:|---:|
| Production during rollout | `false` | `false` | available when signed in | `false` |
| Preview/local test mode | optional | optional | available when signed in | `true` with sandbox keys only |
| Production launch | deliberate `true` | deliberate `true` | available | enable only after end-to-end proof |

Changing `VITE_SHOP_ENABLED` requires a new frontend build. The two server flags
are read by the API runtime. Do not use live Stripe or Prodigi credentials in a
Preview environment.

## Admin workflow

- **Admin → Shop → Shop catalogue:** toggle individual photos or use Photos bulk
  actions to mark them For sale/Not for sale. “Open admin shop” enters the full
  storefront even while public access is disabled.
- A product is eligible only when it is both published and For sale. Turning For
  sale off removes it from the shop, direct product route, lightbox order action,
  related products and server checkout validation.
- **Admin → Shop → Orders:** review paid orders, upload the original full-resolution
  JPEG when needed, check the reported resolution, submit immediately or refund
  before Prodigi submission.
- Admin test purchases may create paid/held orders while public checkout is off,
  but they remain queued until `SHOP_FULFILMENT_ENABLED=true`.
- Removing a photo from sale never mutates a paid order; paid line items are
  immutable snapshots and remain fulfilment-ready.

## 4. Activate the ten-minute fulfilment schedule

After the production endpoint is deployed, run these once in Supabase SQL Editor.
The second value must exactly match Vercel's `CRON_SECRET`:

```sql
select vault.create_secret(
  'https://www.samduckworth.com/api/submit-orders',
  'shop_fulfilment_url'
);
select vault.create_secret(
  '<same value as Vercel CRON_SECRET>',
  'shop_cron_secret'
);
```

Supabase Cron is used because Vercel Hobby only permits daily cron jobs; the
required 45–55 minute submission window needs a ten-minute cadence.

## 5. Stripe Dashboard

Create a webhook endpoint at:

`https://www.samduckworth.com/api/stripe-webhook`

Subscribe to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`

Put its signing secret into Vercel as `STRIPE_WEBHOOK_SECRET`.

Create Promotion Codes in Stripe. The custom checkout applies them through
Stripe's own API; there is no readable frontend code list anymore.

## 6. Prodigi and email

Start with the sandbox key and base URL above. The callback URL is included on
every submitted order and protected with `PRODIGI_CALLBACK_SECRET`; callback
payloads are then re-fetched from Prodigi before any status is trusted.

Verify the sending domain in Resend before changing `SHOP_EMAIL_FROM` to the live
address. With no Resend key, payment and fulfilment continue safely and email is
logged as skipped.

## 7. Required proof before launch

1. Successful test card creates one order, despite replaying the webhook.
2. Declined and 3-D Secure test cards show recoverable errors.
3. Upload a full-resolution JPEG in Admin → Shop → Orders.
4. Let the 45-minute hold expire; confirm one sandbox Prodigi order only.
5. Confirm callback/tracking and both emails.
6. Replace all test/sandbox keys with live keys.
7. Place one real order to yourself before enabling the public shop flags.
