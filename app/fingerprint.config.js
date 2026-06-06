/**
 * Expo fingerprint configuration.
 *
 * Purpose: include `unity-release.json` as a fingerprint input so that
 * publishing a new Unity xcframework (which lives in a GitHub Release,
 * outside any path EAS would normally hash) automatically invalidates
 * the EAS native-build cache. Without this, EAS sees identical fingerprint
 * inputs and runs a "repack" job that reuses the previous IPA's UnityFramework
 * binary, silently shipping stale Unity code.
 *
 * Mechanism:
 *   1. Unity GitHub Actions builds & uploads UnityFramework.xcframework.zip
 *      to release tag `unity-xcframework-latest`.
 *   2. Same workflow writes the zip's SHA-256 hash into `app/unity-release.json`
 *      and commits + pushes the change.
 *   3. EAS fingerprint hashes `app/unity-release.json` (because of this
 *      `extraSources` declaration) → new Unity content → new fingerprint
 *      → EAS forced to do a real native build (pre-install hook runs,
 *      pod install runs, xcodebuild re-links the new framework).
 *   4. Same Unity source re-built produces same SHA → marker unchanged
 *      → fingerprint unchanged → EAS legitimately reuses cache. Correct.
 *
 * Verify this config is loaded:
 *   `npx @expo/fingerprint --debug` from app/ — output should contain
 *   "unity-release.json" in the list of hash sources. If absent, EAS is
 *   not picking up this config — investigate before relying on the
 *   cache-busting mechanism.
 *
 * @type {import('@expo/fingerprint').Config}
 */
// Loud-load marker: if this file is loaded, this line prints to the EAS
// build log. Greppable as `[fingerprint.config.js] loaded`. If this string
// is absent from EAS build logs, the config did not load.
// eslint-disable-next-line no-console
console.log('[fingerprint.config.js] loaded — extraSources includes unity-release.json');

module.exports = {
  extraSources: [
    {
      type: 'file',
      filePath: 'unity-release.json',
      reasons: ['unity-xcframework-binary-identity'],
    },
  ],
};

