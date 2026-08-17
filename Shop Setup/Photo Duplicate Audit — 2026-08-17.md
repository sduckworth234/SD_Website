# Photo Duplicate Audit — 17 August 2026

## Outcome

- Scanned all 628 photo records and all 628 stored catalogue images.
- Consolidated 35 confirmed duplicate families.
- Disabled 39 lesser records by setting both `is_published = false` and
  `in_shop = false`.
- Of those 39 records, 29 had been publicly published and 10 were already
  unpublished but still marked for the shop.
- No database rows or stored image files were deleted. Every decision remains
  reversible using the mapping below.
- Existing order references were checked before the update. Every photograph
  referenced by an order remains published and sellable.

After the pass, the catalogue contains 581 published/sellable photographs and
8 unpublished photographs still staged as future shop candidates.

## Method

Potential matches were generated from:

1. Stored-image perceptual similarity across the full catalogue.
2. Exact or related source filenames and storage paths.
3. RAW/master source paths and pixel dimensions.
4. Capture date, coordinates, location and aspect.
5. Existing order references, feature/map flags and curated page selections.

Reused filenames were not treated as proof. For example, the 2022 and 2026
Greece folders contain files with matching names but different photographs.
Likewise, closely spaced frames from different RAW files were retained.

When copies were consolidated, the retained record inherited the strongest
feature/map flags, earliest gallery/shop placement and missing Collection
membership from the disabled copy. Homepage and Shop setting references were
repointed where required.

## Retained record <- disabled copies

- Pink Hour <- Manly (`manly-f735d95778b6`)
- Magenta <- Manly (`manly-92189d87fcdf`)
- Paddling Out <- Turquoise
- The Headlands <- Manly (`manly-d2426a5ac864`), The Neck
- The Lagoon <- Afterglow
- The Point <- The Headland
- South Steyne (`sd-14-2d8d80016dce`) <- Manly (`dji-20231130060419-0011-d-9cb51f2e6fbc`)
- Ledge Above the Blue <- Sarakiniko (`sarakiniko-1785063267257`)
- The Pines <- Manly (`sd-16-dafe0880b054`)
- Marbled <- Mona Vale (`12-12-23-mona-for-web-3-4623006e312e`)
- The Outlook <- Mona Vale (`sd-07-564dd19a263b`)
- The Arc <- Mona Vale (`dji-20231201090236-0034-d-1ee0278cbc89`)
- Sarakiniko (`sarakiniko-1785033352625`) <- The Narrow Water
- The Hook <- Mona Vale (`sd-12-7b4760280723`)
- Tombolo <- Mona Vale (`sd-08-ed080a37e55f`)
- The Approach <- Mona Vale (`dji-20231201091115-0056-d-7d92ee0e425f`)
- Morning Gold <- Manly (`sd-15-8d01ecac1c04`)
- The Isthmus <- Mona Vale (`sd-06-e8b71e980b84`)
- Inkwell <- Mona Vale (`sd-03-cd37af7e25e6`)
- The Heights <- Mona Vale (`sd-10-68c9635cd6c8`)
- Clifftop <- Mona Vale (`dji-20231201085546-0020-d-dd27181dc0a6`)
- The Plunge <- Mona Vale (`sd-05-b921c49d4880`)
- The Reserve <- Headland Pool, The Platform, The Spit
- The Wharf <- Anchored
- The Groyne <- Mona Vale (`sd-11-cd069b153b3a`)
- Moorings <- Jetties
- Golden Cove <- Manly (`manly-7d624d3a28e2`)
- South Steyne (`south-steyne-1781062924085`) <- Early Shift
- The Swash <- The Swimmer, Manly (`print-60581b8e13ba`)
- Boat Harbour <- Manly (`manly-a388e9ab0dc8`)
- Gilded <- Sun Trail
- Blush <- Manly (`bower-de1ff734ad76`)
- Rockpool <- Breakers
- The Towers <- Fairlight
- Honeyed <- Manly (`unsorted-03acae9079c2`)

## Similar work deliberately retained

- Two landscape Ksamil pairs and one portrait Ksamil pair: consecutive but
  distinct RAW captures.
- The two Balgowlah Heights views: distinct RAW captures.
- Wharf Glow and the neighbouring Manly frame: distinct RAW captures.
- Surfline and The Swash: adjacent but different RAW captures.
- The Sweep and The Point: visibly different compositions; the shared RAW link
  appears to be a historical metadata match rather than proof of duplication.

