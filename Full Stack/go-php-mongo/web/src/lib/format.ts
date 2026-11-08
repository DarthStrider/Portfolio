const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

export const money = (cents: number) => cad.format(cents / 100);

export const date = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const optionText = (o: Record<string, string> | undefined) =>
  Object.entries(o ?? {})
    .map(([k, v]) => `${k[0].toUpperCase()}${k.slice(1)}: ${v}`)
    .join(", ");

export const statusLabel: Record<string, string> = {
  pending_payment: "Awaiting payment",
  paid: "Paid",
  processing: "Packing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export const PROVINCES: [string, string][] = [
  ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"],
  ["NL", "Newfoundland and Labrador"], ["NS", "Nova Scotia"], ["NT", "Northwest Territories"],
  ["NU", "Nunavut"], ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"],
  ["SK", "Saskatchewan"], ["YT", "Yukon"],
];

/** "$24.99" or "24.99" -> 2499; null if it isn't a price. */
export function parseDollars(s: string): number | null {
  const t = s.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}
