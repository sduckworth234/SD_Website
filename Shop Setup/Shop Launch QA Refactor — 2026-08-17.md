# Shop launch QA refactor — 17 August 2026

This records the full public-site and commerce refactor completed before the
manual-fulfilment shop launch. It is the durable companion to the account setup
checklist in `Shop Checkout — Setup Handoff.md`.

## Outcome

- The shop now behaves as a curated exhibition rather than a complete catalogue.
  Its public landing page shows the first 15 sale-enabled photographs in the exact
  order chosen in Admin, while the full sale-enabled collection remains discoverable
  through Galleries, direct product URLs and the sitemap.
- The primary discovery journey is now **Galleries → photograph → Order a print →
  product studio → cart → checkout → confirmation**.
- The shop remains Australia-only, manual fulfilment remains the safe launch mode,
  and Prodigi can be enabled later without changing old orders.
- Public wording contains no “coming soon” state. Admin access is available at
  `/admin` and discreetly through the photography credit in the footer.

## Experience changes

### Home, navigation and loading

- Removed all “coming soon” shop language and updated the framed-editions ticker.
- Added concise, non-promotional About copy covering ten years of photography,
  aerial print work, commercial projects and photography as a continuing hobby.
- Removed the visible admin icon from the public header.
- Added a responsive mobile navigation panel with 44-pixel minimum controls,
  correct inert state, Escape behaviour and accessibility labels.
- Added a reusable animated handwritten SD loading mark for route, shop and map
  loading states.

### Galleries

- Every currently published photograph is enabled for print ordering. Removed the
  repeated “Available as a print” tile badge so the archive remains visually quiet;
  the lightbox keeps the clear **Order a print** action.
- Kept the Admin sale-eligibility switch as a future safety control. Print sizes and
  mounted/unmounted options remain constrained per photograph by source resolution,
  and missing or unrecognised sizing data fails closed in both the public selector
  and server-validated checkout.
- Limited initial rendering to 24 photographs on mobile and 36 on desktop, followed
  by a progressive **Show more** action. This reduces initial image and DOM work.
- Reduced background image pre-warming to a small representative set.
- Added measurement to print-product links from Galleries and Map.

### Shop landing

- Added a gallery-first hero, selected-editions secondary action and concise
  Australia-wide delivery trust strip.
- Added the three-step expandable explainer: choose a photograph, preview size and
  frame, then have it printed and delivered from Australia.
- Added a rotating studio scene for portrait and landscape photographs. It is a
  general presentation preview rather than a promise of one particular print size,
  and supports manual selection, pause and reduced-motion preferences.
- Replaced the repetitive catalogue grid with an editorial 12-column selection and
  strong return path to Galleries.

### Product, cart and checkout

- Product pages now explain tracked Australia-wide delivery, combined-print shipping
  and the usual 2–3-business-day dispatch expectation. Customer-facing SKU and
  paper-weight implementation detail were removed.
- Similar images are relevance-ranked and capped at ten, with repeated shipping
  arithmetic removed.
- Product size persists when changing to another photograph where that size is valid.
- Cart is a correctly labelled modal dialog with inert hidden state, Escape close,
  focus entry/restoration and consistent close wording.
- Checkout has a compact mobile order summary, stable Stripe loading/retry treatment,
  policy links and neutral 45-minute stock/price reservation wording.
- Confirmation explains next steps, supplies support and Instagram links, and offers
  clear paths back to the shop and Galleries.

### Follow-up commerce polish

- Centred the public gallery footer on desktop and mobile.
- Tightened the How it works → Studio spacing and changed the studio to a
  continuously looping directional carousel with previous, next, direct selection
  and pause/play controls. The automatic rotation alternates eligible portrait
  and landscape works, resizing the wall frame and labelling the orientation so
  the preview does not imply that editions are vertical-only.
- Replaced the irregular mixed-orientation edition mosaic with a horizontal salon
  rail. Portrait and landscape works share a controlled display height, use their
  natural widths and alternate automatically while preserving each orientation's
  relative admin order. The rail supports touch, trackpad and explicit arrow controls.
- Replaced mail-app-only print questions with an in-page Resend contact form. It
  includes required field validation, same-origin enforcement, honeypot and rate-limit
  spam protection, clear success/failure states and a mailto fallback.
- Added independent Admin → Shop ordered pickers for **Studio rotation** (6) and
  **Considered Collection** (15). They are presentation-only subsets of the
  published, sellable catalogue and never alter sale eligibility.
- Moved the homepage's overlapping Framed Editions pair out of the Homepage image
  controls and to the top of Admin → Shop Presentation. The portrait foreground and
  landscape background now have their own Automatic/Locked mode and cannot be
  changed by Studio, Considered Collection or the shop landing's first two images.
- Made the curator suitable for a 600+ photo archive with title/location search,
  location and orientation filters, 60-result progressive loading, transformed
  thumbnails and a compact ordered selection queue with move/remove controls.
- Matched the visible vertical height of landscape and portrait oak frames in the
  Considered Collection on desktop and mobile without page-level overflow.
- Added a prominent but secondary **Canvas & glass** notice to every product
  configurator. Both finishes are described as available now by direct enquiry and
  coming to online ordering soon, without implying that the current cart can price
  or fulfil them.
- Added an accessible **See finishes** dialog with material mockups using the exact
  Manly 2023 aerial (83.1 m; −33.797, 151.290), clear material-reference wording,
  per-photograph size caveats and a direct Resend-backed enquiry path. The canvas
  preview uses the photograph rotated 90° anticlockwise on a modest portrait
  A3–A2-scale gallery wrap leaning against a wall; the glass preview demonstrates a
  restrained frameless wall finish.
- Automatic storefront mode now draws a fresh balanced portrait/landscape sample on
  each visit, allowing the full sellable archive to cycle over time. Any explicitly
  curated Studio or Considered selection remains fixed until an admin changes it.
- Simplified the active gallery scope from “Showing …” to the collection/place path
  and made the minimal **Clear selection ×** action visually unambiguous.
- Added an expandable manual-workflow guide inside Admin → Shop Orders describing
  Start fulfilment, Mark shipped, Refund and Receipt at the point of use.

## Policies and search presentation

The following customer-facing routes are live and linked from the shop, product,
cart and checkout surfaces:

- `/shop/policies/shipping`
- `/shop/policies/returns`
- `/shop/policies/privacy`
- `/shop/policies/terms`

They document Australia-only delivery, made-to-order returns, damage handling,
the 45-minute cancellation window, privacy/payment handling and Australian Consumer
Law rights. They are operational copy, not a substitute for professional legal advice.

Every product now has a unique canonical URL, product Open Graph type and JSON-LD
Product/Offer data. Checkout, confirmation and not-found views are no-indexed. A
server-generated `/sitemap.xml` includes core pages, policy pages, visible gallery
locations and all currently sale-enabled product URLs.

## GA4 measurement

Automatic GA page views are disabled in the inline Google tag and replaced by SPA
route-aware page views to prevent duplicate counts. Commerce remains independent of
analytics: every helper safely does nothing if analytics is blocked or unavailable.

Events implemented:

| Journey point | GA4 event |
| --- | --- |
| SPA route changes | `page_view` |
| Product opens | `view_item` |
| Shop/similar/gallery product selection | `select_item`, `product_link_clicked` |
| Added to cart | `add_to_cart` |
| Cart opens | `view_cart` |
| Checkout starts | `begin_checkout` |
| Customer proceeds to payment | `add_shipping_info` |
| Confirmed paid order | `purchase` |
| Studio/detail tab changes | `product_view_changed` |
| Size guidance opens | `size_guide_opened` |
| Contact form opens | `contact_form_opened` |
| Contact form succeeds | `contact_form_submitted` |

## Verification completed

- Production TypeScript/Vite build: passed.
- Dependency audit at high severity: zero vulnerabilities.
- Diff whitespace validation: passed.
- Desktop shop at 1440 pixels: curated 15-image layout, studio, explainer and no
  horizontal overflow verified.
- Mobile at 390 × 844: shop, menu, Galleries, product, policy and checkout layouts
  verified; touch targets and collapsed order summary checked.
- Galleries: 24 initial mobile tiles and progressive load control verified.
- Product: unique canonical, Product Open Graph and Product JSON-LD verified.
- Checkout: no payment submitted during this refactor; loading and pre-payment flow
  only were exercised.
- Browser console: no application errors. Local Stripe's expected non-HTTPS warning
  and local-only Vercel analytics script absence are not production failures.
- Local Lighthouse after the refactor: Shop performance 75 / accessibility 100 /
  SEO 100; Product performance 74 / accessibility 100 / SEO 100. Remaining large
  Map and admin-only HEIC chunks are
  deferred and do not block the shop launch.

## Final owner checks

After the production deployment:

1. Confirm GA4 Realtime receives a page view, product view, add-to-cart and checkout
   start without duplicates.
2. Place one deliberately low-value live order and verify Stripe payment, signed
   webhook, Admin → Shop Orders, customer Resend email and owner Resend email.
3. Test a decline and a 3DS challenge in Stripe test mode if they have not yet been
   captured as evidence.
4. Upload one JPEG master and complete the manual dispatch/tracking flow.
5. Keep `SHOP_FULFILMENT_PROVIDER=manual` until the separate Prodigi sandbox,
   callback and physical print proofs pass.

## Customer-facing voice

- Direct enquiries, help text and contact confirmations use first person (`me` /
  `I`) so the customer is clearly speaking with the photographer.
- Third person remains only where it serves a professional purpose: the Sam
  Duckworth Photography brand, photography credits, SEO attribution, copyright,
  legal policies and transactional email identity.
- The Admin-managed live contact heading and introduction were updated alongside
  the source defaults so production does not retain the superseded copy.

## Studio mockups and real-print proof

- The shop Studio carries a discreet information disclosure: room scenes are
  mockups and the delivered scale, colour, frame and finish may vary.
- Admin → Shop Presentation includes a bounded real-print gallery manager for up
  to 24 compressed photographs, accessible descriptions, captions, ordering and
  individual include/hide controls.
- The gallery has its own public switch and remains disabled by default. The
  “See real prints” action is rendered only when the switch is enabled and at
  least one included photograph exists.
- Assets use the existing admin-protected `photos/real-prints` storage path;
  ordered presentation metadata is stored in the public-safe
  `shop_real_print_gallery` setting. No secret or private order data is stored
  there.
