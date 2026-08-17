# Admin Customisation QA — 17 August 2026

## Current conclusion

The admin is mature for photo, gallery and commerce operations and now has the first
structured CMS layer. It is organised by visitor page rather than database feature,
with high-priority displayed-image and public identity controls brought into the
same surfaces. It deliberately remains a structured editor rather than an unrestricted
page builder.

## Shop presentation controls delivered

- **Available for sale** remains the full catalogue control.
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
- Homepage starts with the opening hero and eight exact Recent Work positions,
  followed by section visibility, campaign/banner selections and map-promo curation.
- Map & Locations supports creating locations, editing public name/region/description,
  ordering locations and choosing up to five homepage-card photographs per location.
  Display-name changes preserve existing slugs to protect shared URLs.
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
