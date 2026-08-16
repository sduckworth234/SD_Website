# Prodigi API — Investigation & Setup Plan
**samduckworth.com · Framed Editions · Australia**

> **Status: verified research, implementation completed 2026-08-16.** Use
> [Shop Checkout — Setup Handoff.md](./Shop%20Checkout%20%E2%80%94%20Setup%20Handoff.md)
> for the current operational workflow. The finished system uses live Prodigi
> shipping quotes, a private JPEG-only `print-masters` bucket, a 45-minute order
> hold, Supabase Cron every ten minutes, authenticated callbacks with an
> authoritative Prodigi re-fetch, and Admin → Shop Orders for master upload,
> submit-now and refunds. The research below remains useful for catalogue,
> resolution, crop and pricing rationale, but proposed build steps are historical.

Written 2026-08-05. **Verified against the live sandbox API** the same day — every price, pixel
dimension and behaviour below came back from `api.sandbox.prodigi.com`, not from the docs.
Builds on *Online Shop — End-to-End Setup Plan* (2026-06-15) in this folder.

Companion data files, generated from the API:
- `prodigi-framed-au-catalogue.csv` — all **108** AU-shippable framed SKUs, with landed AUD cost
- `prodigi-framed-au-catalogue.json` — same, with print areas, frame colours, labs, carriers

---

## 0. The one thing to understand first

**Prodigi has no concept of "creating a product."**

No product builder, no template designer, no "upload your art and we'll make a listing." That
surprises most people coming from Printful/Printify/Gelato.

Prodigi is a **fulfilment API**. It publishes a fixed catalogue of SKUs. When an order comes in, you
POST *"one of `GLOBAL-CFPM-A2`, frame colour Natural, image at this URL, ship to Manly"* — and a lab
in Australia prints it, frames it and posts it. That's the entire model.

**So "creating products" is a job on our side.** The catalogue — which photos, which sizes, which
frames, what they cost — is data in *your* Supabase, rendered by *your* shop page. Prodigi never
sees it. Which means I can build essentially all of it; what can't be delegated is the decisions
(§6) and the account setup (§7).

---

## 1. API surface

| | |
|---|---|
| Sandbox | `https://api.sandbox.prodigi.com/v4.0` — no charge, no fulfilment |
| Live | `https://api.prodigi.com/v4.0` |
| Auth | `X-API-Key` header. Sandbox and live keys are not interchangeable. |
| Docs | https://www.prodigi.com/print-api/docs/reference/ · Postman: https://postman.prodigi.com/ |

What we use: `GET /products/{sku}` (variants, attributes, destinations, required pixel dimensions) ·
`POST /quotes` (real landed cost + which lab + which carrier) · `POST /orders` · `GET /orders/{id}` ·
`POST /orders/{id}/actions/{cancel|updateShippingMethod|updateRecipient}` · **callbacks** (CloudEvents
v1.0 POSTs on stage change and shipment — how the site learns "shipped" + tracking without polling).

Lifecycle: `downloadAssets` → `printReadyAssetsPrepared` → `allocateProductionLocation` →
`inProduction` → `shipping`. Failures arrive in `issues[]` with codes like
`order.items.assets.NotDownloaded`.

Assets must be a **publicly downloadable URL**. Supabase **signed URLs qualify** — the URL only has
to work at fetch time, so print masters never need to be public. `sizing` is `fillPrintArea`
(centre-crop, default), `fitPrintArea` (letterbox) or `stretchToPrintArea` (distorts — never).

---

## 2. Verified behaviour — three findings that change the build

### 2.1 WebP is silently rejected. This is the big one.

I placed two identical sandbox orders, same SKU, same everything, differing only in image format:

| Asset | Result |
|---|---|
| JPEG | `downloadAssets: Complete`, `printReadyAssetsPrepared: Complete` — **inside 15 seconds** |
| **WebP** (a real gallery image from your Supabase bucket) | **`downloadAssets: InProgress` after 4½ minutes. No error. No `issues[]`. It just never finishes.** |

The docs say PNG/JPEG/PDF; they don't say what happens otherwise. Now we know: it hangs, silently,
with a completely healthy-looking order. That's worse than an error — nothing alerts, nothing
retries, the customer waits, and you'd only find out when they emailed you.

**Consequence:** every print master must be **JPEG**. Your entire library is WebP, so this is a hard
constraint on the pipeline, not a detail. I'll also add a format guard that refuses to submit a
non-JPEG asset, plus a stall alarm if `downloadAssets` hasn't completed in ~10 minutes.

### 2.2 The cancellation window is about a minute

I tried to cancel both test orders roughly five minutes after placing them. Both returned
`ActionNotAvailable` — once `printReadyAssetsPrepared` completes, the API will not cancel.

**Consequence:** if we submit to Prodigi the instant Stripe confirms payment, you have effectively
**no** window to handle "sorry, wrong size / wrong address / please cancel." Every such request
becomes a manual reprint at your cost.

**Recommendation: hold orders for 30–60 minutes before submitting.** A queued job, not an instant
webhook submit. Customers get a "you can change or cancel until 3:45pm" line in the confirmation
email, and you get a buffer to catch address typos. Costs nothing, prevents the most common and most
annoying class of loss. There's a "submit now" button in admin for anyone in a hurry.

### 2.3 Extra prints in one order cost ~$5 shipping, not $15

Classic frame A3, natural, to Sydney:

| Basket | Items | Shipping | Total |
|---|---|---|---|
| 1 print | $60.00 | $15.10 | **$75.10** |
| 2 prints | $120.00 | $20.10 | **$140.10** |
| 3 prints | $180.00 | $25.10 | **$205.10** |

The first print carries $15.10; each additional one adds **$5.00**.

**Consequence:** multi-print baskets are disproportionately profitable, and "free shipping on 2+
prints" costs you almost nothing while being a genuinely strong nudge. Worth building the shop
around — a "pairs well with" row on the product page earns its place financially, not just visually.

---

## 3. The catalogue — A-sizes exist (correcting my first pass)

My earlier draft, working from the docs and Prodigi's own support articles, said there were no
A-size framed SKUs and that A3 had to be approximated with `GLOBAL-CFPM-16x20`. **That's wrong.**
The API has proper A-sizes across every framed range:

`GLOBAL-CFP-A5|A4|A3|A2|A1` · `GLOBAL-CFPM-…` · `GLOBAL-BOX-…` · `GLOBAL-BOXM-…`

All 108 framed SKUs I probed ship to Australia and are **fulfilled from an Australian lab via
Australia Post**. So you can sell A1–A3 by name, exactly as you wanted.

**Ranges:** `CFP` classic · `CFPM` classic mounted · `BOX` box frame · `BOXM` box mounted ·
`BFP` budget poster (skip — thinner, and two sizes don't even ship to AU).
**Frame colours, all 8 on every classic/box SKU:** black, brown, dark grey, gold, light grey,
**natural**, silver, white. **Glaze:** acrylic/perspex. **Mount:** 2.4mm, snow white.
**Paper:** EMA 200gsm fine art (giclée).

### Landed cost to Sydney, one print, Standard (real API quotes, AUD)

| SKU | Print area (px) | = MP | Window ratio | Item | Ship | **Landed** |
|---|---|---|---|---|---|---|
| `GLOBAL-CFP-A4` | 2490×3510 | 8.7 | 1.414 | 42 | 15.10 | **57.10** |
| `GLOBAL-CFPM-A4` | 1594×2622 | 4.2 | 1.645 | 42 | 15.10 | **57.10** |
| `GLOBAL-CFP-A3` | 3507×4960 | 17.4 | 1.414 | 60 | 15.10 | **75.10** |
| `GLOBAL-CFPM-A3` | 2385×3825 | 9.1 | 1.604 | 62 | 15.10 | **77.10** |
| `GLOBAL-CFP-A2` | 4960×7015 | 34.8 | 1.414 | 80 | 15.10 | **95.10** |
| `GLOBAL-CFPM-A2` | 3780×5835 | 22.1 | 1.544 | 95 | 15.10 | **110.10** |
| `GLOBAL-CFP-A1` | 7020×9930 | 69.7 | 1.415 | 115 | 21.55 | **136.55** |
| `GLOBAL-CFPM-A1` | 5895×8805 | 51.9 | 1.494 | 140 | 21.55 | **161.55** |

Full 108-SKU list with prices is in the CSV. Two catalogue quirks worth avoiding: `GLOBAL-BOX-A2`
demands a **139 MP** asset (9921×14031) and `GLOBAL-BOX-A3` demands 69.6 MP — wildly out of step
with everything else. Steer clear of Box frames at A-sizes.

### The mount changes the geometry, in your favour

Look at the window-ratio column. Unmounted frames are a true A ratio (**1.414**). Mounted windows are
**1.494 (A1) / 1.544 (A2) / 1.604 (A3)** — much closer to **3:2 = 1.5**, the native ratio of most
drone stills.

That's two advantages at once, and it inverts my earlier advice about A-sizes cropping your work:

1. **A mounted A1 crops a 3:2 frame almost not at all** (1.494 vs 1.500). Mounted A2 is close behind.
2. **Mounted needs far less resolution** because the window is smaller: mounted A2 wants 22 MP where
   unmounted wants 34.8; mounted A1 wants 51.9 where unmounted wants 69.7.

So the mount isn't just the gallery look — it's the size tier you can actually service, and the crop
you don't have to apologise for.

---

## 4. Resolution — the real ceiling

Prodigi wants 300 dpi and allows 150 for work without fine detail. Coastal and aerial is *all* fine
detail, so treat 300 as the target and ~200 as the floor.

Against the **actual** print areas above, from a typical original:

| Original | Mounted A3 (9.1 MP) | Mounted A2 (22.1 MP) | Mounted A1 (51.9 MP) |
|---|---|---|---|
| 20 MP (5280×3956) | comfortable | ~285 dpi — fine | ~185 dpi — marginal |
| 48 MP (8064×6048) | comfortable | comfortable | ~285 dpi — fine |

**Recommendation: launch mounted A4/A3/A2, and gate A1 on the individual file.** Not a blanket rule —
a per-photo check, because your 48 MP frames can carry A1 and your 20 MP ones can't.

**Two things to make this automatic:**
- **The size picker disables sizes a given photo can't carry.** A few lines of code, and it prevents
  the one complaint that really damages a print business: a soft A1 that someone paid $300 for.
- We compute it on master upload from the real pixel dimensions — no manual bookkeeping.

**Your drive wasn't connected when I checked** (`/Volumes/SamD2` absent), so I couldn't measure your
actual originals. Plug it in and I'll produce a per-photo max-size table for everything in the shop.

And, plainly: **the gallery WebPs are useless for print** — capped at 2400px, about A4 at 200 dpi, and
the wrong format entirely per §2.1.

---

## 5. Your image question — Supabase images vs. the full-res file on disk

> *can I use the website supabase images to inject into the product, and I then upload the full size
> image from my disk to complete fulfilment during early development?*

Yes, and the split is right — just make it explicit so it can't go wrong:

- **Display asset** = existing gallery WebP. Shop grid, frame mockup, cart, confirmation email.
  Public, already there, already fast.
- **Print asset** = full-res **JPEG** derived from the original on `/Volumes/SamD2`. Private bucket.
  Handed to Prodigi only as a short-lived signed URL.

They're already linked: every photo row carries `source_path` pointing at its original, so the admin
screen can name the exact file to grab — no hunting.

**Phase 1 — manual, as you described.** Order paid → appears in `/admin` as "needs print master" →
you drag in the original → server converts to JPEG, records true pixel dimensions, stores it private
→ you press "Send to Prodigi" → signed URL minted, order created. You eyeball every order.

**Phase 2 — automatic.** Same submit runs from the queued job with no human in it.

**But there's a better version of Phase 1, and I'd push for it:** upload the print master **when you
add a photo to the shop**, not when an order arrives. The `in_shop` set is small and curated. That way:

- you're at your desk with the drive plugged in, not scrambling because someone bought on a Sunday;
- we read true pixel dimensions on upload and auto-derive that photo's sellable sizes (§4);
- the JPEG conversion (§2.1) happens once, up front, instead of under time pressure;
- orders are hands-off from day one, with a manual override kept for one-offs and custom sizes.

Same amount of your time, moved somewhere convenient, and it removes the failure mode where a paid
order sits waiting on you.

**Security:** `print-masters` is a private bucket, no anon policy, service-role only — same posture as
`integration_secrets`. Signed URLs minted server-side, never in the browser. `PRODIGI_API_KEY` is a
plain env var, **never** a `VITE_` one.

---

## 6. Decisions only you can make

1. **Range.** Recommendation: **Classic Mounted (`GLOBAL-CFPM`)** — best resolution economics, best
   ratio fit for 3:2, and the mount reads as gallery-quality.
2. **Frame colours.** Recommendation: **Natural** and **Black** only. Every extra colour multiplies
   mockups and decision fatigue.
3. **Sizes.** Recommendation: A4/A3/A2 for everything, A1 where the file supports it.
4. **Price.** Costs are now known (§3). Framed POD art typically runs 2.2–3× landed: an A2 at $110.10
   landed suggests roughly $260–$330 retail.
5. **Shipping policy.** Given §2.3 — free shipping on 2+ prints is nearly free to you.
6. **Editions.** Open, or numbered/limited? Limited justifies a much higher price but is a promise you
   keep forever. Prodigi supports a branded insert, so a signed certificate is achievable.
7. **International.** Verified working and locally fulfilled — see §7.
8. **GST / ABN.** Registration required above $75k turnover; optional below, with arguments both ways.
   Worth ten minutes with your accountant — I'm not the right source for that call, but checkout needs
   the answer before go-live.

---

## 7. International — verified, and better than expected

Same A3 classic, natural, quoted to four countries:

| To | Item | Ship | Fulfilled in | Carrier |
|---|---|---|---|---|
| Australia | $60.00 | $15.10 | **AU** | Australia Post |
| United States | $62.44 | $36.75 | **US** | UPS |
| United Kingdom | $61.08 | $20.52 | **GB** | DPD Local |
| Italy | $58.95 | $22.84 | **NL** | Spring |

Every destination is produced locally — nothing crosses a border, so no customs, no duty surprises,
no three-week transits. Item cost barely moves. Only US shipping is notably expensive.

**Selling worldwide is genuinely viable from day one**, which matters given half your catalogue is
European work that will find European buyers.

---

## 8. Your setup checklist

Things needing your login or your money. **Note item 3 is already done** — I pulled the full price
list from the API, so you can skip the dashboard export.

1. ~~Get the sandbox key~~ — done, and everything above is built on it.
2. **Set merchant currency to AUD** in dashboard settings. Quotes returned AUD when asked explicitly,
   but the default should match so nothing silently arrives in GBP.
3. ~~Pull real pricing~~ — **done**, see the CSV.
4. **Order 2–3 physical samples** through the dashboard's manual order form, on your own card. Don't
   skip this. It tells you whether *Natural* actually reads as oak, whether the mount is right, and
   how the crop lands — and it gives you real photographs of a real framed print, which will sell
   better than any CSS mockup. Recommend: mounted A3 and mounted A2, natural, one portrait one
   landscape.
5. **Plug in `/Volumes/SamD2`** so I can measure your originals and build the per-photo size table.
6. **Live API key** — hold it back until we're ready to switch on.
7. **Set the global callback URL** once I've deployed the endpoint.
8. **Stripe account** in AUD + webhook signing secret.
9. **Run one SQL migration** in the Supabase SQL editor (I write it, you paste it — the usual drill).
10. **Vercel env vars:** `PRODIGI_API_KEY`, `PRODIGI_ENV`, `STRIPE_SECRET_KEY`,
    `STRIPE_WEBHOOK_SECRET`, `ORDER_ALERT_EMAIL`.

---

## 9. What I build

**Supabase** (one migration): `print_products` (sku, label, size, window ratio, min pixels, base cost,
retail AUD) seeded straight from the JSON in this folder · `print_masters` (photo_id → private path,
true pixel dims, derived max size) · `orders` / `order_items` (with `prodigi_order_id`, stage,
tracking, `submit_after` for the §2.2 hold). RLS: anon reads the catalogue and nothing else;
order tables are service-role only.

**Serverless functions** (`api/`, alongside `instagram-sync.mjs`): `quote.mjs` (live shipping at
checkout) · `checkout.mjs` (Stripe session) · `stripe-webhook.mjs` (payment → queue order) ·
`submit-orders.mjs` (cron; submits held orders, JPEG guard, idempotency key) ·
`prodigi-callback.mjs` (stage/shipment → update order, email customer) · a stall alarm for §2.1.

**Shop UI:** real size + frame pickers driven by the catalogue (replacing the placeholder
`SHOP_SIZES` in `App.tsx`), crop preview, per-photo size gating, cart, Stripe checkout, order-status
page, orders view in `/admin`.

**Mockups.** Prodigi has no mockup-image API and you don't need one: `src/components/OakFrame.tsx`
already renders a photo in a frame in CSS. Extending it per frame colour and mount beats static
mockups, because it works for every photo automatically — including ones you add next year. No
template files to maintain.

---

## 10. Can Cowork help?

- **All the code, data and copy: yes.** Migration, functions, catalogue seed, shop UI, frame mockups,
  product descriptions.
- **Live API work: yes — demonstrated above.** Catalogue pulled, 108 SKUs priced, orders placed
  end-to-end, failure modes found. Same applies to the live key when you're ready.
- **Your Prodigi dashboard: partly.** I can drive Chrome to read the dashboard — you sign in, I read.
  I won't place live orders or handle payment details.
- **The caveat:** "creating products/templates in Prodigi" isn't a thing that exists to be automated
  (§0). The real equivalent is our catalogue table and the frame mockups, both of which I build.

---

## 11. Sequence

1. **You:** order samples (§8.4), plug in the drive (§8.5), pick range/colours/sizes (§6.1–6.3)
2. **Me:** migration + private bucket + master upload with JPEG conversion and size derivation
3. **You:** run the SQL, upload masters for the shop set
4. **Me:** quotes → Stripe checkout → held-order queue → Prodigi submit → callbacks, proven end to end
5. **You:** set retail prices against the real costs; samples confirm the finish
6. Live keys, flip `shop_public`, place one real order to yourself before announcing it

The site is further along than it looks — `/shop`, the curation flow, `in_shop`, the oak mockups and
the visibility flag all exist. What's missing is the catalogue, the money, and the print pipeline.

---

### Sources
- [Prodigi Print API reference](https://www.prodigi.com/print-api/docs/reference/) · [Postman collection](https://postman.prodigi.com/)
- [Classic framed prints](https://www.prodigi.com/products/wall-art/framed-prints/classic-frames/) · [Framed prints](https://www.prodigi.com/products/framed-prints/) · [AU-fulfilled products](https://www.prodigi.com/products/au/)
- [Global print network](https://www.prodigi.com/global-print-network/) · [Finding your API keys](https://help.prodigi.com/support/solutions/articles/35000138853-how-do-i-find-my-api-keys-)
- [Best resolution for image files](https://support.prodigi.com/hc/en-us/articles/13156599656604-What-is-the-best-resolution-for-image-files) · [About the frames](https://support.prodigi.com/hc/en-us/articles/13137070879772-Can-you-tell-me-more-about-your-frames)
- Everything in §2, §3 and §7 was measured directly against `api.sandbox.prodigi.com` on 2026-08-05.
