/**
 * withViroPodfileFix.js — local Expo config plugin to fix viro's race condition.
 *
 * Problem:
 *   @reactvision/react-viro 2.53.1's withViroIos plugin uses callback-based
 *   fs.readFile/fs.writeFile inside an async withDangerousMod hook but does
 *   NOT await/Promise-wrap the callbacks. The async function `return newConfig`
 *   immediately while the fs callbacks are still pending. Expo's mod compiler
 *   (config-plugins/build/plugins/mod-compiler.js:206) awaits the Promise then
 *   continues to pod install — which sees the ORIGINAL Podfile without
 *   ViroReact pods. Result: build .ipa missing ViroReact framework.
 *
 *   Verified by independent subagent + by inspecting EAS build #21 .ipa
 *   (Frameworks/ has no ViroReact, main binary has zero "viro" strings,
 *   build completed in 7m38s — too fast for ViroReact native compile).
 *
 * Fix:
 *   This plugin runs AFTER viro's withViroIos in the plugin chain. It uses
 *   SYNCHRONOUS fs.readFileSync / fs.writeFileSync to:
 *     1. Read the Podfile (post-viro-attempt — may or may not have viro pods)
 *     2. Check if ViroReact pod line exists; if not, inject it
 *     3. Write back synchronously (Expo's mod compiler awaits this Promise,
 *        so pod install runs AFTER Podfile is on disk)
 *
 *   Sync fs ops complete BEFORE the async function returns, eliminating the
 *   race condition.
 *
 * Notes:
 *   - We don't disable viro's plugin — its withDefaultInfoPlist still fires
 *     for permissions (that path doesn't use fs).
 *   - We only target iOS (Android plugin path may have different issues but
 *     we're iOS-only for now).
 *   - Pod injection is idempotent: if Podfile already has ViroReact, we no-op.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// IMPORTANT: This block must contain text that matches viro's insertLinesHelper
// idempotency check. Viro's withViroIos.js calls:
//   insertLinesHelper(viroPods, "post_install do |installer|", data, -1)
// where viroPods starts with "  # ViroReact with integrated New Architecture..."
// and contains "pod 'ViroReact', :path => '../node_modules/@reactvision/react-viro/ios'".
// insertLinesHelper does `if (!contents.includes(insert))` — and `insert` is the
// MULTI-LINE viroPods string. If our block contains those exact lines, viro's
// includes() check will pass on a substring of viroPods, blocking duplicate
// insertion. We use viro's exact comment text + pod lines to ensure this.
const VIRO_PODS_BLOCK = `  # ViroReact with integrated New Architecture (Fabric) support
  # Automatically includes Fabric components when RCT_NEW_ARCH_ENABLED=1
  pod 'ViroReact', :path => '../node_modules/@reactvision/react-viro/ios'
  pod 'ViroKit', :path => '../node_modules/@reactvision/react-viro/ios/dist/ViroRenderer/'

  # Enforce New Architecture requirement
  # ViroReact 2.43.1+ requires React Native New Architecture
  if ENV['RCT_NEW_ARCH_ENABLED'] != '1'
    raise "ViroReact requires New Architecture to be enabled. Please set RCT_NEW_ARCH_ENABLED=1 in ios/.xcode.env"
  end

`;

const withViroPodfileFix = (config) => {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      console.log('[withViroPodfileFix] Starting Podfile fix for viro async race condition');
      console.log('[withViroPodfileFix] Podfile path:', podfilePath);

      // Sync read — completes before async function returns
      let podfile;
      try {
        podfile = fs.readFileSync(podfilePath, 'utf-8');
      } catch (err) {
        console.warn(`[withViroPodfileFix] Could not read Podfile at ${podfilePath}:`, err.message);
        return config;
      }

      // Idempotent: if BOTH ViroReact AND ViroKit already present, no-op
      // (check both — partial state could happen if viro race partially succeeded)
      if (podfile.includes("pod 'ViroReact'") && podfile.includes("pod 'ViroKit'")) {
        console.log("[withViroPodfileFix] Podfile already contains both ViroReact and ViroKit pods, skipping injection");
        return config;
      }

      // Inject ViroReact + ViroKit pods before "post_install do |installer|"
      // Same anchor that viro's plugin uses (insertLinesHelper with post_install)
      const anchor = 'post_install do |installer|';
      const anchorIdx = podfile.indexOf(anchor);
      if (anchorIdx === -1) {
        console.error(`[withViroPodfileFix] CRITICAL: Could not find '${anchor}' in Podfile — ViroReact pods will not be installed, build will likely fail at runtime when ARKit code loads`);
        return config;
      }

      // Insert right before the anchor line
      const lineStart = podfile.lastIndexOf('\n', anchorIdx) + 1;
      const newPodfile = podfile.slice(0, lineStart) + VIRO_PODS_BLOCK + podfile.slice(lineStart);

      // Sync write — completes before function returns
      fs.writeFileSync(podfilePath, newPodfile, 'utf-8');
      console.log("[withViroPodfileFix] ✓ Successfully injected ViroReact + ViroKit pods into Podfile");

      return config;
    },
  ]);
};

module.exports = withViroPodfileFix;
