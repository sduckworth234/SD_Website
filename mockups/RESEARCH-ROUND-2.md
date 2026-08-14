# Creative tooling and concept round 2

Research date: 14 August 2026

This is a selective stack, not a recommendation to install every design skill.
Overlapping skills often pull a project toward contradictory visual systems. The
useful pattern is one skill per stage: direction, implementation, detail review,
quality review, then growth.

## Recommended skill stack

### 1. Direction: Anthropic Frontend Design

Source: [anthropics/claude-code — frontend-design](https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design)

Use it at the start of a concept round. Its main value is forcing a deliberate
aesthetic position before code: typography, palette, composition and motion
should express one idea rather than converge on a generic portfolio template.

Best use here: ask for three sharply different treatments of one specific
surface, such as the gallery archive or print shop. Do not let it redesign the
whole product in every pass.

### 2. Implementation: OpenAI Frontend App Builder

Source: [openai/plugins — frontend-app-builder](https://github.com/openai/plugins/tree/main/plugins/build-web-apps/skills/frontend-app-builder)

This is the strongest design-to-implementation workflow found in the official
Codex ecosystem. It treats the accepted visual concept as a specification,
extracts a design system, and uses browser comparison to push implementation
toward visual fidelity.

Best use here: after choosing one of the mockups, convert only that concept into
the existing React/Vite architecture while preserving Supabase, routes and the
admin surface.

### 3. Detail pass: Make Interfaces Feel Better

Source: [jakubkrehel/make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better)

This community skill focuses on the last ten percent: optical alignment, type,
hit areas, icon treatment, shadows, hover states, motion and performance. It is
more useful as a reviewer than as the primary art director.

Best use here: run its `quick` review on a mockup before selection, then a `full`
review on the implemented page.

### 4. Quality gate: Vercel Agent Skills

Source: [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills)

Install selectively:

- `web-design-guidelines` for accessibility, focus, animation, typography,
  images, touch behavior and theming.
- `react-best-practices` for waterfalls, bundle size and rendering performance.
- `vercel-optimize` only when production metrics justify a performance pass.

Best use here: make this the unemotional final gate after the creative work. It
should catch problems, not choose the visual direction.

### 5. Audience and discovery: Marketing Skills

Source: [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)

The full collection is broad. The useful subset for a photography portfolio is:

- `site-architecture`
- `seo-audit`
- `copywriting`
- `schema-markup`
- `analytics-tracking`
- `content-strategy`

Best use here: build discoverable location and collection pages, improve print
shop language, and define what should be measured. Avoid CRO tactics that make a
fine-art portfolio feel like a generic ecommerce funnel.

### Optional exploration tools

- [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill): useful for generating palettes, type pairings and broad design-system options. Treat its output as a searchable reference, not taste by consensus.
- [connerkward/ckw-design-skill](https://github.com/connerkward/ckw-design-skill): a more opinionated visual-direction system. Worth testing in a separate concept branch; likely overlaps with Anthropic Frontend Design.
- [vercel-labs/skills](https://github.com/vercel-labs/skills): cross-agent installer for using the same Agent Skills with Claude Code and Codex. Review every skill before installation and prefer project-local installation for reproducibility.
- [wilwaldon/Claude-Code-Frontend-Design-Toolkit](https://github.com/wilwaldon/Claude-Code-Frontend-Design-Toolkit): a useful catalogue of design, motion, browser and documentation tools. Use it for discovery, then inspect the original repository for each recommendation.

## Suggested workflow

1. Use one direction skill to generate bounded concepts for a single surface.
2. Select a concept based on the photography and business goal, not novelty.
3. Use an implementation skill to translate the accepted concept faithfully.
4. Run the detail skill to improve feel without changing the concept.
5. Run Vercel's quality skills for accessibility and performance.
6. Use the marketing subset for page structure, search discovery and measurement.

## New concept directions

### 06 Correspondence: Near / Far

Pair Northern Beaches and European images by visual rhyme: colour, coastline,
human scale, wakes, paths and geometry. This turns a geographically organised
archive into authored photo essays.

Potential product features:

- Admin-curated diptychs with a short connecting sentence.
- A recurring “Near / Far” homepage story.
- Shareable pair URLs and paired print editions.
- Automatic candidate suggestions based on dominant colour or image embeddings,
  with Sam making the final editorial choice.

### 07 Light Table

A dense but calm contact sheet for discovery. The visitor can alter density,
filter the archive, and inspect metadata without losing spatial context.

Potential product features:

- Saved selections for print enquiries.
- Keyboard navigation and compare mode.
- Filters for altitude, year, orientation and collection.
- An admin curation mode using the same interface.

### 08 Editions Room

A print-first shop where visitors choose a work, frame, wall and scale inside a
quiet room preview. It makes size and material decisions tangible before price
or checkout dominates the experience.

Potential product features:

- Real Prodigi frame finishes and print dimensions.
- Accurate relative scale using a familiar room object.
- Shareable room configurations.
- A later camera-based wall preview, only if the simpler room experience proves
  useful first.

## Further ideas worth prototyping

- **The Tide Edit:** seasonal or monthly sets that make the archive feel alive
  without pretending every visit needs new photographs.
- **Flight Notes:** selected aerial images with altitude, heading and a concise
  account of the conditions or decision behind the frame.
- **Collector's View:** a distraction-free shortlist where visitors compare up
  to four prints, sizes and frame finishes side by side.
- **Visual Neighbours:** after opening a photograph, show three related works
  chosen by colour, geometry or atmosphere rather than location.
- **Exhibitions:** finite, sequenced online shows with an opening text, 10–20
  images and a closing print edition. This gives Collections a stronger authored
  form without replacing the archive.

