# Sample orders — reproduce in production

> **Current workflow (updated 2026-08-16):** the private `print-masters` bucket
> and automated submission path now exist. Upload originals through **Admin →
> Shop → Orders**; the application verifies JPEG type/resolution and gives Prodigi
> a short-lived signed URL. Use the normal Stripe test checkout for an end-to-end
> system test. The manual Prodigi dashboard route below remains useful only when
> isolating physical print/crop quality from checkout.

Two sandbox orders placed 2026-08-05 against `api.sandbox.prodigi.com`. Both reached
`printReadyAssetsPrepared: Complete` in **30 seconds** with no issues. Nothing was charged and
nothing will be printed.

| Ref | Sandbox id | SKU | Photo | Orientation |
|---|---|---|---|---|
| `SD-SAMPLE-A2-VERT` | `ord_1166106` | `GLOBAL-CFPM-A2` | Marina Piccola (Italy) | vertical / portrait |
| `SD-SAMPLE-A3-HORIZ` | `ord_1166107` | `GLOBAL-CFPM-A3` | At Anchor (Manly) | horizontal / landscape |

Both: Classic frame, **mounted**, **natural**, snow-white 2.4mm mount, acrylic glaze, EMA 200gsm,
`sizing: fillPrintArea`, 1 copy, Standard shipping to NSW 2000.

Landed cost if these were live: **A2 $110.10** + **A3 $77.10** in one order = **$187.20 AUD**
(shipping $15.10 for the first print, +$5.00 for the second).

---

## ⚠️ Three things that will bite you if you copy this literally

**1. Do not reuse my asset URLs.** They point at the gallery's 2400px render — fine for a sandbox
test, nowhere near enough to print. You need:

| SKU | Print area | Minimum file |
|---|---|---|
| `GLOBAL-CFPM-A3` | 2385 × 3825 | **9.1 MP** |
| `GLOBAL-CFPM-A2` | 3780 × 5835 | **22.1 MP** |

**2. JPEG only.** A WebP asset hangs Prodigi's downloader forever with no error (tested — see the
main plan doc, §2.1). Export the originals as JPEG, maximum quality, sRGB.

**3. Use the private print-master workflow.** The API needs a reachable asset URL,
but the JPEG does not need to be public. Upload the original in **Admin → Shop →
Orders**; it is stored in the private `print-masters` bucket and the fulfilment
endpoint creates a six-hour signed URL only when submitting to Prodigi.

For a complete system proof, purchase in Stripe test mode, replay the signed
webhook, upload the master, then allow/trigger Prodigi sandbox submission. For a
physical sample that deliberately bypasses checkout, the Prodigi dashboard manual
order form is still valid: choose the SKU below, upload from the Mac, set Natural,
and use your own address.

The payloads below remain a reference for checking that the generated/dashboard
order matches the intended product.

---

## What the crop will do

`fillPrintArea` centre-crops to fill. Prodigi **auto-rotates** the print area to match your image's
orientation, so a landscape file doesn't get forced into a portrait window — I confirmed this before
placing the orders.

With mounted A-size windows against your typical files:

| Order | Image ratio | Window ratio | Crop |
|---|---|---|---|
| A2 vertical | 1.778 (9:16) | 1.544 | **13.2% of height** — 6.6% off top and bottom |
| A3 horizontal | 1.778 (16:9) | 1.604 | **9.8% of width** — 4.9% off each side |

Not disastrous, but not nothing — check your two chosen frames have breathing room at the edges
before ordering. This is exactly what the physical samples are for: seeing whether a ~10% haircut
reads as "tighter crop" or "you cut my composition."

**Minor quirk:** on A3, *dark grey* and *light grey* have a slightly smaller window (2328 × 3780,
ratio 1.624) than the other six colours. Natural is the larger window, so this doesn't affect your
test — but the size gating I build will use the conservative number.

---

## Exact payloads (reference)

Swap `api.sandbox.prodigi.com` → `api.prodigi.com`, use your **live** key, replace the asset URL
and `line1`.

### A2 — vertical
```json
{
  "merchantReference": "SD-SAMPLE-A2-VERT",
  "shippingMethod": "Standard",
  "idempotencyKey": "<fresh-guid>",
  "recipient": {
    "name": "Sam Duckworth",
    "email": "<your email>",
    "address": {
      "line1": "<your street>",
      "townOrCity": "<suburb>",
      "stateOrCounty": "NSW",
      "postalOrZipCode": "<postcode>",
      "countryCode": "AU"
    }
  },
  "items": [{
    "merchantReference": "Marina Piccola",
    "sku": "GLOBAL-CFPM-A2",
    "copies": 1,
    "sizing": "fillPrintArea",
    "attributes": { "color": "natural" },
    "assets": [{ "printArea": "default", "url": "<public URL to a ≥22.1MP JPEG>" }]
  }]
}
```

### A3 — horizontal
Identical, with `"sku": "GLOBAL-CFPM-A3"` and a **≥9.1 MP** JPEG.

**To get both in one parcel** (and pay $5 shipping for the second rather than $15.10), put both
items in a single order's `items` array instead of placing two orders.

---

## What to judge when they arrive

1. Does **natural** read as oak next to the site's `OakFrame` mockups? If not, try *light grey* or
   *brown* — that decision drives all the product photography.
2. Is the snow-white mount the right width, and does it suit aerial work?
3. Print quality at A2 — this is the size most likely to sell and the one where resolution bites.
4. Whether the ~10% crop is acceptable, or whether we should offer `fitPrintArea` (letterboxed, full
   composition, white margin) as an option.
5. Packaging and condition on arrival — that's what your customers will judge you on.

Photograph both on a wall when they land. Real framed prints will sell better than any CSS mockup,
and they replace the placeholder imagery on `/shop`.
