export type AppRole = "vendor" | "rider" | "admin";

const keys: Record<AppRole, { token: string; user?: string; login: string }> = {
  vendor: { token: "vendor_token", user: "vendor_dashboard", login: "/restaurant/login" },
  rider: { token: "rider_token", login: "/rider/login" },
  admin: { token: "admin_token", user: "admin_user", login: "/superadmin/login" },
};

const storage = () => (typeof window === "undefined" ? null : window.sessionStorage);

export const roleTokenKey = (role: AppRole) => keys[role].token;
export const getRoleToken = (role: AppRole) => storage()?.getItem(keys[role].token) || null;

export function saveRoleSession(role: AppRole, token: string, user?: unknown) {
  if (!token) throw new Error("The server did not return a session token.");
  const store = storage();
  if (!store) return;
  store.setItem(keys[role].token, token);
  if (keys[role].user && user !== undefined) {
    store.setItem(keys[role].user!, JSON.stringify(user));
  }
}

export function clearRoleSession(role: AppRole) {
  const store = storage();
  if (!store) return;
  store.removeItem(keys[role].token);
  if (keys[role].user) store.removeItem(keys[role].user!);
}

export const roleLoginPath = (role: AppRole) => keys[role].login;

export class RoleApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

export async function roleFetch<T>(role: AppRole, path: string, init: RequestInit = {}): Promise<T> {
  const token = getRoleToken(role);
  if (!token) throw new RoleApiError("Your session has expired. Please sign in again.", 401);
  let response: Response;
  try {
    response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000"}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
      cache: "no-store",
    });
  } catch {
    throw new RoleApiError("We couldn't reach OyaEat. Check your connection and try again.", 0);
  }
  const text = await response.text().catch(() => "");
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (response.status === 401) {
    clearRoleSession(role);
    if (typeof window !== "undefined") window.location.assign(roleLoginPath(role));
  }
  if (!response.ok || body?.success === false) {
    throw new RoleApiError(
      body?.message || `Request failed (${response.status})`,
      response.status,
      body?.code,
      Number(body?.retryAfter || response.headers.get("Retry-After")) || undefined,
    );
  }
  return body as T;
}
