import { ASSEMBLY, DISCOUNTS, LEAD_TIME, SHIPPING, TAX, lookup } from "./catalog";
import { round2 } from "./money";
import type { Customer } from "./types";

/** Billed assembly hours (never under the minimum) and their cost. */
export function assemblyLabor(hours: number): { hours: number; cost: number } {
  const billed = hours < ASSEMBLY.minHours ? ASSEMBLY.minHours : hours;
  return { hours: billed, cost: billed * ASSEMBLY.ratePerHour };
}

/**
 * The larger of the customer's tier discount (on parts) and the promo code (on
 * parts and labour), plus a loyalty bonus on parts. Rounded to the cent.
 */
export function discount(parts: number, labor: number, customer: Customer): number {
  const tier = parts * (lookup(DISCOUNTS.tierRates, customer.tier) ?? 0);
  const promo = customer.code === DISCOUNTS.promoCode ? (parts + labor) * DISCOUNTS.promoRate : 0;
  let amount = promo > tier ? promo : tier;
  if ((customer.orders ?? 0) > DISCOUNTS.loyaltyAfterOrders) amount = amount + parts * DISCOUNTS.loyaltyRate;
  return round2(amount);
}

/**
 * Weight × the region's rate, with a minimum charge. Free in CA/US once
 * `orderValue` reaches the threshold, or with the free-shipping code; ×1.5 for
 * rush orders. Rounded to the cent.
 */
export function shipping(weightKg: number, orderValue: number, customer: Customer, rush: boolean): number {
  const zone = lookup(SHIPPING.regions, customer.region) ?? SHIPPING.elsewhere;
  let cost = weightKg * zone.perKg;
  if (cost < zone.min) cost = zone.min;
  const freeRegion = customer.region !== undefined && SHIPPING.freeShippingRegions.includes(customer.region);
  if (freeRegion && orderValue >= SHIPPING.freeShippingThreshold) cost = 0;
  if (customer.code === SHIPPING.freeShippingCode) cost = 0;
  if (rush) cost = cost * SHIPPING.rushMultiplier;
  return round2(cost);
}

/** Sales tax rate: by province in Canada, VAT in the EU, none elsewhere. */
export function taxRate(customer: Customer): number {
  if (customer.region === "CA") return lookup(TAX.canadaByProvince, customer.province) ?? TAX.canadaDefault;
  if (customer.region === "EU") return TAX.eu;
  return 0;
}

export interface LeadTimeFactors {
  longestPieceMm: number;
  hasActuator: boolean;
  assembly: boolean;
  rush: boolean;
}

/** Working days to ship: a base, plus extra for long pieces, actuators and assembly; rush halves it. */
export function leadTimeDays(f: LeadTimeFactors): number {
  let days: number = LEAD_TIME.baseDays;
  if (f.longestPieceMm > LEAD_TIME.longPieceMm) days += LEAD_TIME.longPieceDays;
  if (f.hasActuator) days += LEAD_TIME.actuatorDays;
  if (f.assembly) days += LEAD_TIME.assemblyDays;
  if (f.rush) days = Math.ceil(days / 2);
  return days;
}
