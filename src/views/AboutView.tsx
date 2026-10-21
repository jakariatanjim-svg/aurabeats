import { Archive, ArrowRight, Globe, Heart, Info, Mic2, Music2, Shield, ShieldCheck, Sparkles, Tv } from "lucide-react";
import { SectionHeader, WaveformLogo } from "@/components/ui";
import { isNative } from "@/services/video/net";
import { AdBadge, AdBlockSteps } from "@/components/video/AdBlockTip";

const SOURCES = [
  {
    icon: Tv,
    name: "YouTube",
    color: "text-red-500",
    bg: "bg-red-500/10",
    description: isNative
      ? "Every YouTube video, channel and live stream. The app plays them ad-free, straight from YouTube, up to 4K, and can download them."
      : "Every YouTube video, channel and live stream, in YouTube's official player with our own controls, miniplayer and theater mode.",
    type: "Video",
  },
  {
    icon: Music2,
    name: "YouTube Music",
    color: "text-rose-400",
    bg: "bg-rose-400/10",
    description: "The world's largest music catalog, with lyrics and related songs. Songs can be saved for offline listening in the app.",
    type: "Primary Source",
  },
  {
    icon: Music2,
    name: "JioSaavn",
    color: "text-orange-400",
    bg: "bg-orange-400/10",
    description: "Massive mainstream database covering Bollywood, regional, and international music. Delivers direct MP3 audio at up to 320 kbps.",
    type: "Licensed Database",
  },
  {
    icon: Mic2,
    name: "SoundCloud",
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    description: "Indie artists, underground remixes, and unique user-uploaded content. Essential for discovery and alternative versions.",
    type: "Creative Network",
  },
  {
    icon: Mic2,
    name: "Audius",
    color: "text-purple-400",
    bg: "bg-purple-400/10",
    description: "Open, decentralised artist network. Tracks are uploaded directly by artists and streamed peer-to-peer.",
    type: "Indie Network",
  },
  {
    icon: Heart,
    name: "Jamendo",
    color: "text-pink-400",
    bg: "bg-pink-400/10",
    description: "Independent music library under Creative Commons licenses. Artists release here for free sharing and exposure.",
    type: "Creative Commons",
  },
  {
    icon: Archive,
    name: "Internet Archive",
    color: "text-sky-400",
    bg: "bg-sky-400/10",
    description: "Public-domain recordings, live concerts, and historical audio. All available for free, forever.",
    type: "Public Domain",
  },
];

const PRINCIPLES = [
  {
    icon: Shield,
    title: "Privacy first",
    body: "No API keys, no accounts, and no tracking. Every request is anonymous and your preferences stay on your device.",
  },
  {
    icon: Sparkles,
    title: "Three looks",
    body: "Glassmorphism, Material UI and Liquid Glass, each in light and dark, with your own accent colour.",
  },
  {
    icon: WaveformLogo,
    title: "Full-length tracks",
    body: "AuraBeats never plays 30-second previews. Every track is a complete, full-length recording from the source network.",
  },
  {
    icon: Globe,
    title: "Zero data collection",
    body: "Your playlists, history, and downloads live exclusively in your own browser's storage. Clear everything anytime.",
  },
];

export function AboutView() {
  return (
    <div className="mx-auto max-w-5xl space-y-12 pb-10">
      <section className="text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-[#3b82f6] to-[#22d3ee] text-white shadow-2xl">
          <WaveformLogo className="h-8 w-8" />
        </div>
        <h1 className="text-4xl font-black tracking-tight text-ink sm:text-5xl">AuraBeats</h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-ink2 sm:text-lg">
          A multi-source streaming engine that aggregates the world's audio into one premium web experience. No sign-up. No ads. Just pure sound.
        </p>
      </section>

      <section id="about-sources">
        <SectionHeader
          showSubtitle
          title="Streaming sources"
          subtitle="Video and music from YouTube, plus independent audio networks"
          icon={<Sparkles className="h-4 w-4 text-accent" />}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SOURCES.map(({ icon: Icon, name, color, bg, description, type }) => (
            <div
              key={name}
              className="blur-panel glass-inset flex flex-col gap-4 rounded-[1.75rem] p-5"
            >
              <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${bg}`}>
                <Icon className={`h-5 w-5 ${color}`} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <p className="text-base font-black text-ink">{name}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${bg} ${color}`}>{type}</span>
                </div>
                <p className="text-sm leading-relaxed text-ink2">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="about-principles">
        <SectionHeader
          showSubtitle
          title="How it works"
          subtitle="The technology and values behind AuraBeats"
          icon={<Shield className="h-4 w-4 text-accent" />}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {PRINCIPLES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="blur-panel glass-inset flex gap-5 rounded-[1.75rem] p-6">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/10">
                <Icon className="h-5 w-5 text-accent" />
              </div>
              <div className="space-y-1.5">
                <p className="text-base font-bold text-ink">{title}</p>
                <p className="text-sm leading-relaxed text-ink2">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="about-engine" className="grid gap-4 sm:grid-cols-2">
        <div className="blur-panel glass-inset flex gap-5 rounded-[1.75rem] p-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/10">
            <Info className="h-5 w-5 text-accent" />
          </div>
          <div className="space-y-1.5">
            <p className="text-base font-bold text-ink">AuraBeats Sound Engine</p>
            <p className="text-sm leading-relaxed text-ink2">
              Aggregates millions of songs from global networks. Uses multi-resolver racing to keep playback stable, without tracking.
            </p>
          </div>
        </div>
        <div className="blur-panel glass-inset flex gap-5 rounded-[1.75rem] p-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/10">
            <Tv className="h-5 w-5 text-accent" />
          </div>
          <div className="space-y-1.5">
            <p className="flex flex-wrap items-center gap-2 text-base font-bold text-ink">
              Videos {isNative ? <ShieldCheck className="h-4 w-4 text-emerald-500" /> : <AdBadge />}
            </p>
            <p className="text-sm leading-relaxed text-ink2">
              {isNative
                ? "The app fetches streams straight from YouTube on your phone, like NewPipe, so there are no ads. If that fails it switches to ad-free servers."
                : "On the website videos play in YouTube's official player, so YouTube may show ads. A free blocker removes them:"}
            </p>
            {!isNative && <AdBlockSteps className="pt-1" />}
          </div>
        </div>
      </section>

      <a
        href="/privacy"
        data-nav="true"
        className="blur-panel glass-inset group flex items-center justify-between gap-3 rounded-[1.75rem] p-5 transition-transform hover:-translate-y-0.5"
      >
        <span className="flex items-center gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent">
            <Shield className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-base font-bold text-ink transition-colors group-hover:text-accent">Privacy policy</span>
            <span className="mt-0.5 block text-sm text-ink2">How your data stays on your device</span>
          </span>
        </span>
        <ArrowRight className="h-4 w-4 text-ink3" />
      </a>

      <section className="blur-panel glass-inset overflow-hidden rounded-[2.5rem] p-8 text-center sm:p-12">
        <h2 className="text-2xl font-black text-ink sm:text-3xl">Ready to listen?</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-ink2">
          No installation needed. No accounts to manage. AuraBeats runs entirely in your browser and stays ready even offline.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a
            href="https://github.com/jakariatanjim-svg/aurabeats"
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring rounded-full border border-line bg-ink/[0.05] px-8 py-3 text-sm font-bold text-ink transition hover:border-accent hover:text-accent"
          >
            GitHub Repository
          </a>
        </div>
      </section>

      <p className="text-center text-[10px] font-medium tracking-widest text-ink3 uppercase opacity-50">
        Built for performance · 2026 AuraBeats
      </p>
    </div>
  );
}
