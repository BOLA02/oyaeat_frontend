export type CartItem = {
  menuItemId: number;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  restaurantId: number;
  restaurantName: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type CartIdentity =
  | { kind: "guest"; key: typeof GUEST_CART_KEY }
  | { kind: "customer"; customerId: string; key: string };

/** The pre-isolation key. It is never read for an authenticated customer. */
export const LEGACY_CART_KEY = "customer_cart";
export const GUEST_CART_KEY = "customer_cart:guest";
const LEGACY_GUEST_MARKER_KEY = "customer_cart:guest:contains_legacy_data";
/**
 * When a real guest cart already exists, the old unscoped cart cannot safely
 * be combined with it: they may be from different restaurants. Keep it in a
 * separate guest-only recovery slot instead of overwriting either cart.
 */
export const LEGACY_GUEST_CART_KEY = "customer_cart:guest:legacy";

const validCustomerId = (id: unknown): id is string | number =>
  (typeof id === "string" && id.trim().length > 0) ||
  (typeof id === "number" && Number.isFinite(id));

export const getCustomerId = (user: { id?: unknown } | null | undefined) =>
  validCustomerId(user?.id) ? String(user.id) : null;

export const customerCartKey = (customerId: string | number) =>
  `customer_cart:customer:${encodeURIComponent(String(customerId))}`;

export const cartIdentityForUser = (
  user: { id?: unknown } | null | undefined,
): CartIdentity => {
  const customerId = getCustomerId(user);
  return customerId
    ? { kind: "customer", customerId, key: customerCartKey(customerId) }
    : { kind: "guest", key: GUEST_CART_KEY };
};

export const readCart = (storage: StorageLike, key: string): CartItem[] => {
  try {
    const raw = storage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const writeCart = (storage: StorageLike, key: string, items: CartItem[]) => {
  if (items.length) storage.setItem(key, JSON.stringify(items));
  else storage.removeItem(key);
};

export const addCartItem = (items: CartItem[], item: Omit<CartItem, "quantity">) => {
  if (items.length && items[0].restaurantId !== item.restaurantId) {
    return { items, added: false };
  }
  const existing = items.find((cartItem) => cartItem.menuItemId === item.menuItemId);
  return {
    items: existing
      ? items.map((cartItem) =>
          cartItem.menuItemId === item.menuItemId
            ? { ...cartItem, quantity: cartItem.quantity + 1 }
            : cartItem,
        )
      : [...items, { ...item, quantity: 1 }],
    added: true,
  };
};

export const decrementCartItem = (items: CartItem[], menuItemId: number) =>
  items.flatMap((item) =>
    item.menuItemId !== menuItemId
      ? [item]
      : item.quantity > 1
        ? [{ ...item, quantity: item.quantity - 1 }]
        : [],
  );

export const removeCartItem = (items: CartItem[], menuItemId: number) =>
  items.filter((item) => item.menuItemId !== menuItemId);

/**
 * Moves the ambiguous, pre-isolation cart into the guest namespace once.
 * It deliberately never runs for an authenticated identity, so legacy items
 * can never be assigned to whichever customer happens to sign in first.
 */
export const migrateLegacyCartToGuest = (storage: StorageLike) => {
  const legacy = readCart(storage, LEGACY_CART_KEY);
  if (!legacy.length) return false;
  const guest = readCart(storage, GUEST_CART_KEY);
  if (!guest.length) {
    writeCart(storage, GUEST_CART_KEY, legacy);
  } else {
    // Preserve the prior legacy cart even when a newer guest cart is active.
    // Do not merge here: a legacy cart is ambiguous and may be incompatible.
    writeCart(storage, LEGACY_GUEST_CART_KEY, legacy);
  }
  storage.setItem(LEGACY_GUEST_MARKER_KEY, "1");
  storage.removeItem(LEGACY_CART_KEY);
  return true;
};

/** A legacy-derived guest cart is intentionally not auto-transferred on login. */
export const guestCartContainsLegacyData = (storage: StorageLike) =>
  storage.getItem(LEGACY_GUEST_MARKER_KEY) === "1";

export const clearGuestLegacyMarker = (storage: StorageLike) =>
  storage.removeItem(LEGACY_GUEST_MARKER_KEY);

/**
 * Safely transfers a current guest cart into a customer's cart at login.
 * We merge only carts from the same restaurant. Otherwise the guest cart is
 * retained separately so neither cart is silently overwritten.
 */
export const mergeGuestCartIntoCustomer = (
  storage: StorageLike,
  customerId: string | number,
) => {
  if (guestCartContainsLegacyData(storage)) return { merged: false, reason: "legacy" as const };

  const guest = readCart(storage, GUEST_CART_KEY);
  if (!guest.length) return { merged: false, reason: "empty" as const };

  const customerKey = customerCartKey(customerId);
  const customer = readCart(storage, customerKey);
  const guestRestaurantId = guest[0]?.restaurantId;
  const customerRestaurantId = customer[0]?.restaurantId;

  if (
    guest.some((item) => item.restaurantId !== guestRestaurantId) ||
    customer.some((item) => item.restaurantId !== customerRestaurantId) ||
    (customer.length && customerRestaurantId !== guestRestaurantId)
  ) {
    return { merged: false, reason: "restaurant-conflict" as const };
  }

  const merged = [...customer];
  for (const guestItem of guest) {
    const index = merged.findIndex((item) => item.menuItemId === guestItem.menuItemId);
    if (index === -1) merged.push(guestItem);
    else merged[index] = { ...merged[index], quantity: merged[index].quantity + guestItem.quantity };
  }

  writeCart(storage, customerKey, merged);
  storage.removeItem(GUEST_CART_KEY);
  clearGuestLegacyMarker(storage);
  return { merged: true, reason: "merged" as const };
};
