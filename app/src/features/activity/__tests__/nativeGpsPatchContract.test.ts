import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '../../../..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const patcher = require(path.join(
  appRoot,
  'native-diagnostics/expo-location-19.0.8/expoLocationIosPatch.js',
));

const packageRoot = path.join(appRoot, 'node_modules/expo-location');
const files = Object.keys(patcher.EXPECTED.files) as string[];

function installedSources(): Record<string, string> {
  return Object.fromEntries(files.map(file => [
    file,
    fs.readFileSync(path.join(packageRoot, file), 'utf8'),
  ]));
}

describe('build-gated Expo Location native GPS observability patch', () => {
  test('pins the exact package version and upstream source identities', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    expect(packageJson.version).toBe(patcher.EXPECTED.version);
    const sources = installedSources();
    for (const file of files) {
      expect(patcher.sha256(sources[file])).toBe(patcher.EXPECTED.files[file]);
    }
  });

  test('adds only callback and native-to-JS boundary instrumentation at exact anchors', () => {
    const original = installedSources();
    const patched = patcher.prepareExpoLocationIosPatch(original);
    expect(patched['ios/Providers/LocationsStreamer.swift'])
      .toContain('recordNativeCallback(source: "foreground-streamer", locations: locations)');
    expect(patched['ios/LocationModule.swift'])
      .toContain('recordNativeToJsDelivery(\n              source: "foreground-streamer"');
    expect(patched['ios/TaskConsumers/EXLocationTaskConsumer.m'])
      .toContain('recordNativeCallbackWithSource:@"background-task" locations:locations');
    expect(patched['ios/TaskConsumers/EXLocationTaskConsumer.m'])
      .toContain('recordNativeToJsDeliveryWithSource:@"background-task" locations:_deferredLocations');

    // Existing yield, task execution, option, cadence and error lines survive
    // byte-for-byte as ordered substrings; the transformer has no threshold or
    // routing input and cannot silently apply to another Expo implementation.
    for (const marker of [
      'continuation?.yield(locations)',
      '[_task executeWithData:data withError:nil]',
      'locationManager.distanceFilter =',
      'locationManager.pausesLocationUpdatesAutomatically =',
      '[self maybeReportDeferredLocations]',
    ]) {
      expect(Object.values(patched as Record<string, string>)
        .some(value => value.includes(marker))).toBe(true);
    }
  });

  test('fails closed when any pinned upstream source changes', () => {
    const sources = installedSources();
    sources['ios/LocationModule.swift'] += '\n// upstream drift\n';
    expect(() => patcher.prepareExpoLocationIosPatch(sources))
      .toThrow('native_gps_patch_source_mismatch:ios/LocationModule.swift');
  });

  test('the proposed writer is bounded, asynchronous and coordinate-free', () => {
    const recorder = fs.readFileSync(path.join(
      appRoot,
      'native-diagnostics/expo-location-19.0.8/CairnNativeGpsEvidence.swift',
    ), 'utf8');
    expect(recorder).toContain('writer.async');
    expect(recorder).toContain('512 * 1024');
    expect(recorder).toContain('collector-heartbeat');
    expect(recorder).toContain('collector-retention-start');
    expect(recorder).toContain('native-gps-context-v1.json');
    expect(recorder).toContain('collectorRunId');
    expect(recorder).toContain('FileProtectionType.completeUntilFirstUserAuthentication');
    expect(recorder).not.toMatch(/latitude|longitude|\.coordinate\b/);
    expect(recorder).not.toContain('DispatchQueue.main.sync');
    expect(recorder).not.toContain('writer.sync');
  });
});
