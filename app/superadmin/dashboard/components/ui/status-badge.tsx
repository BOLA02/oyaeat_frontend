"use client";

import { Check, X, PauseCircle } from "lucide-react";

export const statusConfig = {
  suspended: {
    icon: PauseCircle,
    color: "#c94d00",
    bg: "#fff1e4",
    label: "Suspended",
  },
  approved: { icon: Check, color: "#138a4b", bg: "#dcfce7", label: "Approved" },
  rejected: { icon: X, color: "#c8372d", bg: "#FDECEA", label: "Rejected" },
};

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const cfg =
    statusConfig[status as keyof typeof statusConfig] ?? statusConfig.suspended;
  const StatusIcon = cfg.icon;

  return (
    <div className="flex items-center justify-end gap-1.5">
      <div
        className="flex h-6 w-6 items-center justify-center rounded-full"
        style={{ backgroundColor: cfg.bg }}
      >
        <StatusIcon className="h-3.5 w-3.5" style={{ color: cfg.color }} />
      </div>
      <span className="text-sm font-bold" style={{ color: cfg.color }}>
        {cfg.label}
      </span>
    </div>
  );
}
