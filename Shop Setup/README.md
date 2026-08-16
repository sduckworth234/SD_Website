# Shop setup documentation

This folder contains the operational handoff and the research that led to the
current checkout and fulfilment implementation.

## Current source of truth

- [Shop Checkout — Setup Handoff.md](./Shop%20Checkout%20%E2%80%94%20Setup%20Handoff.md) —
  purchase flow, environment gates, Supabase/Vercel/Stripe/Prodigi/Resend setup,
  local test procedure and launch proof.
- [Sample Order — Reproduce in Production.md](./Sample%20Order%20%E2%80%94%20Reproduce%20in%20Production.md) —
  physical sample-order reference and print-quality checklist.

The deployed schema is defined by
[`supabase/migrations/20260816000132_shop_checkout_fulfilment.sql`](../supabase/migrations/20260816000132_shop_checkout_fulfilment.sql).
Safe environment placeholders are in [`.env.example`](../.env.example).

## Historical research

- [Prodigi API — Investigation & Setup Plan.md](./Prodigi%20API%20%E2%80%94%20Investigation%20%26%20Setup%20Plan.md)
- [Stripe Checkout — Integration Plan.md](./Stripe%20Checkout%20%E2%80%94%20Integration%20Plan.md)
- The HTML mockups and catalogue exports in this folder are design/research
  artefacts, not deployment instructions.

The historical documents retain verified findings and rationale, but their
proposed file names, API shapes and “not built” sections have been superseded.
Do not implement from them without checking the handoff and current code.

## Deployment safety

The implementation is disabled unless explicitly enabled:

```dotenv
VITE_SHOP_ENABLED=false
SHOP_CHECKOUT_ENABLED=false
SHOP_FULFILMENT_ENABLED=false
```

The first gate removes the public shopping flow from the frontend build. The
second blocks new Stripe Checkout Sessions server-side. The third blocks Prodigi
submission. Supabase settings `shop_public` and `print_configurator` are an
additional admin-controlled public visibility gate.
