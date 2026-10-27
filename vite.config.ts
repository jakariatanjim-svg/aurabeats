import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import type { Plugin } from "vite";
import { zipExtension } from "./scripts/zip-extension.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Commit SHA baked into the bundle so the in-app update check can tell whether
// the installed build matches the commit a GitHub Release was built from.
let buildSha = "";
try {
  buildSha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
} catch {
  /* not a git checkout — leave empty */
}

/**
 * Release version baked into the bundle (e.g. "1.4").
 *
 * The release workflows export APP_VERSION before `npm run build`:
 *   • Manual: Website Build -> the brand-new version it is about to publish
 *   • Manual: APK Build     -> the version of the release the APK is pushed into
 * The updater compares this against the latest GitHub Release and only offers a
 * download when that release is strictly newer, so a build can never "update"
 * itself to the version it already is.
 *
 * Local builds fall back to package.json (0.0.0), which simply reads as older
 * than any published release.
 */
let pkgVersion = "0.0.0";
try {
  pkgVersion =
    (JSON.parse(fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8")).version as string) ||
    pkgVersion;
} catch {
  /* keep the fallback */
}
const appVersion = (process.env.APP_VERSION || "").trim() || pkgVersion;

/**
 * Android app (VITE_APK=1): one self-contained index.html, loaded from the
 * phone itself, so splitting would gain nothing.
 *
 * Website: split, so the first visit only downloads what the first page
 * needs, and later visits reuse the cached shared parts. The pieces are
 * grouped on purpose (about ten files, not dozens):
 *   index + core – app shell, player bar, routing, shared code
 *   vendor – React and the other libraries every page uses
 *   music / video / settings / player – each loaded when first opened
 *   romanize – lyrics transliteration tables, only when "Romanized" is on
 *   scanner  – QR decoder, only while scanning a sync code
 */
const isApk = process.env.VITE_APK === "1";

function chunkGroup(id: string): string | undefined {
  if (id.includes("node_modules")) {
    if (id.includes("/any-ascii/")) return "romanize";
    if (id.includes("/qrcode-generator/")) return "settings";
    if (id.includes("/jsqr/")) return "scanner"; // only while scanning a QR
    return "vendor";
  }
  const f = id.replace(/\\/g, "/");
  if (f.includes("/src/utils/romanize")) return "romanize";
  if (/\/src\/views\/(SettingsView|AboutView|PrivacyView)|\/src\/components\/(SyncSection|YtAccountSection|ExtensionCard|DataSection|HistorySection|video\/VideoSettingsSection)|\/src\/utils\/fullBackup/.test(f)) return "settings";
  if (/\/src\/views\/video\//.test(f)) return "video";
  if (/\/src\/views\/(HomeView|SearchView|LibraryViews|DeviceMusicView)/.test(f)) return "music";
  if (/\/src\/components\/(FullScreenPlayer|LyricsViewer)/.test(f)) return "player";
  // Everything else the app shares lives in one "core" piece, so a page's
  // group never drags another page's group into the first load.
  if (f.includes("/src/")) return "core";
  return undefined;
}

/**
 * Website: the AuraBeats Connector browser extension (extension/) is packed
 * into /aurabeats-extension.zip on every build; Settings offers it.
 */
const extDir = path.resolve(__dirname, "extension");
let extVersion = "1.0.0";
try {
  extVersion = JSON.parse(fs.readFileSync(path.join(extDir, "manifest.json"), "utf8")).version || extVersion;
} catch {
  /* keep the fallback */
}

function extensionZip(): Plugin {
  return {
    name: "aurabeats-extension-zip",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "aurabeats-extension.zip", source: zipExtension(extDir) });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), ...(isApk ? [viteSingleFile()] : [extensionZip()])],
  build: isApk
    ? undefined
    : {
        rollupOptions: { output: { manualChunks: chunkGroup } },
        chunkSizeWarningLimit: 700,
      },
  define: {
    __APP_BUILD_SHA__: JSON.stringify(buildSha),
    __APP_VERSION__: JSON.stringify(appVersion),
    "import.meta.env.VITE_EXT_VERSION": JSON.stringify(extVersion),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
