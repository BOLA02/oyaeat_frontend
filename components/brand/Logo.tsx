import { cn } from "@/lib/utils";

/** Shared OyaEat artwork extracted from the authoritative supplied asset. */
export default function Logo({
  variant: _variant = "light",
  mark = "full",
  className,
}: {
  variant?: "light" | "white";
  mark?: "full" | "symbol";
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={mark === "symbol" ? "/images/oyaeat-icon.png" : "/images/oyaeat-logo.png"}
      alt="OyaEat"
      className={cn("h-9 w-auto select-none", className)}
      draggable={false}
    />
  );
}
