// Local simulation: run plugin chain against template Podfile
// Validates post_install count without burning EAS credits

const path = require('path');
const fs = require('fs');

// Expo SDK 54 / RN 0.81 template Podfile structure
// Sourced from: https://github.com/expo/expo/blob/sdk-54/templates/expo-template-default/ios/Podfile
const TEMPLATE = [
  "require File.join(File.dirname(`node --print \"require.resolve('expo/package.json')\"`), \"scripts/autolinking\")",
  "require File.join(File.dirname(`node --print \"require.resolve('@react-native/community-cli-plugin/package.json')\"`), \"../../../scripts/cocoapods/new_arch_helper\")",
  "",
  "require 'json'",
  "podfile_properties = JSON.parse(File.read(File.join(__dir__, 'Podfile.properties.json'))) rescue {}",
  "",
  "ENV['RCT_NEW_ARCH_ENABLED'] = podfile_properties['newArchEnabled'] == 'false' ? '0' : '1'",
  "",
  "platform :ios, podfile_properties['ios.deploymentTarget'] || '15.1'",
  "install! 'cocoapods', :deterministic_uuids => false",
  "",
  "target 'Cairn' do",
  "  use_expo_modules!",
  "  config = use_native_modules!",
  "",
  "  use_react_native!(",
  "    :path => config[:reactNativePath],",
  "    :hermes_enabled => podfile_properties['expo.jsEngine'] == nil || podfile_properties['expo.jsEngine'] == 'hermes',",
  "    :fabric_enabled => flags[:fabric_enabled],",
  "    :app_path => \"#{Pod::Config.instance.installation_root}/..\"",
  "  )",
  "",
  "  post_install do |installer|",
  "    # https://github.com/facebook/react-native/blob/main/packages/react-native/scripts/react_native_pods.rb",
  "    react_native_post_install(",
  "      installer,",
  "      config[:reactNativePath],",
  "      :mac_catalyst_enabled => false",
  "    )",
  "  end",
  "end",
].join('\n');

// ── withViroPodfileFix logic ──────────────────────────────────────────────────
const VIRO_PODS_BLOCK = [
  "  # ViroReact with integrated New Architecture (Fabric) support",
  "  # Automatically includes Fabric components when RCT_NEW_ARCH_ENABLED=1",
  "  pod 'ViroReact', :path => '../node_modules/@reactvision/react-viro/ios'",
  "  pod 'ViroKit', :path => '../node_modules/@reactvision/react-viro/ios/dist/ViroRenderer/'",
  "",
  "  # Enforce New Architecture requirement",
  "  if ENV['RCT_NEW_ARCH_ENABLED'] != '1'",
  "    raise \"ViroReact requires New Architecture to be enabled.\"",
  "  end",
  "",
].join('\n');

function applyViroPodfileFix(podfile) {
  if (podfile.includes("pod 'ViroReact'") && podfile.includes("pod 'ViroKit'")) {
    console.log('[withViroPodfileFix] already present, skipping');
    return podfile;
  }
  const anchor = 'post_install do |installer|';
  const anchorIdx = podfile.indexOf(anchor);
  if (anchorIdx === -1) { console.error('[withViroPodfileFix] anchor not found!'); return podfile; }
  const lineStart = podfile.lastIndexOf('\n', anchorIdx) + 1;
  const result = podfile.slice(0, lineStart) + VIRO_PODS_BLOCK + podfile.slice(lineStart);
  console.log('[withViroPodfileFix] injected Viro pods before post_install');
  return result;
}

// ── withUnityEmbed logic (current: e63f92c) ───────────────────────────────────
const HOOK_MARKER = '# CAIRN_UNITY_EMBED_HOOK_V2';
const HOOK_BODY = [
  '    ' + HOOK_MARKER,
  '    installer.pods_project.targets.each do |t|',
  "      if t.name == 'react-native-unity'",
  '        t.build_configurations.each do |config|',
  "          config.build_settings['BUILD_LIBRARY_FOR_DISTRIBUTION'] = 'YES'",
  '        end',
  '      end',
  '    end',
  '',
].join('\n');

function applyUnityEmbed(podfile) {
  if (podfile.includes(HOOK_MARKER)) {
    console.log('[withUnityEmbed] already present, skipping');
    return podfile;
  }
  const lines = podfile.split('\n');
  const idx = lines.findIndex(l => l.includes('post_install do |installer|'));
  if (idx === -1) { console.error('[withUnityEmbed] anchor not found!'); return null; }
  const result = [
    ...lines.slice(0, idx + 1),
    HOOK_BODY,
    ...lines.slice(idx + 1),
  ].join('\n');
  console.log('[withUnityEmbed] injected embed hook INSIDE post_install at line ' + (idx + 1));
  return result;
}

// ── Run chain ─────────────────────────────────────────────────────────────────
let result = TEMPLATE;
console.log('\n=== STEP 1: Template ===');
console.log('post_install count:', (result.match(/post_install do/g) || []).length);

console.log('\n=== STEP 2: withViroPodfileFix ===');
result = applyViroPodfileFix(result);
console.log('post_install count:', (result.match(/post_install do/g) || []).length);

console.log('\n=== STEP 3: withUnityEmbed ===');
result = applyUnityEmbed(result);
const countAll = (result.match(/post_install do/g) || []).length;
console.log('post_install count:', countAll);

console.log('\n=== GENERATED PODFILE (around post_install) ===');
const lines = result.split('\n');
lines.forEach((line, i) => {
  if (line.includes('post_install') || line.includes(HOOK_MARKER) ||
      line.includes('ViroReact') || line.includes('ViroKit')) {
    console.log('  ' + (i+1) + ': ' + line);
  }
});

console.log('\n=== VERDICT ===');
if (countAll === 1) {
  console.log('PASS: exactly 1 post_install block — CocoaPods will accept this');
} else {
  console.log('FAIL: ' + countAll + ' post_install blocks — CocoaPods will reject');
}
