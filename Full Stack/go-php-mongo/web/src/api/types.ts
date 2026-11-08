// Shapes returned by the services. Money is always integer cents.

export type Role = "customer" | "staff" | "admin";

export interface Address {
  id?: string;
  name: string;
  line1: string;
  line2: string;
  city: string;
  province: string;
  postalCode: string;
  country?: string;
  phone: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  roles: Role[];
  addresses: Address[];
  createdAt: string;
}

export interface Session {
  accessToken: string;
  expiresAt: string;
  user: User;
}

export interface Variant {
  sku: string;
  options: Record<string, string>;
  priceCents: number;
  compareAtCents: number | null;
  available: number;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  description?: string;
  brand: string;
  status: "draft" | "active" | "archived";
  categoryIds: string[];
  images: { url: string; alt: string }[];
  attributes: Record<string, string> | [];
  variants: Variant[];
  priceMin: number;
  priceMax: number;
  inStock: boolean;
  rating: { average: number; count: number };
  createdAt: string;
  breadcrumbs?: { id: string; name: string; slug: string }[];
}

export interface ProductPage {
  items: Product[];
  total: number;
  page: number;
  perPage: number;
  priceRange: { minCents: number; maxCents: number };
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  path: string[];
  description: string;
  position: number;
  children?: Category[];
}

export interface Review {
  id: string;
  productId: string;
  productName?: string;
  name: string;
  rating: number;
  title: string;
  body: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

export interface CartLine {
  sku: string;
  qty: number;
  productId: string;
  slug: string;
  name: string;
  options: Record<string, string>;
  image: string;
  unitPriceCents: number;
  lineTotalCents: number;
  available: number;
  problem?: string;
}

export interface Cart {
  lines: CartLine[];
  itemCount: number;
  subtotalCents: number;
  canCheckout: boolean;
}

export interface Totals {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  taxLabel: string;
  totalCents: number;
}

export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

export interface Order {
  id: string;
  number: string;
  userId?: string;
  email: string;
  lines: (Omit<CartLine, "available" | "problem">)[];
  totals: Totals;
  currency: string;
  couponCode?: string;
  shippingAddress: Address;
  status: OrderStatus;
  history: { status: OrderStatus; at: string; note?: string }[];
  paymentId?: string;
  refundedCents: number;
  tracking?: string;
  reservedUntil: string;
  createdAt: string;
  next?: OrderStatus[];
}

export interface Intent {
  paymentId: string;
  provider: "mock" | "stripe";
  clientSecret: string;
  publishableKey?: string;
  amountCents: number;
  currency: string;
}

export interface Payment {
  id: string;
  orderId: string;
  provider: string;
  amountCents: number;
  status: string;
  refundedCents: number;
  refunds: { id: string; amountCents: number; at: string }[];
  createdAt: string;
}

export interface StockRow {
  sku: string;
  onHand: number;
  reserved: number;
  available: number;
  lowStockAt: number;
  low: boolean;
  active: boolean;
  name: string;
  options: Record<string, string>;
}

export interface Coupon {
  code: string;
  percentOff: number;
  amountOffCents: number;
  minSubtotalCents: number;
  maxUses: number;
  uses: number;
  active: boolean;
  expiresAt?: string;
}

export interface Stats {
  revenueCents: number;
  orders: number;
  avgOrderCents: number;
  byDay: { date: string; revenueCents: number; orders: number }[];
  topProducts: { sku: string; name: string; qty: number; revenueCents: number }[];
  lowStock: number;
  pendingOrders: number;
}

export interface CmsPage {
  id: string;
  title: string;
  body: string;
  published: boolean;
  updatedAt: string;
}

export interface List<T> {
  items: T[];
  total?: number;
  page?: number;
  perPage?: number;
}
