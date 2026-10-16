/** Commit SHA baked into the bundle at build time (see vite.config.ts). */
declare const __APP_BUILD_SHA__: string;

/**
 * Release version baked into the bundle at build time, e.g. "1.4".
 * Set from APP_VERSION by the release workflows; see vite.config.ts.
 */
declare const __APP_VERSION__: string;
