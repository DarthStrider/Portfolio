/**
 * The shapes going in and out of a quote.
 *
 * Inputs are typed for what callers should send, but the code still copes with
 * what they might send (unknown profiles, plate SKUs or item types), because the
 * legacy code did and existing callers may rely on it.
 */

export interface ExtrusionItem {
  type: "extrusion";
  sku: string;
  /** "20x20", "40x40" or "40x80"; anything else is skipped with a warning. */
  profile: string;
  /** mm */
  length: number;
  qty: number;
  finish?: "clear" | "black";
}

export interface PlateItem {
  type: "plate";
  sku: string;
  qty: number;
}

export interface FastenerItem {
  type: "fastener";
  sku: string;
  /** Individual fasteners; they're sold in packs. */
  qty: number;
}

export interface MotorItem {
  type: "motor";
  sku: string;
  qty: number;
}

export interface ActuatorItem {
  type: "actuator";
  sku: string;
  qty: number;
}

export interface ControllerItem {
  type: "controller";
  sku: string;
  qty: number;
}

export type Item = ExtrusionItem | PlateItem | FastenerItem | MotorItem | ActuatorItem | ControllerItem;

export interface Design {
  items: readonly Item[];
  assembly?: boolean;
  rush?: boolean;
}

export interface Customer {
  /** "standard", "partner" or "enterprise" */
  tier?: string;
  /** "CA", "US", "EU", or anything else for the rest of the world */
  region?: string;
  /** Canadian province code, for tax */
  province?: string;
  /** Promo code */
  code?: string;
  /** Number of previous orders */
  orders?: number;
}

export interface QuoteLine {
  sku: string;
  desc: string;
  qty: number;
  unit: number;
  total: number;
}

export interface Quote {
  quoteId: string;
  lines: QuoteLine[];
  /** Parts plus labour, before discount */
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  leadTimeDays: number;
  warnings: string[];
}

export interface QuoteError {
  error: string;
}
