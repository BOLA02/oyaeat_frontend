"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ChevronRight, MapPin, Receipt, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, ErrorState, PageHeader, RowSkeleton, StatusPill } from "./ui";
import { ACTIVE_STATUSES, api, clearPendingPayment, CUSTOMER_SESSION_EVENT, getCustomerId, getPendingPayment, getUser, naira } from "@/lib/customer";
import { useCart } from "@/hooks/useCart";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "active", label: "Active" },
  { id: "past", label: "Past" },
  { id: "all", label: "All" },
] as const;

export default function OrdersView() {
  const router = useRouter();
  const { clear, replaceAll } = useCart();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("all");
  const [shown, setShown] = useState(8);
  const mountedRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const customerId = getCustomerId(getUser());
    setLoading(true);
    setError("");
    try {
      let json = await api("/orders/my", { auth: true, signal: controller.signal });
      let list: any[] = json.data?.orders || [];
      const pending = customerId ? getPendingPayment(customerId) : null;
      if (pending) {
        try {
          await api(`/orders/verify-payment/${encodeURIComponent(pending.reference)}`, { auth: true, signal: controller.signal });
          json = await api("/orders/my", { auth: true, signal: controller.signal });
          list = json.data?.orders || [];
          const paidOrder = list.find((order) => String(order.id) === pending.orderId && (order.paymentStatus === "paid" || order.isPaid === true));
          if (paidOrder && !controller.signal.aborted && getCustomerId(getUser()) === customerId) {
            clear();
            clearPendingPayment(pending.customerId);
            toast.success("Payment confirmed. The restaurant has your order.");
          }
        } catch {
          // Failed, cancelled and unknown outcomes deliberately retain both cart and marker.
        }
      }
      if (controller.signal.aborted || !mountedRef.current || getCustomerId(getUser()) !== customerId) return;
      setOrders(list);
      if (list.some((o) => ACTIVE_STATUSES.includes(o.status))) setTab("active");
    } catch (e: any) {
      if (controller.signal.aborted || !mountedRef.current) return;
      setError(e.message);
    } finally {
      if (!controller.signal.aborted && mountedRef.current) setLoading(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [clear]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    const onSessionChange = () => {
      setOrders([]);
      setShown(8);
      load();
    };
    window.addEventListener(CUSTOMER_SESSION_EVENT, onSessionChange);
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
      requestRef.current = null;
      window.removeEventListener(CUSTOMER_SESSION_EVENT, onSessionChange);
    };
  }, [load]);

  const isActive = (o: any) => ACTIVE_STATUSES.includes(o.status);
  const counts = {
    active: orders.filter(isActive).length,
    past: orders.filter((o) => !isActive(o)).length,
    all: orders.length,
  };
  const list = orders.filter((o) => (tab === "all" ? true : tab === "active" ? isActive(o) : !isActive(o)));

  const reorder = (o: any) => {
    const items = (o.items || []).map((i: any) => ({
      menuItemId: i.menuItemId,
      name: i.name,
      price: i.price,
      quantity: i.quantity,
      image: i.menuItem?.imageUrl || i.imageUrl,
      restaurantId: o.businessId,
      restaurantName: o.business?.name || "Restaurant",
    }));
    if (!items.length) return;
    replaceAll(items);
    router.push("/customer/cart");
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Orders" subtitle="Track what's on its way and revisit past meals." />

      <div role="tablist" className="mb-5 inline-flex rounded-full bg-mint-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setShown(8);
            }}
            className={cn(
              "flex h-10 items-center gap-2 rounded-full px-4 text-sm font-bold transition",
              tab === t.id ? "bg-card text-primary shadow-sm" : "text-muted-foreground",
            )}
          >
            {t.label}
            {counts[t.id] > 0 && (
              <span className={cn("grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px]", t.id === "active" ? "bg-cta text-cta-foreground" : "bg-mint-200 text-mint-800")}>
                {counts[t.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <RowSkeleton rows={4} />
      ) : error ? (
        <ErrorState title="We couldn't load your orders" message={error} onRetry={load} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={tab === "active" ? "No orders in progress" : "No orders yet"}
          body={tab === "active" ? "When you place an order you can follow it here." : "Your order history will show up here."}
          action={{ label: "Find something to eat", href: "/customer" }}
        />
      ) : (
        <>
          <ul className="space-y-3">
            {list.slice(0, shown).map((o) => (
              <li key={o.id} className="overflow-hidden rounded-3xl border border-border bg-card shadow-card">
                <Link href={`/customer/dashboard/orders/${o.id}`} className="block p-4 transition hover:bg-mint-50/50 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display truncate text-lg font-bold">{o.business?.name || "Restaurant"}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {format(new Date(o.createdAt), "d MMM, h:mm a")} · {o.items?.length || 0} item{(o.items?.length || 0) === 1 ? "" : "s"}
                      </p>
                    </div>
                    <StatusPill status={o.status} />
                  </div>
                  {o.items?.length > 0 && (
                    <p className="mt-3 line-clamp-1 text-sm text-muted-foreground">
                      {o.items.map((i: any) => `${i.quantity}× ${i.name}`).join(", ")}
                    </p>
                  )}
                  <div className="mt-3 flex items-center justify-between">
                    <span className="font-extrabold">{naira(o.total)}</span>
                    <span className="flex items-center gap-1 text-sm font-bold text-primary">
                      {isActive(o) ? (<><MapPin className="h-4 w-4" /> Track order</>) : "Details"}
                      <ChevronRight className="h-4 w-4" />
                    </span>
                  </div>
                </Link>
                {!isActive(o) && o.status === "delivered" && (
                  <button
                    onClick={() => reorder(o)}
                    className="flex w-full items-center justify-center gap-2 border-t border-border py-3 text-sm font-bold text-primary transition hover:bg-mint-50"
                  >
                    <RotateCcw className="h-4 w-4" /> Order again
                  </button>
                )}
              </li>
            ))}
          </ul>
          {list.length > shown && (
            <button
              onClick={() => setShown((n) => n + 8)}
              className="mx-auto mt-5 flex h-11 items-center rounded-full border border-border bg-card px-6 text-sm font-bold transition hover:bg-mint-50"
            >
              Show more
            </button>
          )}
        </>
      )}
    </div>
  );
}
