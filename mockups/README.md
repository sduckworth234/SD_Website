# Design concepts — samduckworth.com

Five reimaginings of the site, built to be looked at side by side. **Nothing
here touches the live app** — separate folder, separate dev server, no imports
into `src/`.

## Run them

```bash
npx vite mockups --port 5199 --strictPort
```

Then open <http://localhost:5199/>. Every concept has a switcher pinned to the
bottom of the screen, so you can flick between them without going back.

There's also a `mockups` entry in `.claude/launch.json`, so the preview tooling
can start it by name.

## The five

| # | Concept | What it is |
|---|---------|------------|
| 01 | **Salt** | Today's paper-and-ink identity, evolved. Same warmth and Bebas voice, far more air. Full-bleed hero, oversized numbered place index that previews on hover, asymmetric editorial mosaic. The safest thing to ship. |
| 02 | **Darkroom** | The gallery at night. Near-black walls, no chrome competing with the work. Slow hero crossfade, floating plates, a filmstrip archive that develops from grey on hover. |
| 03 | **Atlas** | The flight log as the interface. Altitude, GPS and capture dates become the navigation — scrub the altitude ladder, read live telemetry, see every frame plotted at its true coordinates. |
| 04 | **Horizon** | One frame at a time, scroll as the shutter. Each place is a full-screen chapter; the photo parallaxes and the place name wipes in on a clip-path. Ends by dropping you into the whole archive. |
| 05 | **Prism** | WebGL. The hero is displaced by a flow field around the cursor, and switching place dissolves one photo into the next through that same field. Magnetic grid, custom cursor. Degrades to a plain image with no WebGL. |

## Data

All five run on your real catalogue. `photos.json` is a curated 149-frame subset
of the 589 published photos, pulled from Supabase with real titles, locations,
regions, aspect ratios, capture years, drone altitudes and GPS. Images are
served from the same Supabase transform CDN the live site uses, so the loading
behaviour is realistic.

To refresh it after new imports, re-run the export that produced it (see the
session notes) or edit `photos.json` directly — the shape is:

```json
{ "id": "...", "title": "...", "location": "...", "region": "...",
  "aspect": "landscape", "ratio": 1.7778, "alt": 86, "year": 2023,
  "lat": -33.65, "lon": 151.3, "path": "approved/2023/bayview/....webp" }
```

`mock.js` holds the shared helpers (`img()`, `srcset()`, `reveal()`, the
switcher). `switch.css` styles the switcher only.

## design-system/

`design-system/sam-duckworth-photography/MASTER.md` is the design system the
**ui-ux-pro-max** skill generated for a fine-art photography portfolio —
palette, type pairing, spacing scale, motion tier, anti-patterns, pre-delivery
checklist. It scored *Exaggerated Minimalism* + *Portfolio Grid* highest, which
is the backbone of 01 and 02. Concepts 03–05 deliberately push past it.

Note its palette is the generic monochrome-plus-blue it recommends for the
category — 01 keeps your warm paper instead, because that's your identity and
the database doesn't know about it.

## Accessibility / performance notes

- All five respect `prefers-reduced-motion` (parallax, marquee, crossfades and
  the reveal animations all stand down).
- No horizontal overflow at 375px on any page — verified.
- Images use `srcset`/`sizes` and `loading="lazy"` below the fold.
- Prism's WebGL path falls back to a static image if the context or a
  cross-origin texture read fails.
