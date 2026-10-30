import { cn } from "@/lib/utils";

/**
 * The OyaEat logo. `light` is for light backgrounds, `white` for dark or green ones.
 * `layout="stacked"` is the tall version with the tagline, for big hero spots.
 * Size it with height (e.g. className="h-9"); the width follows the artwork.
 */
export default function Logo({
  variant = "light",
  layout = "horizontal",
  className,
}: {
  variant?: "light" | "white";
  layout?: "horizontal" | "stacked";
  className?: string;
}) {
  const base = layout === "stacked" ? "oyaeat-stacked" : "oyaeat-logo";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/brand/${base}${variant === "white" ? "-white" : ""}.png`}
      alt="OyaEat"
      className={cn("h-9 w-auto select-none", className)}
      draggable={false}
    />
  );
}
