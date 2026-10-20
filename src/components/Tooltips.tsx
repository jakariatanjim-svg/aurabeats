/**
 * One app-wide tooltip (YouTube-style): hover anything with `data-tip`, a
 * native `title`, or an icon-only button with an `aria-label`, and a small
 * label appears after a short delay. Explanations live here instead of as
 * text on the page. Mouse / trackpad only — touch screens never show it.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const SELECTOR = "[data-tip],[title],button[aria-label],[role=tab][aria-label]";
const DELAY = 450;

interface Tip {
  text: string;
  x: number;
  y: number;
  below: boolean;
  host: Element;
}

function textOf(el: Element): string | null {
  // Native tooltips would show twice — move them over once.
  const native = el.getAttribute("title");
  if (native !== null) {
    if (native && !el.hasAttribute("data-tip")) el.setAttribute("data-tip", native);
    el.removeAttribute("title");
  }
  const tip = el.getAttribute("data-tip");
  if (tip) return tip;
  const label = el.getAttribute("aria-label");
  if (label && !el.textContent?.trim()) return label;
  return null;
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) return;
    let current: Element | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hide = () => {
      clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const onOver = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.(SELECTOR) ?? null;
      if (el === current) return;
      hide();
      if (!el || el.closest("[data-tip-off]")) return;
      const text = textOf(el);
      if (!text) return;
      current = el;
      timer = setTimeout(() => {
        if (current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const below = r.top < 64;
        setShift(0);
        setTip({
          text,
          x: r.left + r.width / 2,
          y: below ? r.bottom + 8 : r.top - 8,
          below,
          host: document.fullscreenElement ?? document.body,
        });
      }, DELAY);
    };
    const onOut = (e: MouseEvent) => {
      if (!current) return;
      const to = e.relatedTarget as Node | null;
      if (!to || !current.contains(to)) hide();
    };
    window.addEventListener("mouseover", onOver, true);
    window.addEventListener("mouseout", onOut, true);
    window.addEventListener("mousedown", hide, true);
    window.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      window.removeEventListener("mouseover", onOver, true);
      window.removeEventListener("mouseout", onOut, true);
      window.removeEventListener("mousedown", hide, true);
      window.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // Keep the label on screen near the edges.
  useEffect(() => {
    const b = boxRef.current?.getBoundingClientRect();
    if (!b) return;
    if (b.left < 8) setShift(8 - b.left);
    else if (b.right > window.innerWidth - 8) setShift(window.innerWidth - 8 - b.right);
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={boxRef}
      role="tooltip"
      className="pointer-events-none fixed z-[300] max-w-[18rem] animate-fade-in rounded-lg bg-[rgb(36_36_40/0.94)] px-2.5 py-1.5 text-[12px] leading-snug font-medium text-white shadow-lg ring-1 ring-white/10"
      style={{
        left: tip.x + shift,
        top: tip.y,
        transform: `translate(-50%, ${tip.below ? "0" : "-100%"})`,
      }}
    >
      {tip.text}
    </div>,
    tip.host,
  );
}
