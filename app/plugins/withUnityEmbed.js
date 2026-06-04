/**
 * Expo config plugin: ensure UnityFramework.framework is added to the
 * app target's "Embed & Sign" Frameworks build phase.
 *
 * Why this is needed:
 *   - @azesmway/react-native-unity 1.0.11 ships its podspec with
 *     vendored_frameworks = ["ios/UnityFramework.framework"], which
 *     causes CocoaPods to LINK the framework. But on RN 0.81 + Expo 54,
 *     CocoaPods does NOT automatically add it to the app target's
 *     "Embed Frameworks" build phase.
 *   - Without embedding, [NSBundle bundleWithPath:@"/Frameworks/UnityFramework.framework"]
 *     returns nil at runtime (the path the library hardcodes in
 *     RNUnityView.mm:9), and Unity initialization fails silently.
 *
 * What this does:
 *   Injects a Podfile post_install hook that iterates over the app
 *   target's resource_bundles and frameworks, and forces UnityFramework
 *   into the EmbedFrameworks build phase with FRAMEWORK_SEARCH_PATHS
 *   pointing to the pod's vendored framework dir.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs   = require('fs');
const path = require('path');

const HOOK_MARKER  = '# CAIRN_UNITY_EMBED_HOOK_V1';
const HOOK_BLOCK   = `
${HOOK_MARKER}
# Inject UnityFramework.framework into the app target's Embed Frameworks
# phase. @azesmway/react-native-unity vendors the framework but doesn't
# auto-embed it on Expo 54 / RN 0.81. Without this hook, dyld can't load
# UnityFramework at runtime.
post_install do |installer|
  installer.pods_project.targets.each do |target|
    if target.name == 'react-native-unity'
      target.build_configurations.each do |config|
        config.build_settings['BUILD_LIBRARY_FOR_DISTRIBUTION'] = 'YES'
      end
    end
  end

  installer.aggregate_targets.each do |aggregate_target|
    user_project = aggregate_target.user_project
    user_project.native_targets.each do |native_target|
      # Only embed Unity into the main app target — skip test bundles,
      # extensions, etc., to avoid duplicate-output build errors.
      next unless native_target.product_type == 'com.apple.product-type.application'

      # Find Embed Frameworks build phase (or create one)
      embed_phase = native_target.build_phases.find do |phase|
        phase.respond_to?(:symbol_dst_subfolder_spec) &&
          phase.symbol_dst_subfolder_spec == :frameworks
      end

      if embed_phase.nil?
        embed_phase = user_project.new(Xcodeproj::Project::Object::PBXCopyFilesBuildPhase)
        embed_phase.name = 'Embed Frameworks'
        embed_phase.symbol_dst_subfolder_spec = :frameworks
        native_target.build_phases << embed_phase
      end

      already = embed_phase.files.any? { |f|
        f.display_name && f.display_name.include?('UnityFramework')
      }

      unless already
        # Locate the vendored UnityFramework.framework reference in the Pods project
        pods_project = installer.pods_project
        unity_fw_ref = nil
        pods_project.files.each do |f|
          if f.path && f.path.end_with?('UnityFramework.framework')
            unity_fw_ref = f
            break
          end
        end

        if unity_fw_ref
          build_file = embed_phase.add_file_reference(unity_fw_ref)
          build_file.settings = { 'ATTRIBUTES' => ['CodeSignOnCopy', 'RemoveHeadersOnCopy'] }
          puts '[CairnUnity] UnityFramework.framework added to Embed Frameworks phase (CodeSignOnCopy)'
        else
          puts '[CairnUnity][WARN] UnityFramework.framework reference NOT FOUND in Pods project — runtime load will fail'
        end
      else
        puts '[CairnUnity] UnityFramework.framework already in Embed Frameworks phase'
      end
    end
    user_project.save
  end
end
`;

module.exports = function withUnityEmbed(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');

      if (!fs.existsSync(podfilePath)) {
        console.warn('[withUnityEmbed] Podfile not found at ' + podfilePath);
        return config;
      }

      let podfile = fs.readFileSync(podfilePath, 'utf8');

      if (podfile.includes(HOOK_MARKER)) {
        console.log('[withUnityEmbed] Hook already present — skipping');
        return config;
      }

      // Append at end of file. Multiple post_install blocks are valid in
      // CocoaPods >= 1.10; they all run sequentially.
      podfile = podfile.trimEnd() + '\n' + HOOK_BLOCK + '\n';

      fs.writeFileSync(podfilePath, podfile, 'utf8');
      console.log('[withUnityEmbed] Embed Frameworks hook appended to Podfile');

      return config;
    },
  ]);
};
