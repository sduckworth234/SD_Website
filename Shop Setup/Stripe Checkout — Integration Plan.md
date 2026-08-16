# Stripe checkout — integration plan
**samduckworth.com · Framed Editions · Australia**

> **Status: historical plan, superseded 2026-08-16.** The integration is now
> implemented using an embedded **Stripe Checkout Session + Payment Element**,
> not the raw-PaymentIntent design proposed below. Use
> [Shop Checkout — Setup Handoff.md](./Shop%20Checkout%20%E2%80%94%20Setup%20Handoff.md)
> for current setup and operations. The live code is
> `api/create-checkout-session.mjs`, `api/stripe-webhook.mjs`,
> `api/checkout-status.mjs`, `api/submit-orders.mjs`,
> `api/prodigi-callback.mjs`, `api/admin-orders.mjs`, and `server/shop/`.
>
> Implemented outcomes include server-side catalogue validation/repricing,
> Prodigi shipping quotes, native Stripe Promotion Codes, webhook-only atomic
> order creation, a 45-minute hold, Supabase ten-minute fulfilment Cron, private
> JPEG masters, Prodigi callbacks, order/tracking email, and admin order controls.
> Sections below are preserved for rationale and historical estimates; their
> “not built” status, endpoint names and proposed schema are no longer current.

Written 2026-08-14. Builds on the Prodigi work (`Prodigi API — Investigation
& Setup Plan.md`, verified 2026-08-05) and the print configurator that's now
live behind the `print_configurator` flag (`/shop/<slug>`, real sizes/colours/
mount/pricing, working cart). This plan takes that cart to an actual charge.

---

## 0. Where we actually are

**Built and shipped (behind `print_configurator`, off by default):**
- Real Prodigi catalogue (`src/lib/printCatalogue.ts`) — verified prices,
  sizes, shipping math, all AU-fulfilled.
- `PrintConfigurator.tsx` — the true-to-size product page at `/shop/<slug>`,
  reachable from the shop grid *and* every photo's Lightbox ("Order a print").
- `CartProvider` (`src/lib/cart.tsx`) — a real cart, `localStorage`-backed,
  survives navigation. Discount codes are currently **hardcoded in the
  frontend JS** (`PRINT10`, `WELCOME15`) — fine for a demo, not for launch
  (§6 covers the real replacement).
- Demo checkout button that just shows an alert. Nothing charges anyone.

**Not built yet — what this plan covers:**
- An actual payment.
- Anywhere to store an order once it's paid.
- Anything that gets that order to Prodigi.
- A way to know it shipped.
- A working discount code.
- Print masters (full-res JPEGs) for Prodigi to print from — the gallery's
  WebPs are the wrong format *and* too small (§2.1 of the Prodigi plan).

That last one is the piece most likely to get skipped by accident. A checkout
that takes payment for a print you can't yet generate a printable file for is
worse than no checkout — flag it now so it's a real phase below, not a
surprise in week two.

---

## 1. The integration shape — hosted Checkout vs. a custom page

Two ways to take the payment. Recommending one, but laying out both because
you asked for "custom payment page" and I want the trade-off explicit rather
than decided silently.

### Option A — Stripe Checkout (hosted)
Stripe redirects the customer to `checkout.stripe.com` for the card entry,
then back to your site on success. You can brand it (logo, accent colour) but
it's still visibly a Stripe page, and the customer leaves samduckworth.com for
~30 seconds.
- **Pros:** least code, Stripe owns 100% of PCI scope, Apple Pay/Google Pay
  and SCA (3-D Secure) work with zero extra effort, ships fastest.
- **Cons:** breaks the visual continuity — after the framed-photo product page
  and the dark Darkroom cart, a redirect to a generic Stripe page reads as a
  downgrade.

### Option B — Custom page, Stripe Elements embedded (recommended)
A real `/checkout` route in the app, styled exactly like the rest of the site
(same dark palette, Archivo/Space Grotesk, oak accent), with Stripe's
**Payment Element** mounted inside it. Card entry happens inside a Stripe
`<iframe>` embedded in *your* page, so PCI scope stays with Stripe (you never
touch raw card numbers) but the customer never leaves your domain. Apple Pay,
Google Pay and 3-D Secure are still handled automatically — Payment Element
does that work, Elements isn't "build 3-D Secure yourself."
- **Pros:** looks like one continuous, professional purchase flow. This is
  what "need to look professional" actually buys you over Option A.
- **Cons:** you own the checkout page's layout, form validation, loading and
  error states — maybe 150–250 more lines than Option A, and a bit more
  surface area to test (declined card, expired card, network drop mid-payment).

**Recommendation: Option B.** The product page and cart are already
custom-built and on-brand; redirecting away for the actual payment would be
the one jarring step in an otherwise cohesive flow. The extra work is bounded
and well-trodden (Stripe's own docs are built around exactly this pattern —
`@stripe/react-stripe-js`'s `<PaymentElement>` inside your own form).

---

## 2. What a charge actually costs (verified against Stripe's AU pricing page, today)

| | Rate |
|---|---|
| Domestic card (AU-issued) | 1.75% + $0.30 → drops to 1.7% + $0.30 from 1 Oct 2026 |
| International card | ~3.5% + $0.30 |
| Currency conversion | +2%, only if charging in a currency other than AUD (won't apply — see below) |
| Monthly / setup fees | None |
| Standard payouts | Free (rolling, weekly or monthly to your bank) |
| Instant payout | 1.5% of the amount, min $0.50 |
| Disputes | $25 AUD per dispute received |
| Refunds | No fee to refund, but **Stripe keeps the original processing fee** |

Checkout runs entirely in AUD (AU shipping only), so the 2% conversion fee
never applies — Stripe charges the card in AUD regardless of which country
issued it; only the higher *international-card* rate kicks in for
overseas-issued cards.

**Real numbers against your catalogue:**

| Order | Charged | Stripe fee (domestic card) | You net |
|---|---|---|---|
| 1× A3 Mounted, Wood | $92.20 | ~$1.91 | ~$90.29 |
| 1× A3 + 1× A4 (same order) | $154.30 | ~$2.99 | ~$151.31 |
| 1× A1 Mounted | $183.10 | ~$3.51 | ~$179.59 |

Fees stay under ~2.5% of order value across your whole size range — not a
meaningful margin hit against the print cost itself.

---

## 3. Database — new tables

Two new tables, service-role only (same posture as `integration_secrets` and
the order tables sketched in the Prodigi plan's §9). Anon gets **no** access
— checkout writes go through a serverless function using the service key,
never directly from the browser.

```sql
-- One row per completed purchase.
create table public.orders (
  id                  uuid primary key default gen_random_uuid(),
  stripe_payment_intent_id text unique not null,
  status              text not null default 'paid',
    -- paid → queued → submitted → in_production → shipped → cancelled → failed
  customer_email      text not null,
  customer_name       text not null,
  shipping_address    jsonb not null,   -- {line1, line2, suburb, state, postcode, country}
  subtotal_aud        numeric(10,2) not null,
  shipping_aud        numeric(10,2) not null,
  discount_aud        numeric(10,2) not null default 0,
  discount_code       text,
  total_aud           numeric(10,2) not null,
  prodigi_order_id    text,
  tracking_number     text,
  tracking_url        text,
  submit_after        timestamptz not null,   -- now() + 45min, the cancel-window hold
  submitted_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One row per print within an order.
create table public.order_items (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders(id) on delete cascade,
  photo_id            uuid not null references public.photos(id),
  -- Snapshotted at time of purchase — a photo's title/thumb can change later,
  -- the order record shouldn't silently drift with it.
  title               text not null,
  location            text not null,
  thumb_url           text not null,
  size                text not null,       -- A5..A1
  mounted             boolean not null,
  colour              text not null,       -- natural | black | white
  sku                 text not null,       -- GLOBAL-CFPM-A3 etc.
  unit_price_aud      numeric(10,2) not null,
  print_master_path   text,                -- private bucket path, filled by §5
  created_at          timestamptz not null default now()
);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
-- No policies added → both tables are service-role only by default, exactly
-- like integration_secrets. The admin Orders panel (§8) reads through the
-- service key via a serverless function, not the browser's anon client.
```

This is a genuine schema change — same drill as always: I write the
migration file in `supabase/migrations/`, you run it by hand in the Supabase
SQL editor (the service key does rows, not DDL).

---

## 4. Server-side flow, end to end

Four serverless functions in `api/`, alongside the existing
`instagram-sync.mjs`:

**`api/create-payment-intent.mjs`** — called when the customer lands on
`/checkout`.
1. Receives the cart (photo ids, size, colour, mount) from the client.
2. **Recomputes every price server-side** from `printCatalogue.ts` — the
   client's cart is a convenience, never a source of truth for money.
3. Calls Prodigi's `/quotes` for the real live shipping cost.
4. Creates a Stripe `PaymentIntent` for the verified total, attaches the cart
   contents as metadata.
5. Returns the `client_secret` to the browser — this is what
   `<PaymentElement>` needs to mount and take the card.

**`api/stripe-webhook.mjs`** — Stripe calls this when the payment settles.
1. Verifies the webhook signature with `STRIPE_WEBHOOK_SECRET` (Vercel
   functions need the **raw** request body for this, not the parsed JSON —
   a common integration trip-up, flagging it now).
2. On `payment_intent.succeeded`: writes the `orders` + `order_items` rows,
   `submit_after = now() + 45 minutes`.
3. Sends the confirmation email (§7).
4. This is the *only* place an order gets created — never trust the
   client-side "success" redirect alone, since a closed tab or network drop
   shouldn't be able to skip payment confirmation.

**`api/submit-orders.mjs`** — Vercel Cron, every 10 minutes.
1. Finds orders where `status = 'paid'` and `submit_after <= now()`.
2. For each item, confirms a `print_master_path` exists (§5) — converts to
   JPEG if needed, gets a fresh signed URL.
3. Submits to Prodigi via `POST /orders`, **with an idempotency key** derived
   from the order id — if the cron re-runs before the status updates, this
   guarantees it can't double-submit and double-charge you for two prints.
4. Sets `status = 'submitted'`, stores `prodigi_order_id`.
5. Includes the JPEG-only guard and the "10 minutes with no
   `downloadAssets: Complete`" stall alarm from the Prodigi plan §2.1 — the
   silent-hang failure mode is real and already proven to happen.

**`api/prodigi-callback.mjs`** — Prodigi's own webhook (CloudEvents), fires on
stage change and shipment.
1. Updates `status` and, once shipped, `tracking_number`/`tracking_url`.
2. Sends the "your prints have shipped" email.

```
Customer          Stripe              Vercel                Prodigi
   │  pay ──────────▶│                    │                      │
   │                 │──webhook──────────▶│ write order (paid)   │
   │                 │                    │ submit_after=+45min  │
   │                 │                    │                      │
   │                 │           [cron, every 10 min]            │
   │                 │                    │──POST /orders───────▶│
   │                 │                    │◀──── prodigi_order_id│
   │                 │                    │                      │
   │                 │                    │◀────callback (ship)──│
   │  "it shipped" ◀─────────email────────│                      │
```

---

## 5. Print masters — the piece checkout depends on

This isn't optional and it's the part most likely to get quietly skipped:
Prodigi needs a full-res **JPEG** (the gallery's WebP is capped at 2400px and
silently hangs Prodigi's downloader — Prodigi plan §2.1). Two ways to get
there, already scoped in the original plan:

- **Reactive (simpler, ships faster):** order comes in → admin screen flags
  "needs print master" → you drag in the original from `/Volumes/SamD2` →
  server converts to JPEG, stores it in a private `print-masters` bucket. Works
  from day one, costs you a few minutes per *first-time* order for a photo.
- **Proactive (better long-term):** upload the master when a photo is added
  to the shop (`in_shop = true`), not when it sells. Removes the "order sits
  waiting on you" failure mode entirely, and lets the size picker gate on the
  photo's *real* pixel dimensions instead of offering every size for every
  photo (a known gap — right now A1 is offered even for a photo that can't
  support it at 300dpi).

**Recommendation:** ship reactive first (it's what lets checkout go live
soonest), move to proactive once the shop has real sales volume to justify
the upfront work. Either way, `print_masters` is a private, service-role-only
bucket — same posture as everything else money-adjacent in this plan.

---

## 6. Discount codes — move off the hardcoded frontend list

`PRINT10`/`WELCOME15` currently live in `PrintConfigurator.tsx` as a plain
JS object — anyone can open dev tools and read every valid code. Two real
options:

- **Stripe Promotion Codes** (recommended): create codes in the Stripe
  Dashboard, attach them to the `PaymentIntent`/Checkout Session — Stripe
  validates and applies the discount server-side, no code of yours involved.
  Free, no extra table, and Stripe's dashboard gives you usage stats for free.
- **A `discount_codes` table**, validated in `create-payment-intent.mjs` —
  only worth it if you want logic Stripe's Promotion Codes don't cover (e.g.
  "10% off, but only on orders containing an A1").

**Recommendation:** Stripe Promotion Codes, unless you hit a rule it can't
express.

---

## 7. Emails

Two transactional emails minimum: order confirmation (on `payment_intent.succeeded`)
and shipping notification (on Prodigi's shipped callback). Stripe can send a
basic receipt automatically with zero setup, but it's generic and won't carry
your framed-print branding or the "here's what you ordered" line items.
**Recommendation:** a proper transactional email service (Resend is the
simplest to wire into a Vercel function; Postmark is the more established
alternative) — both are cheap enough at this volume to be close to free.

---

## 8. Admin — an Orders panel

A new tab in `/admin`, alongside Visibility: list orders (status, customer,
total, tracking), search by email, and a manual "submit to Prodigi now"
override for the 45-minute hold (matches the "submit now" button already
scoped in the original Prodigi plan §2.2) plus a manual cancel/refund trigger.
Read-only against `orders`/`order_items` through a service-role serverless
endpoint — the admin browser client never gets direct table access, same as
`source_path`.

---

## 9. Security checklist (so it isn't an afterthought)

- **Never trust a client-sent price.** Every dollar figure in a
  `PaymentIntent` is recomputed server-side from `printCatalogue.ts` and a
  live Prodigi quote — the cart's numbers are a UI convenience only.
- **Webhook signature verification** on both Stripe's and Prodigi's callbacks
  — an unverified webhook endpoint is an open door to fake "paid" orders.
- **Idempotency keys** on the Prodigi submission — the 10-minute cron must be
  safe to re-run without double-printing.
- **RLS**: `orders`/`order_items` are service-role only, no anon policy at
  all — same posture already proven out on `integration_secrets` and
  `source_path`.
- **Env vars**, server-only, never `VITE_`-prefixed: `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, plus whatever the email provider needs.
- **Rate-limit** `create-payment-intent.mjs` — it's the one public endpoint
  that does real work before payment exists.

---

## 10. Sequencing — five phases

1. **Schema + checkout page, test mode only.** `orders`/`order_items`
   migration, `/checkout` route with `<PaymentElement>`, `create-payment-intent.mjs`,
   `stripe-webhook.mjs`. Prove a full purchase end-to-end with Stripe test
   cards — no real money, no Prodigi submission yet.
2. **Prodigi submission.** `submit-orders.mjs` cron + the held-order queue,
   tested against the sandbox Prodigi key (reactive print-master flow, §5).
3. **Print masters.** Wire the manual "needs print master" admin flow; revisit
   proactive upload once volume justifies it.
4. **Emails + Orders admin panel.** Confirmation/shipped emails, the admin
   list/search/manual-submit view.
5. **Go live.** Stripe business verification (bank account, ABN or not per
   your accountant), live keys into Vercel env, live webhook endpoint
   registered, one real order placed to yourself before announcing it — same
   discipline as the Prodigi live-key step.

---

## 11. Your setup checklist

1. Create the Stripe account, set **business currency to AUD**.
2. Decide GST/ABN registration with your accountant — changes whether Stripe
   prices need +10% added at checkout (flagged, unresolved, since the original
   shop plan — still not something I can answer for you).
3. Add a bank account for payouts.
4. Pick an email provider (Resend recommended) and get its API key.
5. When ready for Phase 5: complete Stripe's business verification, generate
   live keys.

---

## 12. What I build

Everything in §3, §4, §6 (Promotion Codes wiring), §7 (email sending code)
and §8 — migration, serverless functions, the `/checkout` page styled to
match the site, and the admin Orders panel. Phases 1–4 don't need your Stripe
account to exist yet beyond test-mode keys, which you can generate the moment
you sign up — happy to start on Phase 1 as soon as you've got those.
