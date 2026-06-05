/**
 * Expo config plugin: ensure UnityFramework.framework is added to the
 * app target's "Embed & Sign" Frameworks build phase.
 *
 * Why this is needed:
 *   - @azesmway/react-native-unity 1.0.11 ships its podspec with
 *     vendored_frameworks = ["ios/UnityFramework.framework"]. CocoaPods
 *     LINKS the framework but does NOT auto-embed it on Expo 54 / RN 0.81.
 *   - Without embedding, [NSBundle bundleWithPath:@"<App.app>/Frameworks/UnityFramework.framework"]
 *     returns nil at runtime, and Unity init fails silently.
 *
 * How it works:
 *   The Expo template Podfile has exactly ONE post_install block, INSIDE
 *   the target 'YourApp' do ... end block. CocoaPods does NOT support
 *   multiple post_install blocks. We must inject our embed-handling Ruby
 *   code INSIDE that single block, not as a second top-level block.
 *
 *   Pattern lifted directly from viro's withViroIos.js:127 which does
 *   the same thing for ARCore weak linking. Uses the same insertLines
 *   approach as withViroPodfileFix in this repo.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs   = require('fs');
const path = require('path');

const HOOK_MARKER = '# CAIRN_UNITY_EMBED_HOOK_V2';

// Ruby code injected INSIDE the existing `post_install do |installer|` block,
// immediately after the `post_install do |installer|` anchor line. The block's
// own `end` is preserved (we don't add our own `end`).
const HOOK_BODY = `    ${HOOK_MARKER}
    # Embed UnityFramework.framework into the app target's Frameworks build
    # phase with CodeSignOnCopy attribute. azesmway/react-native-unity vendors
    # the framework but Expo 54 + RN 0.81 doesn't auto-embed.
    installer.pods_project.targets.each do |t|
      if t.name == 'react-native-unity'
        t.build_configurations.each do |config|
          config.build_settings['BUILD_LIBRARY_FOR_DISTRIBUTION'] = 'YES'
        end
      end
    end

    installer.aggregate_targets.each do |aggregate_target|
      user_project = aggregate_target.user_project
      user_project.native_targets.each do |native_target|
        # Only main app target — skip test bundles, extensions, etc.
        next unless native_target.product_type == 'com.apple.product-type.application'

        # Find/create Embed Frameworks build phase
        embed_phase = native_target.build_phases.find { |phase|
          phase.respond_to?(:symbol_dst_subfolder_spec) &&
            phase.symbol_dst_subfolder_spec == :frameworks
        }

        if embed_phase.nil?
          embed_phase = user_project.new(Xcodeproj::Project::Object::PBXCopyFilesBuildPhase)
          embed_phase.name = 'Embed Frameworks'
          embed_phase.symbol_dst_subfolder_spec = :frameworks
          native_target.build_phases << embed_phase
        end

        already = embed_phase.files.any? { |f|
          f.display_name && f.display_name == 'UnityFramework.framework'
        }

        unless already
          unity_fw_ref = nil
          installer.pods_project.files.each do |f|
            if f.path && f.path.end_with?('UnityFramework.framework')
              unity_fw_ref = f
              break
            end
          end

          if unity_fw_ref
            build_file = embed_phase.add_file_reference(unity_fw_ref)
            build_file.settings = { 'ATTRIBUTES' => ['CodeSignOnCopy', 'RemoveHeadersOnCopy'] }
            puts '[CairnUnity] UnityFramework.framework added to Embed Frameworks (CodeSignOnCopy)'
          else
            puts '[CairnUnity][WARN] UnityFramework.framework reference NOT FOUND in Pods project'
          end
        else
          puts '[CairnUnity] UnityFramework.framework already in Embed Frameworks'
        end
      end
      user_project.save
    end
`;

/**
 * Insert helper — modeled after viro's insertLinesHelper.
 * Finds the line containing `target` and inserts `insert` after it (offset=1).
 */
function insertAfterAnchor(insert, target, contents) {
  if (contents.includes(insert)) return contents;
  const lines = contents.split('\n');
  const idx = lines.findIndex(l => l.includes(target));
  if (idx === -1) return null;
  return [
    ...lines.slice(0, idx + 1),
    insert,
    ...lines.slice(idx + 1),
  ].join('\n');
}

module.exports = function withUnityEmbed(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');

      let podfile;
      try {
        podfile = fs.readFileSync(podfilePath, 'utf8');
      } catch (e) {
        console.warn('[withUnityEmbed] Could not read Podfile:', e.message);
        return config;
      }

      // Idempotent: skip if already injected
      if (podfile.includes(HOOK_MARKER)) {
        console.log('[withUnityEmbed] Hook already present, skipping');
        return config;
      }

      // Inject INSIDE existing post_install block (after `post_install do |installer|` line)
      // NOT as a new top-level block — CocoaPods doesn't allow multiple post_install hooks.
      const updated = insertAfterAnchor(HOOK_BODY, 'post_install do |installer|', podfile);

      if (updated === null) {
        console.error(
          '[withUnityEmbed] CRITICAL: Could not find `post_install do |installer|` in Podfile. ' +
          'UnityFramework will NOT be embedded — runtime load will fail.'
        );
        return config;
      }

      fs.writeFileSync(podfilePath, updated, 'utf8');
      console.log('[withUnityEmbed] Embed Frameworks logic injected into existing post_install block');

      return config;
    },
  ]);
};
