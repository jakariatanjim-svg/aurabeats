/**
 * Version handling for the release pipeline and the in-app updater.
 *
 * Versions are `MAJOR.MINOR` (one dot) where the minor only ever runs 0-9:
 * 1.0 -> 1.1 -> ... -> 1.9 -> 2.0. A two-dot version override (e.g. 4.8.0)
 * switches the releases to `MAJOR.MINOR.PATCH`, where minor and patch both
 * run 0-9 (1.0.9 -> 1.1.0, 1.9.9 -> 2.0.0) until a one-dot override switches
 * back. Each "Website — Release (Primary)" run mints exactly one version.
 *
 * Everything is compared numerically — never as a string — because "1.10" would
 * otherwise sort before "1.9" and a device would be told to downgrade.
 */

export interface Version {
  major: number;
  minor: number;
  /** 0 for one-dot versions */
  patch: number;
  /** written with two dots (X.Y.Z) */
  long: boolean;
}

const make = (m: RegExpMatchArray): Version => ({
  major: Number(m[1]),
  minor: Number(m[2]),
  patch: Number(m[3] ?? 0),
  long: m[3] != null,
});

/**
 * Reads a version out of anything the release feed hands us: `v1.4`, `1.4`,
 * `v1.4.2`, `AuraBeats — v1.4`.
 *
 * Deliberately strict about tags that carry no version at all — the legacy
 * `2026.10.15-1` date stamps must return null, not `2026.10`. A loose match
 * there would look "newer" than every real release and the app would offer a
 * downgrade forever.
 */
export function parseVersion(input: string | null | undefined): Version | null {
  if (!input) return null;
  const text = String(input).trim();

  // Preferred: an explicit v-prefixed version anywhere in the string.
  const tagged = text.match(/\bv(\d+)\.(\d+)(?:\.(\d+))?\b/i);
  if (tagged) return make(tagged);

  // Otherwise the whole string must be the version, nothing more.
  const bare = text.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (bare) return make(bare);

  return null;
}

/** Negative when a is older, 0 when equal, positive when a is newer. */
export function compareVersions(a: Version, b: Version): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

export function formatVersion(version: Version): string {
  return version.long ? `${version.major}.${version.minor}.${version.patch}` : `${version.major}.${version.minor}`;
}

/** `MAJOR * 100 + MINOR * 10 + PATCH` — the Android versionCode the APK
 *  workflows stamp; it keeps rising across one-dot and two-dot versions. */
export function versionCode(version: Version): number {
  return version.major * 100 + version.minor * 10 + version.patch;
}
