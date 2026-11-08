/**
 * Every price, weight, rate and threshold the quote uses, in one place.
 * Money in dollars, weight in kg, length in mm, labour in hours, lead time in days.
 */

export const PROFILES = {
  "20x20": { pricePerMeter: 12.5, kgPerMeter: 0.5 },
  "40x40": { pricePerMeter: 28, kgPerMeter: 1.5 },
  "40x80": { pricePerMeter: 49, kgPerMeter: 2.8 },
} as const;

export const EXTRUSION = {
  cutFee: 1.5,
  spliceFee: 8,
  minLengthMm: 50,
  stockLengthMm: 3000,
  blackFinishMultiplier: 1.15,
  laborHours: 0.5,
} as const;

export const PLATE_PRICES: Readonly<Record<string, number>> = {
  "PL-100": 18.5,
  "PL-200": 32,
  "PL-300": 54.25,
  "BR-90": 7.8,
};

export const PLATE = { kg: 1.2, laborHours: 0.25 } as const;

export const FASTENER_PACK = { size: 50, price: 6.75, kg: 0.4 } as const;

export const MOTOR = { price: 189, kg: 1.8, laborHours: 1, description: "Servo motor" } as const;

export const ACTUATOR = {
  price: 420,
  kg: 3.5,
  laborHours: 1,
  description: "Linear actuator",
  bulkQty: 4,
  bulkMultiplier: 0.95,
} as const;

export const CONTROLLER = { price: 650, kg: 2.2, laborHours: 2, description: "Motion controller" } as const;

export const ASSEMBLY = { ratePerHour: 35, minHours: 2 } as const;

export const DISCOUNTS = {
  tierRates: { partner: 0.1, enterprise: 0.15 } as Readonly<Record<string, number>>,
  promoCode: "SPRING10",
  promoRate: 0.1,
  loyaltyAfterOrders: 10,
  loyaltyRate: 0.02,
} as const;

export const SHIPPING = {
  regions: {
    CA: { perKg: 1.2, min: 25 },
    US: { perKg: 1.5, min: 30 },
    EU: { perKg: 2.4, min: 45 },
  } as Readonly<Record<string, { perKg: number; min: number }>>,
  elsewhere: { perKg: 3.9, min: 60 },
  freeShippingRegions: ["CA", "US"] as readonly string[],
  freeShippingThreshold: 2500,
  freeShippingCode: "FREESHIP",
  rushMultiplier: 1.5,
} as const;

export const TAX = {
  canadaByProvince: { ON: 0.13, QC: 0.14975, BC: 0.12, AB: 0.05 } as Readonly<Record<string, number>>,
  canadaDefault: 0.05,
  eu: 0.2,
} as const;

export const LEAD_TIME = {
  baseDays: 5,
  longPieceMm: 2000,
  longPieceDays: 3,
  actuatorDays: 7,
  assemblyDays: 2,
} as const;

/** Reads a table entry by a key from outside (user input), ignoring inherited properties like "constructor". */
export function lookup<T>(table: Readonly<Record<string, T>>, key: unknown): T | undefined {
  return typeof key === "string" && Object.hasOwn(table, key) ? table[key] : undefined;
}
