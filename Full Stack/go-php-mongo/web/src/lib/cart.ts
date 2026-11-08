import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, patch, post } from "../api/client";
import type { Cart } from "../api/types";

/** The cart lives in order-service; this keeps one cached copy for the header badge and pages. */
export function useCart() {
  return useQuery({ queryKey: ["cart"], queryFn: () => get<Cart>("/cart") });
}

export function useCartActions() {
  const qc = useQueryClient();
  // Every cart endpoint answers with the whole updated cart, so the cache is replaced
  // directly instead of being refetched.
  const onSuccess = (cart: Cart) => qc.setQueryData(["cart"], cart);
  return {
    add: useMutation({ mutationFn: (v: { sku: string; qty: number }) => post<Cart>("/cart/items", v), onSuccess }),
    setQty: useMutation({
      mutationFn: (v: { sku: string; qty: number }) => patch<Cart>(`/cart/items/${encodeURIComponent(v.sku)}`, { qty: v.qty }),
      onSuccess,
    }),
    remove: useMutation({ mutationFn: (sku: string) => del<Cart>(`/cart/items/${encodeURIComponent(sku)}`), onSuccess }),
  };
}

/** Guests view their orders with a key from checkout; it's kept for this browser tab. */
export const guestKeys = {
  save(orderId: string, key: string) {
    try {
      sessionStorage.setItem(`order-key:${orderId}`, key);
    } catch {
      /* private mode: the key is still in the URL */
    }
  },
  get(orderId: string): string {
    try {
      return sessionStorage.getItem(`order-key:${orderId}`) ?? "";
    } catch {
      return "";
    }
  },
};
