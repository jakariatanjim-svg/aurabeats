import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";

/**
 * A pop-up that always shows above everything — including the video player,
 * which floats over the page at body level. Rendered into <body>, placed
 * under its anchor and kept there while the page scrolls or resizes.
 */
export function Floating({
  anchor,
  align = "stretch",
  gap = 8,
  className,
  children,
  layerRef,
}: {
  anchor: RefObject<HTMLElement | null>;
  /** stretch = same width as the anchor; right = right edges aligned */
  align?: "stretch" | "right";
  gap?: number;
  className?: string;
  children: ReactNode;
  layerRef?: RefObject<HTMLDivElement | null>;
}) {
  const [box, setBox] = useState<{ top: number; left: number; right: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (r) setBox({ top: Math.round(r.bottom + gap), left: Math.round(r.left), right: Math.round(window.innerWidth - r.right), width: Math.round(r.width) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, gap]);
  if (!box) return null;
  return createPortal(
    <div
      ref={layerRef}
      className={cn("fixed z-[120]", className)}
      style={align === "stretch" ? { top: box.top, left: box.left, width: box.width } : { top: box.top, right: box.right }}
    >
      {children}
    </div>,
    document.body,
  );
}
