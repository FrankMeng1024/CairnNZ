const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withUnityFramework(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let podfile = fs.readFileSync(podfilePath, 'utf8');

      // Podspec lives at repo root: Cairn/UnityFramework.podspec
      // Podfile lives at: Cairn/app/ios/Podfile
      // Relative path from Podfile to podspec: ../../UnityFramework.podspec
      const UNITY_POD = `  pod 'UnityFramework', :podspec => '../../UnityFramework.podspec'\n`;

      // Idempotent: skip if already added
      if (!podfile.includes("pod 'UnityFramework'")) {
        // Insert after the first 'use_native_modules!' or 'use_expo_modules!' line
        const insertMarkers = [
          /^(\s*use_expo_modules!.*\n)/m,
          /^(\s*use_native_modules!.*\n)/m,
          /^(\s*pod 'React-Core'.*\n)/m,
        ];

        let inserted = false;
        for (const marker of insertMarkers) {
          if (marker.test(podfile)) {
            podfile = podfile.replace(marker, (match) => match + UNITY_POD);
            inserted = true;
            break;
          }
        }

        if (!inserted) {
          // Fallback: insert before the last 'end' in the target block
          podfile = podfile.replace(
            /(^end\s*$)/m,
            UNITY_POD + '$1'
          );
        }

        fs.writeFileSync(podfilePath, podfile);
        console.log('[withUnityFramework] Added UnityFramework pod to Podfile');
      } else {
        console.log('[withUnityFramework] UnityFramework pod already present, skipping');
      }

      return config;
    }
  ]);
};
