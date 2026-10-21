/**
 * Settings → Device sync. Copies your library from one device to another
 * with a one-time code, no account needed (see services/deviceSync).
 *
 *  Send:    shows a code (valid 10 minutes, only while the window is open).
 *  Receive: type / paste the code, see what's coming, then Merge or Replace.
 *
 * A link with ?sync=CODE opens Receive with the code filled in.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Check, ClipboardPaste, Copy, Link2, Loader2, MonitorSmartphone, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { Button, Modal, SectionHeader } from "@/components/ui";
import { usePlayer } from "@/hooks/usePlayer";
import { isNative } from "@/services/video/net";
import { confirmAction } from "@/components/Confirm";
import { applyMerge, applyReplace, collectData, summarize } from "@/utils/backup";
import {
  CODE_LEN,
  cleanCode,
  deviceName,
  prettyCode,
  startReceiver,
  startSender,
  type ReceiverStatus,
  type SenderStatus,
} from "@/services/deviceSync";

const SITE = "https://aurabeats.pages.dev";

/** ?sync=CODE from a shared link (read once, then removed from the address bar). */
function takeLinkCode(): string {
  try {
    const url = new URL(window.location.href);
    const c = url.searchParams.get("sync");
    if (!c) return "";
    url.searchParams.delete("sync");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    return cleanCode(c);
  } catch {
    return "";
  }
}

export function SyncSection() {
  const [mode, setMode] = useState<"send" | "receive" | null>(null);
  const [linkCode] = useState(takeLinkCode);
  useEffect(() => {
    if (linkCode) setMode("receive");
  }, [linkCode]);

  return (
    <section>
      <SectionHeader title="Device sync" icon={<MonitorSmartphone className="h-4 w-4 text-accent" />} />
      <div className="blur-panel space-y-3 p-4">
        <p className="text-[12px] leading-relaxed text-ink3">
          Copy your favourites, playlists, history and follows to another phone or PC, no account needed. Tap <b className="text-ink2">Send</b> on the
          device that has your data, then <b className="text-ink2">Receive</b> on the other one and type the code it shows. Keep both online.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => setMode("send")} className="justify-center">
            <ArrowUpFromLine className="h-4 w-4" /> Send
          </Button>
          <Button variant="outline" onClick={() => setMode("receive")} className="justify-center">
            <ArrowDownToLine className="h-4 w-4" /> Receive
          </Button>
        </div>
      </div>
      <SendModal open={mode === "send"} onClose={() => setMode(null)} />
      <ReceiveModal open={mode === "receive"} initialCode={linkCode} onClose={() => setMode(null)} />
    </section>
  );
}

/* --------------------------------- send ---------------------------------- */

function useCountdown(until: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return "";
  const s = Math.max(0, Math.round((until - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function SendModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = usePlayer();
  const [st, setSt] = useState<SenderStatus>({ phase: "connecting" });
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!open) return;
    setSt({ phase: "connecting" });
    const stop = startSender(
      deviceName(isNative),
      async () => {
        const data = collectData(true);
        return { data, summary: summarize(data) };
      },
      setSt,
    );
    return stop;
  }, [open, run]);

  const code = "code" in st ? st.code : "";
  const left = useCountdown("expiresAt" in st ? st.expiresAt : null);
  const copy = (text: string, what: string) =>
    void navigator.clipboard?.writeText(text).then(
      () => toast(`${what} copied`, "success"),
      () => toast("Couldn't copy", "error"),
    );

  return (
    <Modal open={open} onClose={onClose} title="Send to another device" maxWidth="max-w-sm">
      <div className="space-y-4 text-center">
        {st.phase === "connecting" && <Busy text="Getting a code…" />}
        {st.phase === "error" && <Problem text={st.message} onRetry={() => setRun((n) => n + 1)} />}
        {st.phase === "expired" && <Problem text="The code expired." onRetry={() => setRun((n) => n + 1)} retryLabel="New code" />}
        {code && (
          <>
            <p className="text-[12px] text-ink3">On the other device: Settings → Device sync → Receive, and type</p>
            <button
              type="button"
              onClick={() => copy(code, "Code")}
              data-tip="Tap to copy"
              className="focus-ring mx-auto block rounded-2xl border border-line bg-ink/[0.03] px-5 py-3 font-mono text-3xl font-black tracking-[0.18em] text-ink tabular-nums transition active:scale-[0.98] sm:text-4xl"
            >
              {prettyCode(code)}
            </button>
            <div className="flex items-center justify-center gap-2">
              <Button variant="ghost" className="text-xs" onClick={() => copy(code, "Code")}>
                <Copy className="h-3.5 w-3.5" /> Copy code
              </Button>
              <Button variant="ghost" className="text-xs" onClick={() => copy(`${SITE}/settings?sync=${code}`, "Link")}>
                <Link2 className="h-3.5 w-3.5" /> Copy link
              </Button>
            </div>
            <SendState st={st} />
            <p className="text-[11px] text-ink3">
              Keep this window open · code works for <span className="font-bold text-ink2 tabular-nums">{left}</span>
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

function SendState({ st }: { st: SenderStatus }) {
  if (st.phase === "waiting") return <Busy text="Waiting for the other device…" small />;
  if (st.phase === "sending")
    return (
      <div className="space-y-1.5">
        <p className="text-[12px] font-bold text-ink2">Sending to {st.device}…</p>
        <Progress value={st.progress} />
      </div>
    );
  if (st.phase === "sent")
    return (
      <p className="flex items-center justify-center gap-1.5 text-[13px] font-bold text-emerald-500">
        <Check className="h-4 w-4" /> Sent to {st.device}
      </p>
    );
  return null;
}

/* -------------------------------- receive -------------------------------- */

function ReceiveModal({ open, initialCode, onClose }: { open: boolean; initialCode: string; onClose: () => void }) {
  const { toast } = usePlayer();
  const [code, setCode] = useState(initialCode);
  const [st, setSt] = useState<ReceiverStatus | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    stopRef.current();
    setSt(null);
  };
  useEffect(() => {
    if (!open) return;
    setSt(null);
    if (initialCode) setCode(initialCode);
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => {
      clearTimeout(t);
      stopRef.current();
    };
  }, [open, initialCode]);

  const connect = (c = code) => {
    if (c.length !== CODE_LEN) return;
    stopRef.current();
    stopRef.current = startReceiver(c, deviceName(isNative), setSt);
  };
  // Auto-connect when a full code was pasted / came from a link.
  useEffect(() => {
    if (open && initialCode.length === CODE_LEN) connect(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialCode]);

  const paste = async () => {
    try {
      const c = cleanCode(await navigator.clipboard.readText());
      if (!c) return toast("No code on the clipboard", "error");
      setCode(c);
      if (c.length === CODE_LEN) connect(c);
    } catch {
      inputRef.current?.focus();
      toast("Paste it into the boxes", "info");
    }
  };

  const apply = async (how: "merge" | "replace") => {
    if (st?.phase !== "received") return;
    const data = st.data as Record<string, string>;
    if (how === "replace") {
      const ok = await confirmAction({
        title: "Replace this device's data?",
        message: `Favourites, playlists, history and settings here are replaced by the ones from ${st.device}.`,
        confirmLabel: "Replace",
        always: true,
      });
      if (!ok) return;
      applyReplace(data);
    } else applyMerge(data);
    window.location.reload();
  };

  const busy = st && (st.phase === "connecting" || st.phase === "searching" || st.phase === "receiving");

  return (
    <Modal open={open} onClose={onClose} title="Receive from another device" maxWidth="max-w-sm">
      {st?.phase === "received" ? (
        <div className="space-y-4">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-emerald-500">
            <Check className="h-4 w-4" /> Received from {st.device}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(st.summary).map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-line bg-ink/[0.02] px-3 py-2">
                <p className="text-base font-black text-ink tabular-nums">{v}</p>
                <p className="truncate text-[10px] text-ink3">{k}</p>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Button className="w-full" onClick={() => void apply("merge")}>
              Merge with this device
            </Button>
            <Button variant="ghost" className="w-full text-rose-500 hover:text-rose-400" onClick={() => void apply("replace")}>
              Replace this device's data
            </Button>
          </div>
          <p className="text-[11px] text-ink3">Merge keeps everything on both. Your YouTube sign-in and this device's volume stay as they are.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[12px] text-ink3">Type the code shown on the sending device.</p>
          <CodeBoxes
            inputRef={inputRef}
            value={code}
            disabled={Boolean(busy)}
            onChange={(c) => {
              setCode(c);
              if (st?.phase === "error") setSt(null);
            }}
            onDone={(c) => connect(c)}
          />
          {busy ? (
            <div className="space-y-2 text-center">
              <Busy
                small
                text={st.phase === "receiving" ? `Receiving from ${st.device}…` : st.phase === "searching" ? "Looking for the other device…" : "Connecting…"}
              />
              {st.phase === "receiving" && <Progress value={st.progress} />}
              <Button variant="ghost" className="text-xs" onClick={reset}>
                <X className="h-3.5 w-3.5" /> Cancel
              </Button>
            </div>
          ) : (
            <>
              {st?.phase === "error" && <p className="text-center text-[12px] font-semibold text-rose-500">{st.message}</p>}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void paste()} className="shrink-0">
                  <ClipboardPaste className="h-4 w-4" /> Paste
                </Button>
                <Button className="flex-1" disabled={code.length !== CODE_LEN} onClick={() => connect()}>
                  Connect
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/** One real input under eight boxes: typing, paste, backspace and the phone keyboard all just work. */
function CodeBoxes({
  value,
  onChange,
  onDone,
  disabled,
  inputRef,
}: {
  value: string;
  onChange: (c: string) => void;
  onDone: (c: string) => void;
  disabled?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="relative mx-auto w-full max-w-[20rem]">
      <div className="flex items-center justify-center gap-1.5" aria-hidden>
        {Array.from({ length: CODE_LEN }, (_, i) => {
          const active = focused && !disabled && (i === value.length || (i === CODE_LEN - 1 && value.length === CODE_LEN));
          return (
            <span key={i} className="contents">
              {i === 4 && <span className="w-1.5 text-ink3">-</span>}
              <span
                className={cn(
                  "flex h-11 w-8 items-center justify-center rounded-xl border font-mono text-xl font-black text-ink transition sm:h-12 sm:w-9",
                  active ? "border-accent ring-2 ring-accent/25" : value[i] ? "border-ink/25" : "border-line",
                  disabled && "opacity-60",
                )}
              >
                {value[i] ?? ""}
              </span>
            </span>
          );
        })}
      </div>
      <input
        ref={inputRef}
        value={value}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const c = cleanCode(e.target.value);
          onChange(c);
          if (c.length === CODE_LEN && c !== value) onDone(c);
        }}
        onKeyDown={(e) => e.key === "Enter" && value.length === CODE_LEN && onDone(value)}
        autoComplete="one-time-code"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        aria-label="Sync code"
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent opacity-0 outline-none"
      />
    </div>
  );
}

/* --------------------------------- bits ---------------------------------- */

function Busy({ text, small }: { text: string; small?: boolean }) {
  return (
    <p className={cn("flex items-center justify-center gap-2 text-ink3", small ? "text-[12px]" : "py-6 text-[13px]")}>
      <Loader2 className="h-4 w-4 animate-spin text-accent" /> {text}
    </p>
  );
}

function Progress({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
      <div className="h-full rounded-full bg-accent transition-all duration-200" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

function Problem({ text, onRetry, retryLabel = "Try again" }: { text: string; onRetry: () => void; retryLabel?: string }) {
  return (
    <div className="space-y-3 py-3">
      <p className="text-[13px] font-semibold text-rose-500">{text}</p>
      <Button variant="outline" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}
