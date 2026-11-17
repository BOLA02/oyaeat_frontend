// Shared helpers for the customer app: API base, auth storage, formatting.

export const API_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:5000";

export const naira = (n: number) => `₦${Math.round(n || 0).toLocaleString()}`;

export const resolveImg = (url?: string | null) => {
  if (!url) return "";
  return url.startsWith("http") ? url : `${API_URL}${url}`;
};

export type CustomerUser = {
  // Stable account identifier returned by the customer auth API. Cart
  // ownership uses this, never a token, email address, or display name.
  id: number | string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
};

export const getCustomerId = (user: CustomerUser | null | undefined) =>
  user?.id === undefined || user.id === null || String(user.id).trim() === ""
    ? null
    : String(user.id);

export const CUSTOMER_SESSION_EVENT = "oyaeat:customer-session";
const LEGACY_PENDING_PAYMENT_KEY = "oyaeat_pending_payment";
const CUSTOMER_TOKEN_KEY = "customer_token";
const CUSTOMER_USER_KEY = "customer_user";
const LOGOUT_TIMEOUT_MS = 8_000;
const logoutRequests = new Map<string, Promise<void>>();

const notifyCustomerSessionChanged = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CUSTOMER_SESSION_EVENT));
};

export const getToken = () =>
  typeof window === "undefined" ? null : sessionStorage.getItem(CUSTOMER_TOKEN_KEY);

export const getUser = (): CustomerUser | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CUSTOMER_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const clearSession = () => {
  sessionStorage.removeItem(CUSTOMER_USER_KEY);
  sessionStorage.removeItem(CUSTOMER_TOKEN_KEY);
  notifyCustomerSessionChanged();
};

type CustomerSessionSnapshot = { token: string; customerId: string };

const currentCustomerSession = (): CustomerSessionSnapshot | null => {
  const token = getToken();
  const customerId = getCustomerId(getUser());
  return token && customerId ? { token, customerId } : null;
};

/**
 * Explicit logout revokes the token captured from this tab only. Local state
 * is cleared before the request settles, so a network failure cannot leave a
 * usable session behind and a later login is never touched by this request.
 */
export const logoutCustomer = (): Promise<void> => {
  const session = currentCustomerSession();
  clearSession();
  if (!session) return Promise.resolve();

  const existing = logoutRequests.get(session.token);
  if (existing) return existing;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), LOGOUT_TIMEOUT_MS);
  const request = fetch(`${API_URL}/customer/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.token}` },
    signal: controller.signal,
  })
    // Logout is best effort. The captured token may already be expired or
    // revoked; the local tab must still stay signed out in every outcome.
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      window.clearTimeout(timeout);
      logoutRequests.delete(session.token);
    });
  logoutRequests.set(session.token, request);
  return request;
};

export type CustomerAuthPayload = {
  token: string;
  user: CustomerUser;
};

/**
 * Persists a customer session in the same shape used by email/password login.
 * Authentication responses must come from the OyaEat API, never from Google.
 */
export const saveCustomerSession = (payload: CustomerAuthPayload) => {
  if (!payload?.token || !payload?.user || !getCustomerId(payload.user)) {
    throw new ApiError("We couldn't complete sign-in. Please try again.", 0);
  }
  // Authentication is tab-scoped. Do not fall back to the old localStorage
  // keys: that could silently restore another tab's customer session.
  sessionStorage.setItem(CUSTOMER_USER_KEY, JSON.stringify(payload.user));
  sessionStorage.setItem(CUSTOMER_TOKEN_KEY, payload.token);
  notifyCustomerSessionChanged();
};

/** Updates the cached profile without changing the authenticated identity. */
export const saveCustomerUser = (user: CustomerUser) => {
  if (!getCustomerId(user)) {
    throw new ApiError("We couldn't update your session. Please sign in again.", 0);
  }
  sessionStorage.setItem(CUSTOMER_USER_KEY, JSON.stringify(user));
  notifyCustomerSessionChanged();
};

/**
 * Applies a profile response only if it still belongs to the request's
 * original session. A password-change token is rotated atomically for this
 * tab; profile-only responses leave the existing token untouched.
 */
export const applyCustomerProfileUpdate = (
  expected: CustomerSessionSnapshot,
  user: CustomerUser,
  replacementToken?: string | null,
) => {
  if (
    !activeSessionMatches(expected.token, expected.customerId) ||
    getCustomerId(user) !== expected.customerId
  ) {
    return false;
  }
  sessionStorage.setItem(CUSTOMER_USER_KEY, JSON.stringify(user));
  if (replacementToken) sessionStorage.setItem(CUSTOMER_TOKEN_KEY, replacementToken);
  notifyCustomerSessionChanged();
  return true;
};

export const customerSessionSnapshot = () => currentCustomerSession();

const configuredAppOrigin = () =>
  process.env.NEXT_PUBLIC_APP_ORIGIN?.replace(/\/$/, "") || "";

/** Uses the configured approved frontend origin, with the current origin for local development. */
export const customerPaymentCallbackUrl = (currentOrigin: string) =>
  new URL("/customer/dashboard/orders", configuredAppOrigin() || currentOrigin).toString();

/** Pending-payment markers are scoped so one account cannot consume another's return. */
export const pendingPaymentKey = (customerId: string | number) =>
  `oyaeat_pending_payment:${encodeURIComponent(String(customerId))}`;

export type PendingPayment = { customerId: string; orderId: string; reference: string };

export const savePendingPayment = (payment: PendingPayment) => {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(pendingPaymentKey(payment.customerId), JSON.stringify(payment));
  }
};

export const getPendingPayment = (customerId: string | number): PendingPayment | null => {
  if (typeof window === "undefined") return null;
  const current = sessionStorage.getItem(pendingPaymentKey(customerId));
  if (current) {
    try {
      const parsed = JSON.parse(current);
      return parsed?.customerId === String(customerId) && parsed?.orderId && parsed?.reference ? parsed : null;
    } catch { return null; }
  }
  // Support the short-lived old marker without allowing a different account
  // to consume it.
  try {
    const legacy = sessionStorage.getItem(LEGACY_PENDING_PAYMENT_KEY);
    const parsed = legacy ? JSON.parse(legacy) : null;
    return parsed?.customerId === String(customerId) && parsed?.orderId && parsed?.reference ? parsed : null;
  } catch {
    return null;
  }
};

export const hasPendingPayment = (customerId: string | number) => !!getPendingPayment(customerId);

export const clearPendingPayment = (customerId: string | number) => {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(pendingPaymentKey(customerId));
  try {
    const legacy = sessionStorage.getItem(LEGACY_PENDING_PAYMENT_KEY);
    if (legacy && JSON.parse(legacy)?.customerId === String(customerId)) {
      sessionStorage.removeItem(LEGACY_PENDING_PAYMENT_KEY);
    }
  } catch {
    // An unscoped malformed legacy value is intentionally left untouched.
  }
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** fetch JSON from the API. Throws ApiError with a human message on failure. */
export async function api<T = any>(
  path: string,
  opts: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth, headers, ...rest } = opts;
  const token = auth ? getToken() : null;
  const customerId = auth ? getCustomerId(getUser()) : null;
  if (auth && (!token || !customerId)) {
    throw new ApiError("Your session has expired. Please sign in again.", 401);
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: {
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch {
    throw new ApiError(
      "We couldn't reach OyaEat. Check your connection and try again.",
      0,
    );
  }
  // Do not allow a response made as Customer A to update UI after this tab
  // has changed to Customer B, logged out, or received a new token.
  if (auth && !activeSessionMatches(token, customerId)) {
    throw new CustomerSessionChangedError();
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {}
  if (res.status === 401 && auth && activeSessionMatches(token, customerId)) {
    clearSession();
    if (typeof window !== "undefined") {
      window.location.href = `/customer/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
  }
  if (!res.ok || json?.success === false) {
    throw new ApiError(
      json?.message || "Something went wrong. Please try again.",
      res.status,
    );
  }
  return json as T;
}

/** The tab changed account while an authenticated request was in flight. */
export class CustomerSessionChangedError extends ApiError {
  constructor() {
    super("Your customer session changed. Please retry the request.", 409);
  }
}

const activeSessionMatches = (token: string | null, customerId: string | null) =>
  getToken() === token && getCustomerId(getUser()) === customerId;

/**
 * Exchanges a Google Identity Services ID token for an OyaEat customer session.
 * The API must verify the credential and return the normal customer auth payload.
 */
export async function authenticateCustomerWithGoogle(credential: string) {
  return api<{ success: boolean; data: CustomerAuthPayload }>(
    "/api/v1/auth/google",
    {
      method: "POST",
      body: JSON.stringify({ credential }),
    },
  );
}

export const ORDER_STEPS = [
  { id: "pending", label: "Placed" },
  { id: "preparing", label: "Preparing" },
  { id: "ready", label: "Ready" },
  { id: "out_for_delivery", label: "On the way" },
  { id: "delivered", label: "Delivered" },
] as const;

export const ACTIVE_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "out_for_delivery",
];

export const statusMeta = (status: string) => {
  switch (status) {
    case "delivered":
      return { label: "Delivered", tone: "success" as const };
    case "cancelled":
    case "rejected":
    case "failed":
      return { label: status === "failed" ? "Failed" : "Cancelled", tone: "danger" as const };
    case "out_for_delivery":
      return { label: "On the way", tone: "mango" as const };
    case "preparing":
      return { label: "Preparing", tone: "mango" as const };
    case "ready":
      return { label: "Ready", tone: "mango" as const };
    case "confirmed":
      return { label: "Confirmed", tone: "primary" as const };
    case "pending":
      return { label: "Placed", tone: "primary" as const };
    default:
      return { label: status.replace(/_/g, " "), tone: "primary" as const };
  }
};

/** An online-payment order whose payment we have not confirmed yet. */
export const isAwaitingPayment = (o: any) =>
  o?.paymentMethod === "paystack" && o?.paymentStatus !== "paid" && !!o?.paymentReference && o?.status === "pending";

/**
 * Asks the server to confirm any online payments that are still unconfirmed
 * (the customer has just returned from Paystack, or the page was reloaded).
 * Returns how many orders turned out to be paid. Never throws: a payment that is
 * simply not finished yet is not an error.
 */
export async function confirmPendingPayments(orders: any[]): Promise<number> {
  const waiting = orders.filter(isAwaitingPayment);
  const results = await Promise.all(
    waiting.map((o) =>
      api(`/orders/verify-payment/${encodeURIComponent(o.paymentReference)}`, { auth: true })
        .then(() => true)
        .catch(() => false),
    ),
  );
  return results.filter(Boolean).length;
}
