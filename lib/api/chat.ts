import { type Thread, type Message } from "@/lib/types/chat";
import { getRoleToken } from "@/lib/roleSession";
import { getToken as getCustomerToken } from "@/lib/customer";

const API = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000";

function authHeaders(role: "customer" | "admin" | "vendor" | "rider"): HeadersInit {
  if (typeof window === "undefined")
    return { "Content-Type": "application/json" };

  const token = role === "customer" ? getCustomerToken() : getRoleToken(role);

  if (!token) {
    console.warn(
      `[Chat Auth] No ${role} session is active in this tab.`,
    );
    return { "Content-Type": "application/json" };
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export const chatApi = {
  getThreads: async (
    role: "customer" | "admin" | "vendor" | "rider",
  ): Promise<any> => {
    const res = await fetch(`${API}/chat/threads`, {
      headers: authHeaders(role),
    });
    if (!res.ok) throw new Error("Failed to fetch threads");
    return res.json();
  },

  createSupportThread: async (
    role: "customer" | "admin" | "vendor" | "rider",
    subject: string,
    threadType: string = "support",
  ): Promise<any> => {
    const res = await fetch(`${API}/chat/threads`, {
      method: "POST",
      headers: authHeaders(role),
      body: JSON.stringify({ subject, type: threadType }),
    });
    if (!res.ok) throw new Error("Failed to create thread");
    return res.json();
  },

  getMessages: async (
    role: "customer" | "admin" | "vendor" | "rider",
    threadId: string,
  ): Promise<any> => {
    const res = await fetch(`${API}/chat/threads/${threadId}/messages`, {
      headers: authHeaders(role),
    });
    if (!res.ok) throw new Error("Failed to fetch messages");
    return res.json();
  },

  sendMessage: async (
    role: "customer" | "admin" | "vendor" | "rider",
    threadId: string,
    content: string,
  ): Promise<any> => {
    const res = await fetch(`${API}/chat/threads/${threadId}/messages`, {
      method: "POST",
      headers: authHeaders(role),
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error("Failed to send message");
    return res.json();
  },

  // 🚀 EXPLICIT TYPE SIGNATURE: Resolves toggleThreadStatus error
  toggleThreadStatus: async (
    role: "customer" | "admin" | "vendor" | "rider",
    threadId: string,
    status: "open" | "closed",
  ): Promise<any> => {
    const res = await fetch(`${API}/chat/threads/${threadId}/status`, {
      method: "PATCH",
      headers: authHeaders(role),
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error("Failed to update thread status");
    return res.json();
  },

  // 🚀 EXPLICIT TYPE SIGNATURE: Resolves deleteThread error
  deleteThread: async (
    role: "customer" | "admin" | "vendor" | "rider",
    threadId: string,
  ): Promise<any> => {
    const res = await fetch(`${API}/chat/threads/${threadId}`, {
      method: "DELETE",
      headers: authHeaders(role),
    });
    if (!res.ok) throw new Error("Failed to delete thread");
    return res.json();
  },

  getRiderAlerts: async (): Promise<any> => {
    const token = getRoleToken("rider");

    const res = await fetch(`${API}/chat/operations-alerts`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) throw new Error("Failed to fetch operations alerts");
    return res.json();
  },
};
