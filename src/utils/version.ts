/**
 * Version handling for the release pipeline and the in-app updater.
 *
 * AuraBeats versions are `MAJOR.MINOR` where the minor only ever runs 0-9:
 * 1.0 -> 1.1 -> ... -> 1.9 -> 2.0 -> 2.1 ... Each "Website — Release (Primary)" run
 * mints exactly one new version and tags it `vX.Y`.
 *
 * Everything is compared numerically — never as a string — because "1.10" would
 * otherwise sort before "1.9" and a device would be told to downgrade.
 */

export interface Version {
  major: number;
  minor: number;
}

/**
 * Reads a version out of anything the release feed hands us: `v1.4`, `1.4`,
 * `AuraBeats — v1.4`.
 *
 * Deliberately strict about tags that carry no version at all — the legacy
 * `2026.10.15-1` date stamps must return null, not `2026.10`. A loose match
 * there would look "newer" than every real release and the app would offer a
 * downgrade forever.
 */
export function parseVersion(input: string | null | undefined): Version | null {
  if (!input) return null;
  const text = String(input).trim();

  // A third (patch) segment is tolerated and ignored: releases only ever use
  // MAJOR.MINOR, but the local-build fallback comes from package.json (0.0.0).
  // Preferred: an explicit v-prefixed version anywhere in the string.
  const tagged = text.match(/\bv(\d+)\.(\d+)(?:\.\d+)?\b/i);
  if (tagged) return { major: Number(tagged[1]), minor: Number(tagged[2]) };

  // Otherwise the whole string must be the version, nothing more.
  const bare = text.match(/^(\d+)\.(\d+)(?:\.\d+)?$/);
  if (bare) return { major: Number(bare[1]), minor: Number(bare[2]) };

  return null;
}

/** Negative when a is older, 0 when equal, positive when a is newer. */
export function compareVersions(a: Version, b: Version): number {
  if (a.major !== b.major) return a.major - b.major;
  return a.minor - b.minor;
}

export function formatVersion(version: Version): string {
  return `${version.major}.${version.minor}`;
}

/** `MAJOR * 10 + MINOR` — the Android versionCode the APK workflows stamp. */
export function versionCode(version: Version): number {
  return version.major * 10 + version.minor;
}
