# AuraBeats · Streaming Engine

An ultra-modern, production-ready music streaming application that aggregates the world's largest audio catalogs into one seamless web experience. No API keys, no accounts, no subscriptions, no rate limits.

[![Website](https://img.shields.io/badge/Website-aurabeats.pages.dev-7c5cff?style=for-the-badge)](https://aurabeats.pages.dev/)

🔗 **[aurabeats.pages.dev](https://aurabeats.pages.dev/)**

![stack](https://img.shields.io/badge/Vite_7-React_19-646cff)
![style](https://img.shields.io/badge/Tailwind_CSS_v4-dual_theme-38bdf8)
![cost](https://img.shields.io/badge/cost-100%25_free-22c55e)
![sources](https://img.shields.io/badge/sources-7_engines-ff6b6b)

---

## ✨ Features

### Hybrid Playback Engine
- **Dual Core**: Seamlessly switches between a native HTML5 Audio engine (for direct MP3 sources) and a hidden, ad-free YouTube IFrame player.
- **Unified Controls**: Play, pause, seek, and volume work identically across all sources.
- **Smart Failover**: Automatically races multiple mirrors and fallback sources if a stream fails.

### Multi-source Aggregation
Every song is a complete, full-length recording streamed from multiple public networks.

| Source | What it provides | Quality |
| --- | --- | --- |
| **YouTube Music** | World's largest catalog: Official, remixes, slowed, live. | High |
| **JioSaavn** | Massive mainstream database: Bollywood, regional, international. | 320 kbps |
| **SoundCloud** | Indie, underground, remixes, and user-uploaded hits. | Variable |
| **Audius** | Decentralised artist catalogue: charts, releases, genre feeds. | 320 kbps |
| **Jamendo** | Creative-Commons indie library: mood & genre filters. | Full |
| **Internet Archive** | Historical recordings, net labels, live concerts, classics. | Full |
| **Radio Browser** | Worldwide live radio directory: tag/country filters. | Endless |

### Smart Search & Discovery
- **Two-Tab Search**: Dedicated filters for **YT Music** ( lyrics-friendly, fuzzy matching) and **Other Sources** (consolidated database results).
- **Favourites-First Personalization**: The "For You" section learns from your **Favourites only**, ensuring your daily mix isn't polluted by random test listens or play history.
- **Engine Status**: Real-time connectivity monitoring in Settings with a manual "Test Connectivity" suite.

### Player Experience
- **Sticky Bottom Player** + polished mobile navigation.
- **Rotating Vinyl CD Artwork** in the full-screen player.
- **Swipe-to-Minimize**: Easily minimize the full-screen player on mobile with a simple downward swipe.
- **Canvas Audio Visualizer**: (Note: analyzed only for native audio sources).
- **In-App Downloads**: Save tracks for offline use ( native sources) or use the one-click prefilled downloader modal (YouTube).

### Dual Core Theme Engine
1. **Glassy** — frosted glassmorphism, neon borders, animated glowing gradients.
2. **Modern** — flat, high-contrast, premium dark/light modes.
Plus 8 accent colour presets or any custom colour via CSS custom properties.

---

## 🚀 Getting started

No builds, no installs — AuraBeats is already live:

1. **Website** — open [aurabeats.pages.dev](https://aurabeats.pages.dev) in any browser, on PC or mobile.
2. **PWA** — install it from the browser menu for a native-app feel (see below).
3. **Android APK** — grab the APK from the [latest GitHub Release](https://github.com/jakariatanjim-svg/aurabeats/releases/latest); afterwards the app updates itself from Settings.

Nothing is published automatically: every release is a deliberate **Run workflow** press in the Actions tab (see [GitHub Actions](#-github-actions)).

---

## 📦 Distribution

- **Website / PWA** — the primary target, hosted as a standard live website: download `aurabeats-web.zip` from a release and upload its contents to Cloudflare Pages. Installable as a PWA on Android, iOS, or any desktop browser, with no offline cache layer in between.
- **Android APK** — built by **APK — Release** and attached to the latest GitHub Release as `AuraBeats-<version>.apk`; the in-app **Check App Update** button picks new versions up.
- **No desktop installer** — the project is web-first by design. On PC, use the website directly or install the PWA from Chrome/Edge.

---

## 🔄 GitHub Actions

Four manual workflows and nothing else — there are no push triggers, so a commit
(or an agent session) can never publish anything by itself. All four live in
`.github/workflows/`, and all four can be run from any branch using the **"Use
workflow from"** dropdown at the top of the run dialog.

**Release pipelines** — these publish:

| Workflow | What a run does |
| --- | --- |
| `manual-web.yml` — **Website — Release** | mints the next version, creates the tag **and** the GitHub Release, attaches `aurabeats-web.zip` (the `dist/` bundle for Cloudflare Pages). Has the optional version override. |
| `manual-apk.yml` — **APK — Release** | builds and signs the APK, stamps it with the version of the release marked *latest*, and uploads `AuraBeats-<version>.apk` into **that** release. Creates no tag, no release and no version. |

**Test pipelines** — these only build, and publish nothing (no tag, no release,
no upload):

| Workflow | Artifact you get |
| --- | --- |
| `artifact-web.yml` — **Website — Test Build** | the built site itself — unzip it to inspect locally, or upload it straight to Cloudflare Pages |
| `artifact-apk.yml` — **APK — Test Build** | the signed APK, ready to sideload |

Test builds run on any branch and never ask anything. The two release pipelines
also run on any branch, but selecting a branch other than the default requires
ticking a confirmation box in the run dialog; without it the run stops with an
error that names the default branch and the matching test workflow. Artifacts are
kept for 7 days. GitHub wraps every artifact download in a ZIP container: the
website artifact holds the site files directly, the APK artifact holds only
`AuraBeats-<version>.apk`.

### Versioning

Versions are automatic and monotonic — no dates, no run counters:

```
1.0 → 1.1 → 1.2 → … → 1.9 → 2.0 → 2.1 → …
```

**Website — Release** reads the highest existing `vX.Y` tag and mints the
next one (the very first run gives `v1.0`), then tags the release `v1.4` and
titles it `AuraBeats — v1.4`.

Its run dialog also has an optional **version override** field (`3`, `3.0` and
`v3.0` are all accepted); leave it empty to auto-advance. An override is
published as an ordinary tag, so it becomes the **new baseline**: override
`v3.0` while `v1.5` is the newest and the next automatic run mints `v3.1` — it
never falls back to `v1.6`. Overriding *downwards* is allowed but prints a
warning, because the sequence still continues after the highest tag: versions
have to stay monotonic or installed apps stop seeing updates. Overrides only
matter on a release run — the two test pipelines create no tag, so they can
neither consume nor move a version; the number they stamp into a test build is
only a label.

**APK — Release** never mints a version. It stamps the APK with the version
of the release marked *latest* and pushes the APK into that same release, so the
package always agrees with the release it lives in. Android receives
`versionName 1.4` / `versionCode 14` (`MAJOR × 10 + MINOR`), which keeps updates
from ever looking like a downgrade.

A normal release is therefore two runs: **Website — Release** (creates `v1.4`)
then **APK — Release** (fills `v1.4` with `AuraBeats-1.4.apk`).

### Signing

Every APK is signed with the keystore committed in [`signing/`](signing/) — see
its README for why that is safe and why it is required. A stable signature is
what makes in-place updates possible: Android only installs an update over a
running app when both APKs share one signing identity.

---

## 📱 Install as App (PWA)

AuraBeats is a fully installable Progressive Web App — works like a native app on all platforms.

An installed PWA is a **shortcut to the live site**, not an offline copy: the
service worker caches nothing (`public/sw.js` is a pure passthrough that exists
only to keep the app installable), so every open is served straight from
Cloudflare Pages exactly like a normal website. No stale shell, no cache to
clear, no "force reinstall" — a reload is always the newest build.

### Android / PC (Chrome / Edge)
1. Open [aurabeats.pages.dev](https://aurabeats.pages.dev/).
2. Tap the **three-dot menu (⋮)** or the **install icon (⊕)** in the address bar.
3. Tap **"Install app"** or **"Add to Home screen"**.

### iOS (Safari)
1. Open [aurabeats.pages.dev](https://aurabeats.pages.dev/) in **Safari**.
2. Tap the **Share button** and scroll down to **"Add to Home Screen"**.

### 🔄 Updates

**Website / PWA** — nothing to update. The site is served live from Cloudflare
Pages with no offline cache, so uploading a new `aurabeats-web.zip` *is* the
update: the next open or reload already runs the new build. An installed PWA and
the Android app show which build they are on (**App version v1.4** in Settings);
the plain website deliberately shows no version stamp.

**Android APK** — a real in-app updater:

1. Settings queries the [latest release](https://github.com/jakariatanjim-svg/aurabeats/releases/latest)
   as soon as the screen opens and compares **versions**, not commit hashes: a
   download is offered only when the published version is *strictly newer* than
   the installed one. Equal means "you are on the latest version" — the app
   never re-installs the build it already is.
2. The button turns into **Update to v1.4** and the APK downloads **inside the
   app** with a live progress bar — no browser hop, no notification shade.
3. When the download finishes, Android's package installer opens by itself and
   the update installs in place, so playlists, history and offline downloads all
   survive.

The installed build is always visible in Settings (**App version v1.4**).

---

## ⌨️ Keyboard shortcuts
| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `Shift` + `→` / `←` | Next / previous track |
| `F` | Full-screen player |
| `Mouse wheel` | Volume up / down |
| `Esc` | Close overlay |

---

## 🔊 Playback notes
- Content remains the property of its respective creators — AuraBeats stores nothing remotely.
- YouTube playback is routed through an invisible IFrame player for seamless integration.
- Downloads use direct fetch or a prefilled external converter for maximum mobile compatibility.
- Built for performance, speed, and privacy.

---

## 🧑‍💻 About

AuraBeats is a solo project: designed, built and operated by one person, with GitHub Actions doing the release engineering. No servers, no API keys, no accounts, no bills — just a static bundle, a hidden YouTube player and a lot of glue.

**Built with Vite, React 19, TypeScript, Tailwind CSS v4 and Lucide.**
