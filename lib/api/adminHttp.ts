// Shared request helper for superadmin screens. Reads only the admin token.

export const adminBase = () =>
  process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export async function adminCall<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  return roleFetch<T>("admin", path, {
    ...init,
    headers: { ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
}
import { roleFetch } from "@/lib/roleSession";
