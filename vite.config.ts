import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  define: {
    __APP_BUILD_SHA__: JSON.stringify(buildSha),
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
