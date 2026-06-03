// metro.config.js
// Fixes lucide-react-native: force CJS build instead of ESM .mjs barrel
// which Metro cannot resolve on web/RN platforms.
// Strategy: extraNodeModules maps the bare module name to the CJS file
// BEFORE package.json field resolution runs — this beats the "react-native"
// field that points to the broken ESM barrel.
//
// v40: also configure for react-three-fiber/native:
//   - Add 'cjs' to sourceExts so r3f's .cjs entry resolves on RN.
//   - Add 'glb' / 'gltf' / 'hdr' to assetExts so 3D models / env maps load
//     via require() if/when we use them.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Map lucide-react-native directly to its CJS barrel — bypasses package.json fields
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'lucide-react-native': path.resolve(
    __dirname,
    'node_modules/lucide-react-native/dist/cjs/lucide-react-native.js'
  ),
};

// v40 r3f/native — recommended metro config from pmndrs docs
config.resolver.sourceExts = Array.from(
  new Set([...(config.resolver.sourceExts || []), 'cjs'])
);
config.resolver.assetExts = Array.from(
  new Set([
    ...(config.resolver.assetExts || []),
    'glb',
    'gltf',
    'hdr',
    'obj',
  ])
);

module.exports = config;
