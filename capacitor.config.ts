import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.pages.aurabeats",
  appName: "AuraBeats",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  plugins: {
    // Android draws the WebView edge-to-edge (under the status bar and the
    // camera cutout). "css" keeps that layout and exposes each device's real
    // insets to the page as --safe-area-inset-* (see src/index.css), so the UI
    // pads itself by exactly the space the phone needs.
    SystemBars: {
      insetsHandling: "css",
      // Matches the page's viewport-fit=cover; avoids a layout jump on launch.
      initialViewportFitValueHint: "cover",
      // Light status-bar icons for the default dark theme; useTheme keeps this
      // in sync when the user switches modes.
      style: "DARK",
    },
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
  },
};

export default config;
