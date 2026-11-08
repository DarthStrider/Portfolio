import { ACTUATOR, CONTROLLER, EXTRUSION, FASTENER_PACK, MOTOR, PLATE, PLATE_PRICES, PROFILES, lookup } from "./catalog";
import { round2 } from "./money";
import type {
  ActuatorItem, ControllerItem, ExtrusionItem, FastenerItem, Item, MotorItem, PlateItem, QuoteLine,
} from "./types";

/** What one design item adds to a quote. */
export interface PricedItem {
  line: QuoteLine;
  weightKg: number;
  laborHours: number;
  /** Notes that don't stop the item being quoted, like a splice. */
  warnings: string[];
}

/** An item that can't be quoted, and why. */
export interface SkippedItem {
  skipped: string;
}

export function priceItem(item: Item): PricedItem | SkippedItem {
  switch (item.type) {
    case "extrusion":
      return priceExtrusion(item);
    case "plate":
      return pricePlate(item);
    case "fastener":
      return priceFasteners(item);
    case "motor":
      return priceMotor(item);
    case "actuator":
      return priceActuator(item);
    case "controller":
      return priceController(item);
    default:
      // Not a known Item, but callers can still send one.
      return { skipped: "Unknown item type " + (item as { type: unknown }).type };
  }
}

/** Cut to length from stock: price per meter plus a cut fee; long pieces are spliced from two. */
function priceExtrusion(item: ExtrusionItem): PricedItem | SkippedItem {
  const len = item.length;
  if (len < EXTRUSION.minLengthMm) return { skipped: `Extrusion ${item.sku} too short (${len}mm), skipped` };
  const profile = lookup(PROFILES, item.profile);
  if (!profile) return { skipped: `Unknown profile ${item.profile} for ${item.sku}` };

  const warnings: string[] = [];
  const black = item.finish === "black";
  let price = profile.pricePerMeter * (len / 1000) + EXTRUSION.cutFee;
  if (black) price = price * EXTRUSION.blackFinishMultiplier;
  if (len > EXTRUSION.stockLengthMm) {
    warnings.push(`Extrusion ${item.sku} exceeds 3000mm stock; will be spliced`);
    price = price + EXTRUSION.spliceFee + EXTRUSION.cutFee;
  }
  price = round2(price);

  return {
    line: {
      sku: item.sku,
      desc: `${item.profile} extrusion ${len}mm${black ? " black" : ""}`,
      qty: item.qty,
      unit: price,
      total: price * item.qty,
    },
    weightKg: profile.kgPerMeter * (len / 1000) * item.qty,
    laborHours: EXTRUSION.laborHours * item.qty,
    warnings,
  };
}

function pricePlate(item: PlateItem): PricedItem | SkippedItem {
  const price = lookup(PLATE_PRICES, item.sku);
  if (price === undefined) return { skipped: `Unknown plate ${item.sku}` };
  return {
    line: { sku: item.sku, desc: `Plate ${item.sku}`, qty: item.qty, unit: price, total: price * item.qty },
    weightKg: PLATE.kg * item.qty,
    laborHours: PLATE.laborHours * item.qty,
    warnings: [],
  };
}

/** Sold in whole packs, rounded up; quantity on the line is packs, not pieces. */
function priceFasteners(item: FastenerItem): PricedItem {
  const packs = Math.max(1, Math.ceil(item.qty / FASTENER_PACK.size));
  return {
    line: {
      sku: item.sku,
      desc: "Fasteners (pack of 50)",
      qty: packs,
      unit: FASTENER_PACK.price,
      total: packs * FASTENER_PACK.price,
    },
    weightKg: FASTENER_PACK.kg * packs,
    laborHours: 0,
    warnings: [],
  };
}

function priceMotor(item: MotorItem): PricedItem {
  return {
    line: { sku: item.sku, desc: MOTOR.description, qty: item.qty, unit: MOTOR.price, total: MOTOR.price * item.qty },
    weightKg: MOTOR.kg * item.qty,
    laborHours: MOTOR.laborHours * item.qty,
    warnings: [],
  };
}

/** Bulk discount from ACTUATOR.bulkQty units. */
function priceActuator(item: ActuatorItem): PricedItem {
  let unit: number = ACTUATOR.price;
  if (item.qty >= ACTUATOR.bulkQty) unit = unit * ACTUATOR.bulkMultiplier;
  return {
    line: { sku: item.sku, desc: ACTUATOR.description, qty: item.qty, unit, total: unit * item.qty },
    weightKg: ACTUATOR.kg * item.qty,
    laborHours: ACTUATOR.laborHours * item.qty,
    warnings: [],
  };
}

function priceController(item: ControllerItem): PricedItem {
  return {
    line: {
      sku: item.sku,
      desc: CONTROLLER.description,
      qty: item.qty,
      unit: CONTROLLER.price,
      total: CONTROLLER.price * item.qty,
    },
    weightKg: CONTROLLER.kg * item.qty,
    laborHours: CONTROLLER.laborHours * item.qty,
    warnings: [],
  };
}
