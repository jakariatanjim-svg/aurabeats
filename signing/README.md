# Android signing key

`aurabeats.keystore` is the single signing identity used for every APK this
repository publishes. `keystore.properties` holds the (public) credentials the
CI pipeline feeds to Gradle.

## Why it is committed

Android only installs an update over an existing app when both APKs carry the
**same** certificate. A fresh GitHub Actions runner has no `~/.android/debug.keystore`,
so Gradle generates a throwaway one on every run — every build then gets a
different signature and the in-app updater dies with
`INSTALL_FAILED_UPDATE_INCOMPATIBLE`, forcing users to uninstall (and lose
their WebView data) before installing a new build.

Committing one keystore removes that failure mode: `Manual: APK Build` always
signs with this key, so updates install in place.

This is a distribution key for a side-loaded open-source app. It is **not** a
Play Store upload key and it is **not** secret — see the header of
`keystore.properties`.

## Details

| | |
| --- | --- |
| Format | PKCS#12 (PBES2 / AES-256-CBC, SHA-256 MAC) |
| Alias | `aurabeats` |
| Key | RSA 2048, SHA-256 self-signed certificate |
| Validity | 30 years from 2026-10-15 |
| Subject | `CN=AuraBeats, O=AuraBeats, OU=AuraBeats Android, C=US` |

## Rotating it

Rotating invalidates in-place updates for everyone currently installed — they
must uninstall once. Only do it deliberately:

1. Generate a replacement (`openssl req -x509 -newkey rsa:2048 -sha256 -days 10950 -nodes ...`
   then `openssl pkcs12 -export ...`).
2. Overwrite `aurabeats.keystore` (and update `keystore.properties` if the
   alias/passwords change).
3. Publish a release whose notes tell users to uninstall the previous build
   before installing this one.
