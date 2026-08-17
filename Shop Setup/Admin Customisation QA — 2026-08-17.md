# Admin Customisation QA — 17 August 2026

## Current conclusion

The admin is mature for photo, gallery and commerce operations and now has the first
structured CMS layer. It is organised by visitor page rather than database feature,
with high-priority displayed-image and public identity controls brought into the
same surfaces. It deliberately remains a structured editor rather than an unrestricted
page builder.

## Shop presentation controls delivered

- **Homepage Framed Editions hero** is now the first control in Shop Presentation.
  Its portrait foreground and landscape background are independent from Studio
  rotation, Considered Collection and catalogue order. Automatic mode follows the
  first eligible work of each orientation in shop order; Locked mode preserves the
  exact chosen pair. Choosing either frame locks the pair automatically.
- Existing `banner_portrait` and `banner_landscape` values remain a read-only legacy
  fallback, so the live pair survives deployment. New saves use the explicit
  `home_framed_hero_{mode,portrait,landscape}` settings.
- All 610 currently published photographs are enabled for sale. Public gallery tiles
  no longer repeat an availability badge; print discovery happens through the
  lightbox's **Order a print** action.
- **Available for sale** remains the full catalogue safety control, allowing a work
  to be withdrawn later without deleting it from the photography archive.
- Availability never bypasses production limits: each photograph's source resolution
  still controls its permitted sizes and mounted/unmounted combinations. Missing or
  unknown sizing metadata fails closed on the product page, and checkout independently
  revalidates the requested configuration on the server.
- **Studio rotation** is an ordered, presentation-only subset of up to 6 published,
  sellable portrait or landscape photographs.
- **Considered Collection** is an ordered, presentation-only subset of up to 15
  published, sellable photographs.
- Invalid, draft or no-longer-sellable saved IDs are filtered at render time.
- The public pencil is a quick non-destructive shortcut; Admin → Shop is the primary
  management surface.
- The picker supports 600+ photographs through search, filters, progressive batches,
  small image transforms and a compact selection queue.

The two ordered lists use the existing public-safe `site_settings` mechanism:
`shop_studio_photos` and `shop_considered_photos`. No secret or private operational
data is stored there.

## Full-site customisation roadmap

### Phase 1 delivered

- Admin navigation is now: Overview, Homepage, Galleries & Collections, Map &
  Locations, Shop Presentation, Products & Pricing, Orders, About & Contact, and
  Media Archive.
- Overview provides live archive/shop/location counts and page-based shortcuts.
- Homepage starts with the opening hero and a unified Recent Work manager, followed
  by section visibility, campaign/banner selections and map-promo curation.
- Recent Work supports two explicit modes: eight curated photographs selected and
  reordered in one archive picker, or an automatic eight-photo mix recalculated per
  visit. Automatic rules cover horizontal/vertical orientation, capture year,
  newest/oldest/random order and a one-to-three photograph maximum per place. The
  admin preview shows the resulting eight photographs before they reach visitors.
- The 600+ photo picker can be narrowed by capture year and print-sale status, then
  ordered by newest or oldest captured date. Candidate thumbnails show year and a
  visible Print marker alongside the existing search/location/orientation filters.
- Map & Locations supports creating locations, editing public name/region/description,
  ordering locations and choosing up to five homepage-card photographs per location.
  Display-name changes preserve existing slugs to protect shared URLs.
- Gallery tiles and map pins now open the same shared photo lightbox. Exact stored
  ratios choose the portrait or landscape card before the image loads, while
  metadata, gallery actions, responsive sources and close transitions stay aligned.
- Mobile navigation is complete and consistent across the main site, shop landing
  and print configurator: Home, Gallery, Map, About, Shop, Contact and Cart remain
  reachable, with viewport-safe scrolling, active-page state, Escape/backdrop close,
  body-scroll locking and direct About/Contact panel links.
- Mobile dropdown rows now occupy the full viewport width on the shop landing and
  print configurator instead of inheriting the narrow right-hand header-control
  width. Consistent 24-pixel side padding, full-width grid tracks and dedicated
  arrow spacing keep labels and navigation arrows comfortably separated even at
  a 320-pixel viewport.
- Photography, shop, product, checkout-policy and legal-page footers now use an
  explicit full-width centred layout. The photography footer stacks each item on
  the same centreline rather than merely centring a mixed-width horizontal group.
- The mobile journey now distinguishes the two spaces explicitly: shop menus group
  Photography and Print shop destinations, Framed Editions always means the shop,
  and gallery/policy/footer links provide a clear route back to the photography site.
  Checkout remains intentionally focused, while confirmation and error states offer
  both Framed Editions and Photography Gallery recovery actions.
- The opening homepage hero caption shows location only; the photograph title is
  reserved for galleries and lightboxes where it has clearer context.
- About & Contact edits typed business identity, public email/Instagram, homepage
  hero eyebrow, About portrait/copy, contact copy and footer label. The same record
  is used by the public footer, Instagram links, contact form, shop policy footer and
  checkout confirmation.
- The typed singleton is `public.site_content`, protected by RLS: anonymous/public
  read and verified-admin write. Explicit grants cover the 2026 Data API exposure
  change. Secrets and operational recipients remain server-side.
- Automatic shop presentation now uses a balanced random sample on each new visit;
  explicitly curated Studio and Considered selections remain stable.

The next safe CMS phase should organise Admin around public pages: Overview,
Homepage, Galleries & Collections, Map, Shop Presentation, Products & Pricing,
Orders, About & Contact, Global Content/SEO/Policies, and Media Archive.

Remaining priority work:

1. Add structured copy controls for remaining Homepage, gallery, map and shop-section
   headings while keeping transactional checkout templates constrained.
2. Add managed About/OG image upload through the Media Archive rather than a path field.
3. Add draft/preview/publish, revision history and rollback for long-form and legal
   content.
4. Offer a small set of tested layout presets rather than arbitrary CSS or a free-form
   page builder.

Do not expand the current anonymous-readable, untyped `site_settings.value` column
into an unrestricted CMS. Longer content should use typed tables with validation,
draft/published state, author history and rollback. Credentials and private recipient
configuration must remain server-side environment variables.
