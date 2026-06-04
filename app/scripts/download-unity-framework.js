#!/usr/bin/env node
/**
 * EAS Build pre-install hook.
 *
 * Downloads UnityFramework.xcframework from GitHub Release, extracts the
 * ios-arm64 slice, and places it at app/unity/builds/ios/UnityFramework.framework
 * — which is where @azesmway/react-native-unity's podspec prepare_command
 * expects it (line 47-50 of the library's react-native-unity.podspec):
 *
 *   prepare_command => "cp -R ../../../unity/builds/ios/ ios/"
 *
 * Without this file in place, pod install fails immediately at the
 * react-native-unity pod's prepare_command stage.
 *
 * Skips: non-iOS platforms, simulator builds (Unity doesn't support sim).
 *
 * The script runs from app/ (project root) per EAS conventions:
 *   process.cwd() === <repo>/app
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TAG = '[unity-framework]';
function log(msg)  { console.log(`${TAG} ${msg}`); }
function warn(msg) { console.warn(`${TAG} WARN: ${msg}`); }
function fail(msg) {
  console.error(`${TAG} FATAL: ${msg}`);
  process.exit(1);
}

// ─── Skip conditions ────────────────────────────────────────────────────
if (process.env.EAS_BUILD_PLATFORM !== 'ios') {
  log(`Not an iOS build (platform=${process.env.EAS_BUILD_PLATFORM ?? 'undefined'}); skipping.`);
  process.exit(0);
}

const profile = process.env.EAS_BUILD_PROFILE ?? '';
if (profile.includes('simulator') || profile === 'development-simulator') {
  log(`Simulator profile (${profile}); Unity does not support iOS Simulator; skipping.`);
  process.exit(0);
}

// ─── Paths ──────────────────────────────────────────────────────────────
// CWD = app/ at EAS pre-install time
const APP_DIR    = process.cwd();
const UNITY_DIR  = path.join(APP_DIR, 'unity', 'builds', 'ios');
const TARGET_FW  = path.join(UNITY_DIR, 'UnityFramework.framework');
const ZIP_PATH   = path.join(APP_DIR, '.tmp-unity', 'UnityFramework.xcframework.zip');
const EXTRACT_DIR= path.join(APP_DIR, '.tmp-unity');

const RELEASE_URL =
  'https://github.com/FrankMeng1024/CairnNZ/releases/download/' +
  'unity-xcframework-latest/UnityFramework.xcframework.zip';

log(`APP_DIR    = ${APP_DIR}`);
log(`TARGET_FW  = ${TARGET_FW}`);
log(`RELEASE    = ${RELEASE_URL}`);

// ─── Skip if already present (CI re-runs / cached) ─────────────────────
if (fs.existsSync(TARGET_FW) && fs.statSync(TARGET_FW).isDirectory()) {
  // Verify it has at least the binary inside
  const bin = path.join(TARGET_FW, 'UnityFramework');
  if (fs.existsSync(bin)) {
    log(`UnityFramework.framework already present at target; skipping download.`);
    process.exit(0);
  } else {
    warn(`Target dir exists but UnityFramework binary missing — will re-extract.`);
    fs.rmSync(TARGET_FW, { recursive: true, force: true });
  }
}

// ─── Download ──────────────────────────────────────────────────────────
fs.mkdirSync(EXTRACT_DIR, { recursive: true });
log(`Downloading xcframework zip...`);
try {
  // -L follow redirects, -f fail on HTTP errors, --max-time 600 (10 min)
  execSync(`curl -L -f --max-time 600 -o "${ZIP_PATH}" "${RELEASE_URL}"`, {
    stdio: 'inherit',
  });
} catch (e) {
  fail(`Download failed. Check release exists at:\n  https://github.com/FrankMeng1024/CairnNZ/releases/tag/unity-xcframework-latest\n  ${e.message}`);
}

const zipStat = fs.statSync(ZIP_PATH);
log(`Downloaded ${(zipStat.size / 1024 / 1024).toFixed(1)} MB`);

// ─── Extract ───────────────────────────────────────────────────────────
log(`Extracting xcframework...`);
try {
  execSync(`unzip -q -o "${ZIP_PATH}" -d "${EXTRACT_DIR}"`, { stdio: 'inherit' });
} catch (e) {
  fail(`Unzip failed: ${e.message}`);
}

// xcframework structure: <EXTRACT_DIR>/UnityFramework.xcframework/ios-arm64/UnityFramework.framework
const xcframeworkDir = path.join(EXTRACT_DIR, 'UnityFramework.xcframework');
const sliceFw = path.join(xcframeworkDir, 'ios-arm64', 'UnityFramework.framework');

if (!fs.existsSync(sliceFw)) {
  // List what's actually there to aid debugging
  if (fs.existsSync(xcframeworkDir)) {
    const slices = fs.readdirSync(xcframeworkDir);
    fail(`ios-arm64 slice not found in xcframework. Available slices: ${slices.join(', ')}`);
  } else {
    fail(`UnityFramework.xcframework directory not found after extract. Available: ${fs.readdirSync(EXTRACT_DIR).join(', ')}`);
  }
}

// ─── Copy slice into place ─────────────────────────────────────────────
fs.mkdirSync(UNITY_DIR, { recursive: true });
log(`Copying ${sliceFw} -> ${TARGET_FW}`);
try {
  // -R recursive, -L dereference symlinks (xcframework slices are usually plain dirs)
  execSync(`cp -R "${sliceFw}" "${TARGET_FW}"`, { stdio: 'inherit' });
} catch (e) {
  fail(`Copy failed: ${e.message}`);
}

// ─── Verify ───────────────────────────────────────────────────────────
const requiredFiles = [
  path.join(TARGET_FW, 'UnityFramework'),                  // mach-o binary
  path.join(TARGET_FW, 'Headers', 'UnityFramework.h'),
  path.join(TARGET_FW, 'Headers', 'NativeCallProxy.h'),
  path.join(TARGET_FW, 'Modules', 'module.modulemap'),
];
const missing = requiredFiles.filter(p => !fs.existsSync(p));
if (missing.length > 0) {
  fail(
    `UnityFramework.framework missing required files:\n  ` +
    missing.join('\n  ')
  );
}

const fwSize = parseInt(execSync(`du -sk "${TARGET_FW}" | cut -f1`).toString().trim(), 10);
log(`UnityFramework.framework ready at ${TARGET_FW} (${(fwSize / 1024).toFixed(1)} MB)`);

// ─── Cleanup ──────────────────────────────────────────────────────────
try {
  fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
  log(`Cleanup: removed ${EXTRACT_DIR}`);
} catch (e) {
  warn(`Cleanup failed (non-fatal): ${e.message}`);
}

log(`Done. @azesmway/react-native-unity podspec prepare_command will now find the framework.`);
