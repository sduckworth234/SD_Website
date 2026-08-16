# Shop checkout — account handoff

The code, schema, custom checkout, webhook, provider-locked fulfilment queue,
manual fulfilment controls, optional Prodigi automation, customer/merchant emails,
order admin and reactive print-master upload are implemented. This file is the
short account-side checklist needed to activate them.

**Code status (2026-08-16):** production build and dependency audit pass; the
desktop/mobile checkout and default-off states have been checked without console
errors. A real Stripe test-card payment, signed webhook, atomic Supabase order and
same-event replay have passed. Existing test orders are locked to `manual`, so a
future Prodigi toggle cannot submit them. Decline/3DS, master upload, live email
proof and one real low-value purchase are still required before public launch.
Prodigi sandbox/callback proof is required only before changing the provider from
manual to Prodigi, not before launching the manual shop.

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
6. The Checkout Session records `manual` or `prodigi`; the webhook copies that
   provider onto the paid order. This per-order lock is the fail-safe: changing
   the deployment later affects new checkouts only, never older paid orders.
7. In `manual` mode, checkout makes no Prodigi request. The order appears in
   **Admin → Shop Orders**, Sam receives an alert email, and the admin can upload
   a master, start fulfilment, add carrier/tracking, mark shipped and refund.
8. In `prodigi` mode, Supabase Cron calls the fulfilment endpoint every ten
   minutes. Once the 45-minute hold has elapsed and all masters exist, the server
   atomically claims only orders already locked to `prodigi` and gives Prodigi
   short-lived signed image URLs. Manual rows are never selected.
9. Prodigi charges the merchant account separately, prints and ships the work.
   Stripe does not transfer the customer's payment to Prodigi; Stripe revenue
   and Prodigi production costs are two separate account flows.
10. Prodigi callbacks are authenticated with the callback secret, then the server
   re-fetches the order from Prodigi before trusting its production/tracking
   state. The cron also monitors submitted orders as a callback fallback.
11. Resend sends Sam the new-order alert and sends the customer the branded thank
    you/confirmation and tracking emails, including the @sam.duckworth link.
    Stripe supplies the payment receipt and, when explicitly enabled, paid invoice
    PDFs. Email failure is reported but never rolls back a valid paid order.

## 1. Local Stripe test mode

Add these to `.env.local` (never paste the secret values into chat or commit them):

```dotenv
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
VITE_SHOP_ENABLED=true
SHOP_CHECKOUT_ENABLED=true
SHOP_FULFILMENT_PROVIDER=manual
STRIPE_PAID_INVOICES_ENABLED=false
```

Export the local variables, then run the app through the development-only Vercel
config—not only `npm run dev`—because checkout calls the serverless endpoints
under `/api`:

```sh
set -a
source .env.local
set +a
npx vercel dev -A vercel.dev.json
```

The development config deliberately omits the production SPA rewrite so Vite's
internal modules remain reachable; Vite supplies its own local history fallback.
Keep the provider `manual` for payment/webhook testing and the initial public
launch. Change it to `prodigi` only after the sandbox cycle and print masters pass.

For local webhook testing, install/login to Stripe CLI and run:

```sh
stripe listen --forward-to localhost:3000/api/stripe-webhook
```

Copy the temporary `whsec_...` value into `.env.local` as
`STRIPE_WEBHOOK_SECRET`, restart the command above, then use Stripe test card
`4242 4242 4242 4242`, any future date, any CVC.

## 2. Supabase migration (applied)

The target Supabase project was verified on 2026-08-16 with the order tables and
runtime shop settings present. The source migrations are
`supabase/migrations/20260816000132_shop_checkout_fulfilment.sql`,
`20260816112601_manual_fulfilment_provider.sql` and
`20260816112715_production_security_cleanup.sql`, followed by
`20260816113125_admin_photos_rpc.sql`. They are already applied to the
live project; run them in order only for a fresh/restored environment. They create:

- private `orders` and `order_items` tables (service-role only);
- the private, JPEG-only `print-masters` bucket;
- admin-only bucket upload policies;
- a Supabase Cron job every ten minutes;
- the immutable per-order fulfilment provider and Stripe receipt/invoice links.

The Cron job sends no request until both Vault secrets in step 4 exist. In manual
mode the endpoint returns a healthy no-op. It submits only when
`SHOP_FULFILMENT_PROVIDER` is exactly `prodigi`, a Prodigi key exists, and the
individual order was also created as `prodigi`.

## 3. Vercel environment

Set the server-only variables for Production, Preview and Development as useful:

```dotenv
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PAID_INVOICES_ENABLED=false
SUPABASE_SERVICE_ROLE_KEY=...
CRON_SECRET=<random 32+ character value>
SITE_URL=https://www.samduckworth.com
RESEND_API_KEY=re_...
SHOP_EMAIL_FROM=Sam Duckworth Photography <orders@mail.samduckworth.com>
SHOP_ALERT_EMAIL=samduckworthphoto@gmail.com
SHOP_INSTAGRAM_URL=https://instagram.com/sam.duckworth
```

Also set `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...` as a public build variable.
Prodigi variables are optional while the provider is manual. Add the three
Prodigi values from `.env.example` only for sandbox/production automation.

## 3a. Deployment feature gates

The shop has two public gates plus a provider selector. Missing/invalid provider
values always fall back to manual:

```dotenv
VITE_SHOP_ENABLED=false
SHOP_CHECKOUT_ENABLED=false
SHOP_FULFILMENT_PROVIDER=manual
STRIPE_PAID_INVOICES_ENABLED=false
```

- `VITE_SHOP_ENABLED` hides public shop links and blocks public access to shop,
  product and checkout pages. Verified signed-in admins retain access.
- `SHOP_CHECKOUT_ENABLED` prevents public creation of Stripe Checkout Sessions.
  An admin shop request includes its Supabase access token; the server verifies
  both the Auth user and `admin_users` membership before allowing a test Session.
- `SHOP_FULFILMENT_PROVIDER=manual` keeps the checkout and order inbox live while
  making no Prodigi shipping-quote or order API calls. Manual is the fail-safe.
- `SHOP_FULFILMENT_PROVIDER=prodigi` makes new Checkout Sessions lock new orders
  to Prodigi. Existing manual orders stay manual and must be completed manually.
- `STRIPE_PAID_INVOICES_ENABLED=true` opts one-time purchases into Stripe paid
  invoice PDFs, which Stripe prices separately. Ordinary receipts do not need it.

Keep both public gates `false` and the provider `manual` in Vercel Production
while deploying and testing the rest of the site. Preview/Development may use
test Stripe credentials. Launch still requires the database visibility
flags `shop_public` and `print_configurator`; these are a second, admin-managed
gate rather than a replacement for the environment kill switches.

| Environment | Public UI | Public checkout | Admin shop/test checkout | Prodigi fulfilment |
|---|---:|---:|---:|---:|
| Production during rollout | `false` | `false` | available when signed in | `manual` |
| Preview/local test mode | optional | optional | available when signed in | `manual`, or `prodigi` with sandbox keys |
| Initial production launch | deliberate `true` | deliberate `true` | available | `manual` |
| Later automated launch | `true` | `true` | available | `prodigi` only after sandbox proof |

Changing `VITE_SHOP_ENABLED` requires a new frontend build. Checkout/provider
values are read by the API runtime. Do not use live Stripe or Prodigi credentials
in a Preview environment.

## Admin workflow

- **Admin → Shop → Shop catalogue:** toggle individual photos or use Photos bulk
  actions to mark them For sale/Not for sale. “Open admin shop” enters the full
  storefront even while public access is disabled.
- A product is eligible only when it is both published and For sale. Turning For
  sale off removes it from the shop, direct product route, lightbox order action,
  related products and server checkout validation.
- **Admin → Shop Orders:** review paid orders, customer/shipping details, payment
  proof and the provider locked to that order. In manual orders, upload the
  original JPEG when useful, start fulfilment, enter tracking and mark shipped;
  this immediately sends the customer dispatch email. Refund remains available.
- Prodigi orders show an explicit Submit to Prodigi action only when the global
  provider is also Prodigi and the API key is configured.
- Admin test purchases may create paid/held orders while public checkout is off,
  and manual orders never enter the automatic queue.
- Removing a photo from sale never mutates a paid order; paid line items are
  immutable snapshots and remain fulfilment-ready.

## 4. Activate the ten-minute fulfilment schedule (Prodigi only)

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

This is optional for the initial manual launch. Supabase Cron is used later
because the required 45–55 minute Prodigi submission window needs a ten-minute
cadence. In manual mode an already-configured job returns a healthy no-op.

## 5. Stripe Dashboard

Create a webhook endpoint at:

`https://www.samduckworth.com/api/stripe-webhook`

Subscribe to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`

Put its signing secret into Vercel as `STRIPE_WEBHOOK_SECRET`.

Create Promotion Codes in Stripe. The custom checkout applies them through
Stripe's own API; there is no readable frontend code list anymore.

In **Settings → Business → Customer emails**, enable successful-payment and
refund receipts. Complete Stripe Branding and Public details (legal name,
support address/email and privacy URL) so its receipt is trustworthy. The code
already supplies `receipt_email` and stores the Stripe receipt URL on the order.

If a formal paid invoice PDF is required, review Stripe's separate price for
one-time post-payment invoices, then set `STRIPE_PAID_INVOICES_ENABLED=true`.
Stripe will email the invoice summary/PDF; the custom thank-you email also links
it. Keep this false if a normal payment receipt is sufficient.

## 6. Email and optional Prodigi

Resend handles the photography-specific experience that Stripe does not: Sam's
new-order alert, the customer's branded thank-you/order summary with Instagram
link, and the dispatch/tracking email. Stripe handles the regulated payment
proof (receipt, refund receipt and optional paid invoice).

The Tokyo-region Resend sending domain `mail.samduckworth.com` was DNS-verified
on 2026-08-16. Vercel uses `Sam Duckworth Photography
<orders@mail.samduckworth.com>` with alerts sent to
`samduckworthphoto@gmail.com`. Both the customer confirmation and merchant alert
were accepted by Resend in a protected Preview test. With no Resend key, payment
and order creation continue safely and email is logged as skipped; that state is
safe for testing but not acceptable for public launch.

Prodigi can remain entirely unconfigured in manual mode. When automation is
wanted, start with its sandbox key and base URL. The callback URL is included on
every submitted order and protected with `PRODIGI_CALLBACK_SECRET`; callback
payloads are then re-fetched from Prodigi before any status is trusted.

## 7. Required proof before launch

- [x] Successful test card creates one order, despite replaying the webhook.
- [x] Existing orders are provider-locked to manual; RLS and service-role-only
      atomic creation were re-verified after migration.
- [ ] Declined and 3-D Secure test cards show recoverable errors.
- [ ] Upload a full-resolution JPEG in Admin → Shop Orders.
- [ ] Confirm Sam's new-order alert, customer thank-you/receipt and manual
      tracking email using the verified Resend domain.
- [ ] Replace Stripe test keys/webhook with live keys/webhook.
- [ ] Place one real order to yourself before enabling the public shop flags.
- [ ] Only before the later Prodigi toggle: let the hold expire, confirm exactly
      one sandbox order, callback, tracking and shipping email.

## 8. What Sam needs to provide or decide

Do not paste secrets into chat; enter them directly in Vercel/Stripe/Resend.

1. **Customer contact (confirmed):** `samduckworthphoto@gmail.com` receives
   new-order alerts and is the public support email.
2. **Resend (complete):** `mail.samduckworth.com` is verified and the deployed
   sender is `orders@mail.samduckworth.com`.
3. **Stripe live account:** completed identity/business verification, payout bank
   account, public business/support details, `pk_live`, `sk_live`, and the live
   webhook signing secret. Decide whether normal receipts are enough or paid
   invoice PDFs should be enabled at Stripe's extra price.
4. **Business/tax wording:** legal/trading name, ABN, GST registration status,
   support/returns address, privacy URL, returns/damage policy and expected manual
   dispatch timeframe. These must agree across the website, Stripe and emails.
5. **Manual shipping decision:** carrier(s), tracked-service assumptions and the
   final Australia-wide shipping amount currently represented by the catalogue
   estimate. Prodigi is not needed for this launch.
6. **Sale catalogue:** confirm the photographs marked For sale, final prices and
   that a usable full-resolution master can be located for every enabled size.
7. **Launch approval:** complete one real low-value order to yourself, inspect the
   bank/payment record, both inboxes, Admin → Shop Orders, refund path and manual
   tracking email, then explicitly approve enabling the two public gates.
8. **Supabase Auth:** enable leaked-password protection in the project Auth
   settings. The remaining advisor warnings for `is_admin()` and
   `get_admin_photos()` are intentional authenticated-only, internally
   `is_admin()`-guarded RPCs; anon execution is explicitly revoked.
