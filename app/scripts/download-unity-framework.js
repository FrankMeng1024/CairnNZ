const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// This script runs as EAS eas-build-pre-install hook (before pod install)
// EAS Build working directory = repo root (Cairn/)
// Script location: app/scripts/download-unity-framework.js
// Two levels up from __dirname = repo root

if (process.env.EAS_BUILD_PLATFORM !== 'ios') {
  console.log('[unity-framework] Not an iOS build, skipping');
  process.exit(0);
}

const REPO_ROOT = path.resolve(__dirname, '../..');
const RELEASE_URL = 'https://github.com/FrankMeng1024/CairnNZ/releases/download/unity-xcframework-latest/UnityFramework.xcframework.zip';
const DEST_ZIP  = path.join(REPO_ROOT, 'UnityFramework.xcframework.zip');
const DEST_DIR  = path.join(REPO_ROOT, 'UnityFramework.xcframework');
const DEST_SPEC = path.join(REPO_ROOT, 'UnityFramework.podspec');

if (fs.existsSync(DEST_DIR)) {
  console.log('[unity-framework] UnityFramework.xcframework already present, skipping download');
  writePodsspec();
  process.exit(0);
}

console.log('[unity-framework] Downloading UnityFramework.xcframework from GitHub Release...');
console.log('[unity-framework] URL:', RELEASE_URL);

try {
  execSync(`curl -L --fail --show-error "${RELEASE_URL}" -o "${DEST_ZIP}"`, { stdio: 'inherit' });
} catch (e) {
  console.error('[unity-framework] Download failed. Check that the GitHub Release exists:');
  console.error('  https://github.com/FrankMeng1024/CairnNZ/releases/tag/unity-xcframework-latest');
  process.exit(1);
}

console.log('[unity-framework] Unzipping...');
execSync(`unzip -q "${DEST_ZIP}" -d "${REPO_ROOT}"`, { stdio: 'inherit' });

// Clean up zip to save disk space
fs.unlinkSync(DEST_ZIP);

writePodsspec();

console.log('[unity-framework] Done. xcframework ready at:', DEST_DIR);

function writePodsspec() {
  const content = `Pod::Spec.new do |s|
  s.name             = 'UnityFramework'
  s.version          = '1.0.0'
  s.summary          = 'Unity as a Library — Cairn AR'
  s.homepage         = 'https://github.com/FrankMeng1024/CairnNZ'
  s.license          = { :type => 'Commercial' }
  s.author           = { 'FrankMeng' => '' }
  s.platform         = :ios, '14.0'
  s.source           = { :path => '.' }
  s.vendored_frameworks = 'UnityFramework.xcframework'
end
`;
  fs.writeFileSync(DEST_SPEC, content);
  console.log('[unity-framework] Wrote UnityFramework.podspec at:', DEST_SPEC);
}
