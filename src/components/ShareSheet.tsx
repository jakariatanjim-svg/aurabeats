/**
 * Our own share pop-up (website): the link with a Copy button and a row of
 * places to send it, like YouTube's. The app keeps the phone's share sheet.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Mail, MessageCircle, Send } from "lucide-react";
import { Modal } from "@/components/ui";
import { isNative } from "@/services/video/net";
import { cn } from "@/utils/cn";

export interface ShareTarget {
  title?: string;
  url: string;
}

/** The app: the phone's share sheet. Website: returns false → show ShareSheet. */
export async function shareNative(t: ShareTarget): Promise<boolean> {
  if (!isNative || !navigator.share) return false;
  try {
    await navigator.share({ title: t.title, url: t.url });
  } catch {
    /* cancelled */
  }
  return true;
}

const XLogo = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);
const Letter = ({ c }: { c: string }) => <span className="text-[22px] leading-none font-black">{c}</span>;

export function ShareSheet({ open, onClose, target }: { open: boolean; onClose: () => void; target: ShareTarget }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (open) setCopied(false);
  }, [open]);
  const u = encodeURIComponent(target.url);
  const t = encodeURIComponent(target.title ?? "");
  const places: { name: string; href: string; bg: string; icon: ReactNode }[] = [
    { name: "WhatsApp", href: `https://wa.me/?text=${t ? `${t}%20` : ""}${u}`, bg: "bg-[#25d366]", icon: <MessageCircle className="h-6 w-6" /> },
    { name: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}`, bg: "bg-[#1877f2]", icon: <Letter c="f" /> },
    { name: "X", href: `https://x.com/intent/post?url=${u}&text=${t}`, bg: "bg-black ring-1 ring-white/20", icon: <XLogo /> },
    { name: "Telegram", href: `https://t.me/share/url?url=${u}&text=${t}`, bg: "bg-[#229ed9]", icon: <Send className="h-5 w-5 -translate-x-px" /> },
    { name: "Reddit", href: `https://www.reddit.com/submit?url=${u}&title=${t}`, bg: "bg-[#ff4500]", icon: <Letter c="r" /> },
    { name: "Email", href: `mailto:?subject=${t}&body=${u}`, bg: "bg-ink/40", icon: <Mail className="h-5 w-5" /> },
  ];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(target.url);
      setCopied(true);
    } catch {
      /* no clipboard */
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Share">
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {places.map((p) => (
          <a
            key={p.name}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setTimeout(onClose, 0)}
            className="group flex w-16 shrink-0 flex-col items-center gap-1.5 text-[12px] text-ink2"
          >
            <span className={cn("flex h-14 w-14 items-center justify-center rounded-full text-white transition group-hover:brightness-110 group-active:scale-95", p.bg)}>{p.icon}</span>
            {p.name}
          </a>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-xl border border-line bg-ink/[0.04] p-1.5 pl-3">
        <input
          readOnly
          value={target.url}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Link"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none"
        />
        <button
          type="button"
          onClick={() => void copy()}
          className="ab-btn-solid flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-bold text-white"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </Modal>
  );
}
