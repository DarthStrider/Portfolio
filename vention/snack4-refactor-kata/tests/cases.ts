/**
 * Generates the golden-master inputs: a fixed, repeatable set of designs and
 * customers that between them hit every branch of the quote logic, including
 * the awkward ones (unknown parts, boundaries like exactly 50 mm or 3000 mm,
 * lower-case promo codes, unknown regions).
 */

export interface Case {
  name: string;
  design: unknown;
  customer: unknown;
}

/** Seeded generator, so the case list is identical on every run. */
function makeRandom(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    chance: (p: number) => next() < p,
  };
}

const PROFILES = ["20x20", "40x40", "40x80", "40x80", "30x30"] as const;
const LENGTHS = [30, 49, 50, 120, 300, 750, 1000, 1500, 2000, 2001, 2500, 2999, 3000, 3001, 4200] as const;
const PLATES = ["PL-100", "PL-200", "PL-300", "BR-90", "PL-999"] as const;
const TIERS = ["standard", "partner", "enterprise", undefined] as const;
const REGIONS = ["CA", "CA", "US", "EU", "OTHER", "JP"] as const;
const PROVINCES = ["ON", "QC", "BC", "AB", "NS", undefined] as const;
const CODES = [undefined, undefined, "SPRING10", "spring10", "FREESHIP"] as const;

export function generateCases(count = 1000, seed = 2024): Case[] {
  const r = makeRandom(seed);
  const cases: Case[] = [
    { name: "empty design", design: { items: [] }, customer: { region: "CA" } },
    { name: "no design", design: null, customer: { region: "CA" } },
  ];

  // Callers don't always send real booleans; the legacy code used truthiness, so test that too.
  const flag = (p: number): unknown => (r.chance(0.05) ? r.pick([1, "yes", 0, ""]) : r.chance(p));

  for (let n = 0; n < count; n++) {
    const big = r.chance(0.12); // big orders reach the free-shipping threshold
    const items: unknown[] = [];
    const itemCount = big ? r.int(4, 10) : r.int(1, 8);
    for (let k = 0; k < itemCount; k++) {
      const roll = r.next();
      if (roll < 0.33) {
        items.push({
          type: "extrusion",
          sku: `EX-${k}`,
          profile: r.pick(PROFILES),
          length: r.chance(0.7) ? r.pick(LENGTHS) : r.int(40, 4500),
          finish: r.chance(0.3) ? "black" : "clear",
          qty: r.int(1, 12),
        });
      } else if (roll < 0.52) {
        items.push({ type: "plate", sku: r.pick(PLATES), qty: r.int(1, 8) });
      } else if (roll < 0.67) {
        items.push({ type: "fastener", sku: "M6-BOLT", qty: r.chance(0.3) ? r.pick([1, 24, 25, 49, 50, 51, 74, 75, 100]) : r.int(1, 180) });
      } else if (roll < 0.78) {
        items.push({ type: "motor", sku: "SRV-400", qty: big ? r.int(2, 8) : r.int(1, 4) });
      } else if (roll < 0.89) {
        items.push({ type: "actuator", sku: "LA-300", qty: big ? r.int(3, 10) : r.int(1, 6) });
      } else if (roll < 0.97) {
        items.push({ type: "controller", sku: "MC-1", qty: r.int(1, 2) });
      } else {
        items.push({ type: "gripper", sku: "GR-1", qty: 1 });
      }
    }
    cases.push({
      name: `case ${n}`,
      design: { items, assembly: flag(0.4), rush: flag(0.2) },
      customer: {
        tier: r.pick(TIERS),
        region: r.pick(REGIONS),
        province: r.pick(PROVINCES),
        code: r.pick(CODES),
        orders: r.int(0, 20),
      },
    });
  }
  return cases;
}
