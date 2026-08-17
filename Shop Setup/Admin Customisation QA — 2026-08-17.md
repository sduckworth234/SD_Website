# Admin Customisation QA — 17 August 2026

## Current conclusion

The admin is mature for photo, gallery and commerce operations, but it is not yet a
general-purpose CMS. Roughly half of visitor-facing content is editable today. The
shop presentation gap identified in this QA is now closed: sale eligibility, Studio
rotation and Considered Collection are three explicitly separate controls.

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

The next safe CMS phase should organise Admin around public pages: Overview,
Homepage, Galleries & Collections, Map, Shop Presentation, Products & Pricing,
Orders, About & Contact, Global Content/SEO/Policies, and Media Archive.

Priority work:

1. Add typed controls for business identity, public email/Instagram, About content,
   contact copy and footer content, removing duplicated constants.
2. Group every Homepage section in its actual visitor order, with visibility, copy,
   image selection and a preview link in each card.
3. Add full location metadata management and structured shop/content copy controls.
4. Add draft/preview/publish, revision history and rollback for long-form and legal
   content.
5. Offer a small set of tested layout presets rather than arbitrary CSS or a free-form
   page builder.

Do not expand the current anonymous-readable, untyped `site_settings.value` column
into an unrestricted CMS. Longer content should use typed tables with validation,
draft/published state, author history and rollback. Credentials and private recipient
configuration must remain server-side environment variables.
