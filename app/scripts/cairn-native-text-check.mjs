#!/usr/bin/env node

/**
 * Read-only native-copy boundary check.
 *
 * Native permission explanations are built into the binary. Their editable
 * authority is cairnText.ts, while app.json remains an intentionally generated
 * delivery boundary until a separately approved native build. This command
 * verifies the checked-in native values have not drifted; it never rewrites
 * app.json and never runs prebuild.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const reportArg = process.argv.find(argument => argument.startsWith('--report='));
const reportPath = reportArg ? path.resolve(reportArg.slice('--report='.length)) : null;
const appConfig = JSON.parse(fs.readFileSync(path.join(appRoot, 'app.json'), 'utf8'));
const catalogPath = path.join(appRoot, 'src', 'i18n', 'cairnText.ts');
const source = fs.readFileSync(catalogPath, 'utf8');
const ast = parser.parse(source, { sourceType: 'module', plugins: ['typescript'] });
const catalogEnglish = new Map();
const unwrapTypeExpression = node => {
  let current = node;
  while (current && ['TSAsExpression', 'TSSatisfiesExpression', 'TypeCastExpression'].includes(current.type)) {
    current = current.expression;
  }
  return current;
};

traverse(ast, {
  VariableDeclarator(pathRef) {
    if (pathRef.node.id.type !== 'Identifier' || pathRef.node.id.name !== 'CAIRN_TEXT') return;
    const root = unwrapTypeExpression(pathRef.node.init);
    if (root.type !== 'ObjectExpression') return;
    for (const entry of root.properties) {
      if (entry.type !== 'ObjectProperty' || entry.key.type !== 'StringLiteral'
        || entry.value.type !== 'ObjectExpression') continue;
      const english = entry.value.properties.find(property => property.type === 'ObjectProperty'
        && property.key.type === 'StringLiteral' && property.key.value === 'en-NZ');
      if (english?.type === 'ObjectProperty' && english.value.type === 'StringLiteral') {
        catalogEnglish.set(entry.key.value, english.value.value);
      }
    }
  },
});

const expo = appConfig.expo;
const plugin = name => expo.plugins.find(value => Array.isArray(value) && value[0] === name)?.[1];
const mappings = [
  ['native.permission.location-when-in-use', 'expo.ios.infoPlist.NSLocationWhenInUseUsageDescription', expo.ios.infoPlist.NSLocationWhenInUseUsageDescription],
  ['native.permission.location-always', 'expo.ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription', expo.ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription],
  ['native.permission.motion', 'expo.ios.infoPlist.NSMotionUsageDescription', expo.ios.infoPlist.NSMotionUsageDescription],
  ['native.permission.feedback-photos', 'expo.ios.infoPlist.NSPhotoLibraryUsageDescription', expo.ios.infoPlist.NSPhotoLibraryUsageDescription],
  ['native.permission.location-when-in-use', 'expo-location.locationWhenInUsePermission', plugin('expo-location')?.locationWhenInUsePermission],
  ['native.permission.location-always', 'expo-location.locationAlwaysAndWhenInUsePermission', plugin('expo-location')?.locationAlwaysAndWhenInUsePermission],
  ['native.permission.route-cairn-photos', 'expo-image-picker.photosPermission', plugin('expo-image-picker')?.photosPermission],
  ['native.permission.camera', 'expo-image-picker.cameraPermission', plugin('expo-image-picker')?.cameraPermission],
];
const rows = mappings.map(([catalogKey, nativePath, actual]) => ({
  catalogKey,
  nativePath,
  status: catalogEnglish.get(catalogKey) === actual ? 'MATCH' : 'DRIFT',
  binaryBoundary: true,
  requiresApprovedNativeBuildToApplyFutureEdit: true,
}));
const result = {
  generatedAt: new Date().toISOString(),
  mode: 'READ_ONLY_CHECK_NO_PREBUILD',
  mappings: rows,
  excludedSystemOwned: expo.android.permissions,
  excludedProductProperNoun: { path: 'expo.name', value: expo.name },
  errors: rows.filter(row => row.status !== 'MATCH').map(row => `${row.nativePath} differs from ${row.catalogKey}`),
};
if (reportPath) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify(result, null, 2));
process.exit(result.errors.length ? 1 : 0);
