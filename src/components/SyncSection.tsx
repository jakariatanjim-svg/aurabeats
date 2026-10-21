/**
 * Settings → Device sync. Copies your library, history and searches from one
 * device to another, no account needed (see services/deviceSync).
 *
 *  Nearby:  same Wi-Fi, no code. Open it on both, tap the other device's
 *           name, accept on the other one.
 *  Send:    shows a code + QR (valid 10 minutes, while the window is open).
 *  Receive: type / paste / scan the code, see what's coming, Merge or Replace.
 *
 * A link with ?sync=CODE (what the QR holds) opens Receive with the code in.
 */
import { useEffect, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ClipboardPaste,
  Copy,
  Link2,
  Loader2,
  MonitorSmartphone,
  Pencil,
  ScanLine,
  Send,
  Wifi,
  X,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { storage } from "@/utils/storage";
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
  startNearby,
  startReceiver,
  startSender,
  type Nearby,
  type NearbyPeer,
  type ReceiverStatus,
  type SenderStatus,
} from "@/services/deviceSync";

const SITE = "https://aurabeats.pages.dev";
const NAME_KEY = "sync:name";
const myName = () => storage.get<string>(NAME_KEY, "") || deviceName(isNative);
const payload = async () => {
  const data = collectData(true);
  return { data, summary: summarize(data) };
};

/** ?sync=CODE from a shared link / QR (read once, then removed from the address bar). */
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
  const [mode, setMode] = useState<"nearby" | "send" | "receive" | null>(null);
  const [linkCode] = useState(takeLinkCode);
  useEffect(() => {
    if (linkCode) setMode("receive");
  }, [linkCode]);

  return (
    <section>
      <SectionHeader title="Device sync" icon={<MonitorSmartphone className="h-4 w-4 text-accent" />} />
      <div className="blur-panel space-y-3 p-4">
        <p className="text-[12px] leading-relaxed text-ink3">
          Bring your favourites, playlists, listening and watch history, searches and follows to another phone or PC, no account needed. On the{" "}
          <b className="text-ink2">same Wi-Fi</b>, open <b className="text-ink2">Nearby</b> on both and tap the other device. Anywhere else, tap{" "}
          <b className="text-ink2">Send</b> on the device that has your data and <b className="text-ink2">Receive</b> on the other, then type or scan the
          code.
        </p>
        <Button onClick={() => setMode("nearby")} className="w-full">
          <Wifi className="h-4 w-4" /> Nearby devices
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => setMode("send")} className="justify-center">
            <ArrowUpFromLine className="h-4 w-4" /> Send with code
          </Button>
          <Button variant="outline" onClick={() => setMode("receive")} className="justify-center">
            <ArrowDownToLine className="h-4 w-4" /> Receive
          </Button>
        </div>
      </div>
      <NearbyModal open={mode === "nearby"} onClose={() => setMode(null)} />
      <SendModal open={mode === "send"} onClose={() => setMode(null)} />
      <ReceiveModal open={mode === "receive"} initialCode={linkCode} onClose={() => setMode(null)} />
    </section>
  );
}

/* -------------------------------- nearby --------------------------------- */

type Outgoing = { peer: NearbyPeer; st: SenderStatus | { phase: "asking" } | { phase: "declined" } | { phase: "noanswer" } };

function NearbyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState(myName);
  const [editing, setEditing] = useState(false);
  const [phase, setPhase] = useState<"connecting" | "ready" | "error">("connecting");
  const [error, setError] = useState("");
  const [peers, setPeers] = useState<NearbyPeer[]>([]);
  const [incoming, setIncoming] = useState<NearbyPeer | null>(null);
  const [out, setOut] = useState<Outgoing | null>(null);
  const [recv, setRecv] = useState<ReceiverStatus | null>(null);
  const nearby = useRef<Nearby | null>(null);
  const stopTransfer = useRef<() => void>(() => {});
  const askTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!open) return;
    setPhase("connecting");
    setPeers([]);
    setIncoming(null);
    setOut(null);
    setRecv(null);
    const n = startNearby(name, (e) => {
      if (e.type === "status") setPhase(e.phase);
      else if (e.type === "error") {
        setPhase("error");
        setError(e.message);
      } else if (e.type === "peers") setPeers(e.peers);
      else if (e.type === "offer") setIncoming(e.from);
      else if (e.type === "declined") {
        clearTimeout(askTimer.current);
        setOut((o) => (o && o.peer.id === e.by.id ? { ...o, st: { phase: "declined" } } : o));
      } else if (e.type === "accepted") {
        clearTimeout(askTimer.current);
        stopTransfer.current();
        stopTransfer.current = startSender(name, payload, (st) => setOut({ peer: e.by, st }), e.code);
      }
    });
    nearby.current = n;
    return () => {
      clearTimeout(askTimer.current);
      stopTransfer.current();
      n.stop();
      nearby.current = null;
    };
    // the name is applied on the next open (or right away via `run`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, run]);

  const sendTo = (p: NearbyPeer) => {
    nearby.current?.offer(p.id);
    setOut({ peer: p, st: { phase: "asking" } });
    clearTimeout(askTimer.current);
    askTimer.current = setTimeout(() => setOut((o) => (o?.st.phase === "asking" ? { ...o, st: { phase: "noanswer" } } : o)), 30_000);
  };
  const accept = async (p: NearbyPeer) => {
    setIncoming(null);
    try {
      const code = await nearby.current!.accept(p.id);
      stopTransfer.current();
      stopTransfer.current = startReceiver(code, name, setRecv);
    } catch (e) {
      setRecv({ phase: "error", message: e instanceof Error ? e.message : "That device is gone." });
    }
  };
  const saveName = (v: string) => {
    const n = v.trim().slice(0, 32);
    storage.set(NAME_KEY, n);
    setName(n || deviceName(isNative));
    setEditing(false);
    setRun((r) => r + 1); // re-announce with the new name
  };

  const body = () => {
    if (recv?.phase === "received") return <ReceivedPanel st={recv} />;
    if (recv)
      return (
        <div className="space-y-3 py-2 text-center">
          {recv.phase === "error" ? (
            <p className="text-[13px] font-semibold text-rose-500">{recv.message}</p>
          ) : (
            <>
              <Busy small text={recv.phase === "receiving" ? `Receiving from ${recv.device}…` : "Connecting…"} />
              {recv.phase === "receiving" && <Progress value={recv.progress} />}
            </>
          )}
          <Button variant="ghost" className="text-xs" onClick={() => (stopTransfer.current(), setRecv(null))}>
            Back to devices
          </Button>
        </div>
      );
    if (out)
      return (
        <div className="space-y-3 py-2 text-center">
          {out.st.phase === "asking" && <Busy small text={`Waiting for ${out.peer.name} to accept…`} />}
          {out.st.phase === "declined" && <p className="text-[13px] font-semibold text-rose-500">{out.peer.name} said no.</p>}
          {out.st.phase === "noanswer" && <p className="text-[13px] font-semibold text-rose-500">{out.peer.name} didn't answer.</p>}
          {(out.st.phase === "connecting" || out.st.phase === "waiting") && <Busy small text="Connecting…" />}
          {(out.st.phase === "sending" || out.st.phase === "sent") && <SendState st={out.st} />}
          {out.st.phase === "error" && <p className="text-[13px] font-semibold text-rose-500">{out.st.message}</p>}
          <Button variant="ghost" className="text-xs" onClick={() => (stopTransfer.current(), setOut(null))}>
            {out.st.phase === "sent" ? "Done" : "Back to devices"}
          </Button>
        </div>
      );
    return (
      <div className="space-y-3">
        {incoming && (
          <div className="animate-fade-up rounded-2xl border border-accent/40 bg-accent/10 p-3">
            <p className="text-[13px] font-bold text-ink">
              <span className="text-accent">{incoming.name}</span> wants to send you its data
            </p>
            <p className="mt-0.5 text-[11px] text-ink3">You'll see what's in it and choose Merge or Replace.</p>
            <div className="mt-2.5 flex gap-2">
              <Button className="flex-1" onClick={() => void accept(incoming)}>
                Accept
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  nearby.current?.decline(incoming.id);
                  setIncoming(null);
                }}
              >
                Decline
              </Button>
            </div>
          </div>
        )}
        {phase === "error" ? (
          <div className="space-y-3 py-3 text-center">
            <p className="text-[13px] font-semibold text-rose-500">{error}</p>
            <Button variant="outline" onClick={() => setRun((r) => r + 1)}>
              Try again
            </Button>
          </div>
        ) : phase === "connecting" ? (
          <Busy text="Getting ready…" />
        ) : peers.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-5 text-center">
            <span className="relative flex h-12 w-12 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-accent/20" />
              <Wifi className="relative h-6 w-6 text-accent" />
            </span>
            <p className="text-[13px] font-bold text-ink2">Looking for devices…</p>
            <p className="max-w-[16rem] text-[11px] text-ink3">Open Settings → Device sync → Nearby on the other device too, on the same Wi-Fi.</p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {peers.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => sendTo(p)}
                  className="focus-ring flex w-full items-center gap-3 rounded-2xl border border-line bg-ink/[0.02] px-3 py-2.5 text-left transition hover:border-accent active:scale-[0.99]"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
                    <MonitorSmartphone className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">{p.name}</span>
                  <span className="inline-flex items-center gap-1 text-[12px] font-bold text-accent">
                    <Send className="h-3.5 w-3.5" /> Send
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Nearby devices" maxWidth="max-w-sm">
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-2xl bg-ink/[0.03] px-3 py-2 text-[12px] text-ink3">
          <span className="shrink-0">This device:</span>
          {editing ? (
            <input
              autoFocus
              defaultValue={name}
              maxLength={32}
              onBlur={(e) => saveName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className="min-w-0 flex-1 rounded-lg border border-accent bg-transparent px-2 py-0.5 text-[12px] font-bold text-ink outline-none"
            />
          ) : (
            <>
              <b className="min-w-0 flex-1 truncate text-ink2">{name}</b>
              <button type="button" aria-label="Rename this device" data-tip="Rename" onClick={() => setEditing(true)} className="text-ink3 hover:text-accent">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
        {body()}
      </div>
    </Modal>
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

function Qr({ text }: { text: string }) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c},${r}h1v1h-1z`;
  return (
    <svg viewBox={`-2 -2 ${n + 4} ${n + 4}`} className="mx-auto h-40 w-40 rounded-2xl bg-white" shapeRendering="crispEdges" role="img" aria-label="QR code">
      <path d={d} fill="#000" />
    </svg>
  );
}

function SendModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = usePlayer();
  const [st, setSt] = useState<SenderStatus | null>(null);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!open) return;
    setSt(null);
    return startSender(myName(), payload, setSt);
  }, [open, run]);

  const code = st && "code" in st ? st.code : "";
  const left = useCountdown(st && "expiresAt" in st ? st.expiresAt : null);
  const link = `${SITE}/settings?sync=${code}`;
  const copy = (text: string, what: string) =>
    void navigator.clipboard?.writeText(text).then(
      () => toast(`${what} copied`, "success"),
      () => toast("Couldn't copy", "error"),
    );

  return (
    <Modal open={open} onClose={onClose} title="Send to another device" maxWidth="max-w-sm">
      <div className="space-y-3.5 text-center">
        {!st && <Busy text="Making a code…" />}
        {st?.phase === "error" && <Problem text={st.message} onRetry={() => setRun((n) => n + 1)} />}
        {st?.phase === "expired" && <Problem text="The code expired." onRetry={() => setRun((n) => n + 1)} retryLabel="New code" />}
        {code && (
          <>
            <p className="text-[12px] text-ink3">On the other device: Settings → Device sync → Receive. Type the code or scan it.</p>
            <button
              type="button"
              onClick={() => copy(code, "Code")}
              data-tip="Tap to copy"
              className="focus-ring mx-auto block rounded-2xl border border-line bg-ink/[0.03] px-5 py-2.5 font-mono text-3xl font-black tracking-[0.18em] text-ink tabular-nums transition active:scale-[0.98] sm:text-4xl"
            >
              {prettyCode(code)}
            </button>
            <Qr text={link} />
            <div className="flex items-center justify-center gap-2">
              <Button variant="ghost" className="text-xs" onClick={() => copy(code, "Code")}>
                <Copy className="h-3.5 w-3.5" /> Copy code
              </Button>
              <Button variant="ghost" className="text-xs" onClick={() => copy(link, "Link")}>
                <Link2 className="h-3.5 w-3.5" /> Copy link
              </Button>
            </div>
            {st?.phase === "connecting" ? <Busy small text="Connecting…" /> : st && <SendState st={st} />}
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

function ReceivedPanel({ st }: { st: Extract<ReceiverStatus, { phase: "received" }> }) {
  const apply = async (how: "merge" | "replace") => {
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
  return (
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
  );
}

const canScan = typeof window !== "undefined" && "BarcodeDetector" in window && Boolean(navigator.mediaDevices?.getUserMedia);

function ReceiveModal({ open, initialCode, onClose }: { open: boolean; initialCode: string; onClose: () => void }) {
  const { toast } = usePlayer();
  const [code, setCode] = useState(initialCode);
  const [st, setSt] = useState<ReceiverStatus | null>(null);
  const [scanning, setScanning] = useState(false);
  const stopRef = useRef<() => void>(() => {});
  const inputRef = useRef<HTMLInputElement>(null);

  const connect = (c = code) => {
    if (c.length !== CODE_LEN) return;
    stopRef.current();
    stopRef.current = startReceiver(c, myName(), setSt);
  };
  useEffect(() => {
    if (!open) return;
    setSt(null);
    setScanning(false);
    if (initialCode) setCode(initialCode);
    // a full code from a link / QR connects by itself
    if (initialCode.length === CODE_LEN) connect(initialCode);
    const t = setTimeout(() => !initialCode && inputRef.current?.focus(), 250);
    return () => {
      clearTimeout(t);
      stopRef.current();
    };
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

  const busy = st && (st.phase === "connecting" || st.phase === "searching" || st.phase === "receiving");

  return (
    <Modal open={open} onClose={onClose} title="Receive from another device" maxWidth="max-w-sm">
      {st?.phase === "received" ? (
        <ReceivedPanel st={st} />
      ) : scanning ? (
        <Scanner
          onCode={(c) => {
            setScanning(false);
            setCode(c);
            connect(c);
          }}
          onCancel={() => setScanning(false)}
        />
      ) : (
        <div className="space-y-4">
          <p className="text-[12px] text-ink3">Type the code shown on the sending device{canScan ? ", or scan its QR" : ""}.</p>
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
              <Button
                variant="ghost"
                className="text-xs"
                onClick={() => {
                  stopRef.current();
                  setSt(null);
                }}
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </Button>
            </div>
          ) : (
            <>
              {st?.phase === "error" && <p className="text-center text-[12px] font-semibold text-rose-500">{st.message}</p>}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void paste()} className="shrink-0 px-3" aria-label="Paste">
                  <ClipboardPaste className="h-4 w-4" /> <span className="hidden min-[380px]:inline">Paste</span>
                </Button>
                {canScan && (
                  <Button variant="outline" onClick={() => setScanning(true)} className="shrink-0 px-3" aria-label="Scan QR">
                    <ScanLine className="h-4 w-4" /> <span className="hidden min-[380px]:inline">Scan</span>
                  </Button>
                )}
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

/* QR scanner: the browser's own detector (Chrome / Android), back camera. */
interface Detector {
  detect(src: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
function Scanner({ onCode, onCancel }: { onCode: (c: string) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState("");
  const found = useRef(onCode);
  found.current = onCode;
  useEffect(() => {
    let stream: MediaStream | null = null;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (!alive) return stream.getTracks().forEach((t) => t.stop());
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        const det = new Ctor({ formats: ["qr_code"] });
        const tick = async () => {
          if (!alive) return;
          const hits = await det.detect(v).catch(() => []);
          for (const f of hits) {
            let raw = f.rawValue;
            try {
              raw = new URL(raw).searchParams.get("sync") ?? raw;
            } catch {
              /* plain code */
            }
            const c = cleanCode(raw);
            if (c.length === CODE_LEN) return found.current(c);
          }
          timer = setTimeout(() => void tick(), 250);
        };
        void tick();
      } catch {
        if (alive) setErr("Couldn't open the camera. Allow camera access, or type the code.");
      }
    })();
    return () => {
      alive = false;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return (
    <div className="space-y-3 text-center">
      {err ? (
        <p className="py-6 text-[13px] font-semibold text-rose-500">{err}</p>
      ) : (
        <div className="relative mx-auto aspect-square w-full max-w-[16rem] overflow-hidden rounded-2xl bg-black">
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
          <span className="pointer-events-none absolute inset-6 rounded-2xl border-2 border-white/80" />
        </div>
      )}
      <p className="text-[12px] text-ink3">Point the camera at the QR on the sending device.</p>
      <Button variant="ghost" className="text-xs" onClick={onCancel}>
        Type the code instead
      </Button>
    </div>
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
