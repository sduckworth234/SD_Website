// Client/server pricing parity check.
//
//   node scripts/pricing-parity.mjs          assert parity, exit non-zero on drift
//   node scripts/pricing-parity.mjs --table  also print the full price table
//
// The browser (src/lib/printCatalogue.ts) and checkout (server/shop/
// catalogue.mjs) each carry their own copy of the pricing formula and of the
// fallback constants, because they live on opposite sides of the TS/ESM
// boundary and cannot share a module. Two copies drift; on 2026-09-02 they had
// drifted so far that a customer was shown $175.17 and charged $134.09. This
// script imports BOTH and asserts they agree to the cent for every
// size x mount x colour x glazing x paper x framed combination, plus every
// shipping shape — so the drift is caught here instead of on a real order.
//
// Node strips the .ts types on import (v22.6+ with --experimental-strip-types,
// default from v23), which is why printCatalogue.ts is kept free of runtime
// imports and of React.
import * as client from "../src/lib/printCatalogue.ts";
import * as server from "../server/shop/catalogue.mjs";

const SIZES = ["A5", "A4", "A3", "A2", "A1"];
const COLOURS = ["natural", "black", "white"];
const GLAZING = ["clear", "non_reflective", "perspex", "uv_clear", "uv_non_reflective", "none"];
const PAPERS = ["semi_gloss", "high_gloss"];

const failures = [];
const check = (label, a, b) => { if (a !== b) failures.push(`${label}: client ${a} vs server ${b}`); };

// 1. The fallback constants themselves.
check("fallback marginPercent", client.FALLBACK_PRICING.marginPercent, server.FALLBACK_PRICING.marginPercent);
check(
  "fallback constants (deep)",
  JSON.stringify(client.FALLBACK_PRICING),
  JSON.stringify(server.FALLBACK_PRICING),
);

// 2. Every price point, under the fallback pricing both sides default to.
let combos = 0;
for (const size of SIZES) {
  for (const framed of [true, false]) {
    for (const mounted of framed ? [false, true] : [false]) {
      for (const colour of framed ? COLOURS : ["natural"]) {
        for (const glazing of framed ? GLAZING : ["clear"]) {
          for (const paper of PAPERS) {
            const spec = { size, mounted, colour, glazing, paper, framed };
            check(
              `price ${size} ${framed ? (mounted ? "mounted" : "unmounted") : "print-only"} ${colour}/${glazing}/${paper}`,
              client.priceCentsFor(spec),
              server.priceCentsFor(spec),
            );
            combos += 1;
          }
        }
      }
    }
  }
}

// 3. The rounding rule, spot-checked against the worked examples in the spec.
check("round 17617 -> 17900", client.roundToPricePoint(17617), 17900);
check("round 4833 -> 4900", client.roundToPricePoint(4833), 4900);
check("round rule mirrored", client.roundToPricePoint(17617), server.roundToPricePoint(17617));
check("round 0 -> 0", client.roundToPricePoint(0), 0);

// 4. Shipping, including mixed framed/rolled orders.
const shippingCases = [
  [{ size: "A3" }],
  [{ size: "A3" }, { size: "A3" }],
  [{ size: "A1" }],
  [{ size: "A1" }, { size: "A1" }],
  [{ size: "A1" }, { size: "A3" }, { size: "A5" }],
  [{ size: "A3", framed: false }],
  [{ size: "A1", framed: false }],
  [{ size: "A3", framed: false }, { size: "A2", framed: false }, { size: "A5", framed: false }],
  [{ size: "A2" }, { size: "A3", framed: false }],
];
for (const items of shippingCases) {
  check(
    `shipping ${JSON.stringify(items)}`,
    client.estimateShippingCents(items),
    server.estimateShippingCents(items),
  );
}

// 5. SKUs.
for (const size of SIZES) {
  for (const [mounted, framed] of [[false, true], [true, true], [false, false]]) {
    check(`sku ${size} ${mounted}/${framed}`, client.skuFor(size, mounted, framed), server.skuFor(size, mounted, framed));
  }
}

if (process.argv.includes("--table")) {
  const d = (cents) => `$${(cents / 100).toFixed(2)}`;
  const rows = [];
  for (const size of SIZES) {
    rows.push({
      config: `${size} print only`,
      cost: d(client.productCostCentsFor({ size, mounted: false, framed: false })),
      sell: d(client.priceCentsFor({ size, mounted: false, framed: false })),
    });
  }
  for (const size of SIZES) {
    for (const mounted of [false, true]) {
      for (const colour of COLOURS) {
        const spec = { size, mounted, colour, glazing: "clear", paper: "semi_gloss", framed: true };
        rows.push({
          config: `${size} ${mounted ? "mounted" : "unmounted"} ${colour} clear`,
          cost: d(client.productCostCentsFor(spec)),
          sell: d(client.priceCentsFor(spec)),
        });
      }
    }
  }
  console.table(rows);
}

if (failures.length) {
  console.error(`PRICING PARITY FAILED — ${failures.length} mismatch(es):`);
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}
console.log(`Pricing parity OK — ${combos} price combinations, ${shippingCases.length} shipping shapes, SKUs and rounding all identical.`);
