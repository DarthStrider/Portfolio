/**
 * Prints a quote for a sample machine design.
 *   npm run demo
 */
import { createQuote } from "../src/quote";
import type { Customer, Design } from "../src/types";

const design: Design = {
  assembly: true,
  rush: false,
  items: [
    { type: "extrusion", sku: "EX-4040", profile: "40x40", length: 1200, qty: 4 },
    { type: "extrusion", sku: "EX-4080", profile: "40x80", length: 2400, qty: 2, finish: "black" },
    { type: "plate", sku: "PL-200", qty: 4 },
    { type: "fastener", sku: "M6-BOLT", qty: 120 },
    { type: "actuator", sku: "LA-300", qty: 2 },
    { type: "controller", sku: "MC-1", qty: 1 },
  ],
};
const customer: Customer = { tier: "partner", region: "CA", province: "ON", orders: 3 };

const quote = createQuote(design, customer, Date.now());
if ("error" in quote) {
  console.error(quote.error);
  process.exit(1);
}

const money = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });
console.log(`\nQuote ${quote.quoteId}\n`);
for (const l of quote.lines) {
  console.log(`  ${l.desc.padEnd(34)} ${String(l.qty).padStart(3)} × ${money(l.unit).padStart(10)}  ${money(l.total).padStart(11)}`);
}
console.log("");
for (const [label, value] of [
  ["Subtotal", quote.subtotal],
  ["Discount", -quote.discount],
  ["Shipping", quote.shipping],
  ["Tax", quote.tax],
  ["Total", quote.total],
] as const) {
  console.log(`  ${label.padEnd(52)} ${money(value).padStart(11)}`);
}
console.log(`\n  Ships in ${quote.leadTimeDays} working days`);
for (const w of quote.warnings) console.log(`  ⚠ ${w}`);
console.log("");
