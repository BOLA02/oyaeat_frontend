"use client";

import { useCallback, useLayoutEffect, useState } from "react";
import {
  cartIdentityForUser,
  clearGuestLegacyMarker,
  addCartItem,
  decrementCartItem,
  GUEST_CART_KEY,
  migrateLegacyCartToGuest,
  readCart,
  removeCartItem,
  type CartIdentity,
  type CartItem,
  writeCart,
} from "@/lib/cartStorage";
import { CUSTOMER_SESSION_EVENT, getUser } from "@/lib/customer";

export type { CartItem } from "@/lib/cartStorage";

const EVENT = "oyaeat:cart";

const activeIdentity = (): CartIdentity => {
  const identity = cartIdentityForUser(getUser());
  // Legacy data is ambiguous, so only expose it to the anonymous guest cart.
  // Authenticated users never read or receive the legacy key.
  if (identity.kind === "guest") migrateLegacyCartToGuest(localStorage);
  return identity;
};

const readActive = () => {
  const identity = activeIdentity();
  return { identity, items: readCart(localStorage, identity.key) };
};

const writeActive = (items: CartItem[]) => {
  const identity = activeIdentity();
  try {
    writeCart(localStorage, identity.key, items);
    // Clearing a migrated cart is an explicit reset, after which newly added
    // guest items can follow the normal guest-to-login transfer policy.
    if (identity.key === GUEST_CART_KEY && !items.length) clearGuestLegacyMarker(localStorage);
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { key: identity.key } }));
};

/**
 * The active cart is selected from the current customer session on every read
 * and write. Independent hook instances stay in sync through scoped events.
 */
export function useCart() {
  const [snapshot, setSnapshot] = useState<{ key: string; items: CartItem[] }>({
    key: "",
    items: [],
  });
  const [ready, setReady] = useState(false);

  // Keep the initial server and client render identical. Once mounted, derive
  // the displayed identity during render so a Customer A frame is never shown
  // after Customer B becomes the active session.
  const current = ready
    ? readActive()
    : { identity: { kind: "guest" as const, key: GUEST_CART_KEY }, items: [] as CartItem[] };
  const items = snapshot.key === current.identity.key ? snapshot.items : current.items;

  useLayoutEffect(() => {
    const sync = () => {
      const next = readActive();
      setSnapshot({ key: next.identity.key, items: next.items });
    };
    sync();
    setReady(true);

    const onCart = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (!key || key === activeIdentity().key) sync();
    };
    const onStorage = (event: StorageEvent) => {
      // Authentication is tab-local. Only account-scoped cart writes shared
      // through localStorage should refresh this tab.
      if (event.key === activeIdentity().key) {
        sync();
      }
    };

    window.addEventListener(EVENT, onCart);
    window.addEventListener(CUSTOMER_SESSION_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onCart);
      window.removeEventListener(CUSTOMER_SESSION_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  /** Returns false when the item is from a different restaurant than the cart. */
  const add = useCallback((item: Omit<CartItem, "quantity">) => {
    const { items: current } = readActive();
    const next = addCartItem(current, item);
    if (next.added) writeActive(next.items);
    return next.added;
  }, []);

  const decrement = useCallback((menuItemId: number) => {
    const { items: current } = readActive();
    writeActive(decrementCartItem(current, menuItemId));
  }, []);

  const remove = useCallback((menuItemId: number) => {
    writeActive(removeCartItem(readActive().items, menuItemId));
  }, []);

  const clear = useCallback(() => writeActive([]), []);

  /** Replace the cart with a single new item (after a different-restaurant conflict). */
  const replaceWith = useCallback((item: Omit<CartItem, "quantity">) => {
    writeActive([{ ...item, quantity: 1 }]);
  }, []);

  const replaceAll = useCallback((next: CartItem[]) => writeActive(next), []);

  const quantityOf = useCallback(
    (menuItemId: number) => items.find((c) => c.menuItemId === menuItemId)?.quantity || 0,
    [items],
  );

  const count = items.reduce((n, i) => n + i.quantity, 0);
  const subtotal = items.reduce((n, i) => n + i.price * i.quantity, 0);

  return {
    items,
    ready,
    count,
    subtotal,
    restaurantId: items[0]?.restaurantId,
    restaurantName: items[0]?.restaurantName,
    add,
    decrement,
    remove,
    clear,
    replaceWith,
    replaceAll,
    quantityOf,
  };
}
