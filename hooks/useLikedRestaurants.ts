"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL, CUSTOMER_SESSION_EVENT, getCustomerId, getToken, getUser } from "@/lib/customer";

const EVENT = "oyaeat:likes";

const activeKey = () => {
  const customerId = getCustomerId(getUser());
  return customerId ? `liked_restaurants:customer:${encodeURIComponent(customerId)}` : "liked_restaurants:guest";
};

// Quiet request: an expired token must not bounce someone who is just browsing to the login page.
async function favApi(path: string, method = "GET") {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new Error(json?.message || "Request failed");
  return json;
}

const readLocal = (): any[] => {
  try {
    const raw = localStorage.getItem(activeKey());
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeLocal = (items: any[]) => {
  try {
    localStorage.setItem(activeKey(), JSON.stringify(items));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
};

/**
 * Saved restaurants. Logged-in customers are saved on their account (so they
 * follow them to any device); the browser copy is the cache and the fallback
 * for logged-out visitors. Likes made before logging in are uploaded once.
 */
export function useLikedRestaurants() {
  const [liked, setLiked] = useState<any[]>([]);

  useEffect(() => {
    const sync = () => setLiked(readLocal());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener(CUSTOMER_SESSION_EVENT, sync);

    if (getToken()) {
      (async () => {
        try {
          const token = getToken();
          const key = activeKey();
          const local = readLocal();
          const server = (await favApi("/customer/favorites")).data?.favorites || [];
          if (token !== getToken() || key !== activeKey()) return;
          const serverIds = new Set(server.map((r: any) => r.id));
          // upload anything saved locally that the account doesn't have yet
          const missing = local.filter((r) => !serverIds.has(r.id));
          await Promise.allSettled(
            missing.map((r) => favApi(`/customer/favorites/${r.id}`, "PUT")),
          );
          if (token === getToken() && key === activeKey()) {
            writeLocal([...server, ...missing.filter((r) => r.id)]);
          }
        } catch {
          // offline or signed out: keep the local copy
        }
      })();
    }

    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener(CUSTOMER_SESSION_EVENT, sync);
    };
  }, []);

  const toggle = useCallback((restaurant: any) => {
    const key = activeKey();
    const token = getToken();
    const current = readLocal();
    const has = current.some((r) => r.id === restaurant.id);
    writeLocal(has ? current.filter((r) => r.id !== restaurant.id) : [...current, restaurant]);

    if (getToken()) {
      favApi(`/customer/favorites/${restaurant.id}`, has ? "DELETE" : "PUT").catch(() => {
        // roll back the optimistic change if the server refused it
        if (key === activeKey() && token === getToken()) {
          writeLocal(readLocal().filter((r) => r.id !== restaurant.id).concat(has ? [restaurant] : []));
        }
      });
    }
  }, []);

  const isLiked = useCallback((id: number) => liked.some((r) => r.id === id), [liked]);

  return { liked, toggle, isLiked };
}
