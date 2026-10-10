const crypto = require('node:crypto');

const EXPECTED = Object.freeze({
  version: '19.0.8',
  files: {
    'ios/Providers/LocationsStreamer.swift': '9a1ddddd15416e624ba496bf061b5a74511a9cf600032ee47d9bb045558f3f20',
    'ios/LocationModule.swift': '0cc9450458dafef6dfb226af97f5bab4a876c0287ae0cbeb1e9ae0bdaaaf7557',
    'ios/TaskConsumers/EXLocationTaskConsumer.m': '8d046171f52ab7e985c7603a987648a059b6b3a11e94b5346010acac01cff207',
  },
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function replaceOnce(source, anchor, replacement, file) {
  const first = source.indexOf(anchor);
  if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0) {
    throw new Error(`native_gps_patch_anchor_mismatch:${file}`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + anchor.length)}`;
}

/**
 * Exact Expo Location 19.0.8 source transformation. This function performs no
 * filesystem write; a future native-build owner must explicitly place the
 * returned files in the ExpoLocation pod source and compile/test that binary.
 */
function prepareExpoLocationIosPatch(sources) {
  for (const [file, expectedHash] of Object.entries(EXPECTED.files)) {
    if (typeof sources[file] !== 'string' || sha256(sources[file]) !== expectedHash) {
      throw new Error(`native_gps_patch_source_mismatch:${file}`);
    }
  }

  const foregroundCallback = '  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {\n    if !locations.isEmpty {\n      continuation?.yield(locations)\n    }\n  }';
  const foregroundCallbackPatched = '  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {\n    if !locations.isEmpty {\n      CairnNativeGpsEvidence.shared.recordNativeCallback(source: "foreground-streamer", locations: locations)\n      continuation?.yield(locations)\n    }\n  }';
  const foregroundDelivery = '            sendEvent(EVENT_LOCATION_CHANGED, [\n              "watchId": watchId,\n              "location": exportLocation(location)\n            ])';
  const foregroundDeliveryPatched = '            CairnNativeGpsEvidence.shared.recordNativeToJsDelivery(\n              source: "foreground-streamer",\n              locations: locations\n            )\n            sendEvent(EVENT_LOCATION_CHANGED, [\n              "watchId": watchId,\n              "location": exportLocation(location)\n            ])';
  const objcImport = '#import <ExpoLocation/EXLocationTaskConsumer.h>';
  const objcImportPatched = '#import <ExpoLocation/EXLocationTaskConsumer.h>\n#import "ExpoLocation-Swift.h"';
  const backgroundCallback = '  if (_task != nil && locations.count > 0) {\n    [self deferLocations:locations];';
  const backgroundCallbackPatched = '  if (_task != nil && locations.count > 0) {\n    [[CairnNativeGpsEvidence shared] recordNativeCallbackWithSource:@"background-task" locations:locations];\n    [self deferLocations:locations];';
  const backgroundDelivery = '  NSDictionary *data = @{ @"locations": [EXLocationTaskConsumer _exportLocations:_deferredLocations] };\n  [_task executeWithData:data withError:nil];';
  const backgroundDeliveryPatched = '  [[CairnNativeGpsEvidence shared] recordNativeToJsDeliveryWithSource:@"background-task" locations:_deferredLocations];\n  NSDictionary *data = @{ @"locations": [EXLocationTaskConsumer _exportLocations:_deferredLocations] };\n  [_task executeWithData:data withError:nil];';

  return {
    ...sources,
    'ios/Providers/LocationsStreamer.swift': replaceOnce(
      sources['ios/Providers/LocationsStreamer.swift'],
      foregroundCallback,
      foregroundCallbackPatched,
      'ios/Providers/LocationsStreamer.swift',
    ),
    'ios/LocationModule.swift': replaceOnce(
      sources['ios/LocationModule.swift'],
      foregroundDelivery,
      foregroundDeliveryPatched,
      'ios/LocationModule.swift',
    ),
    'ios/TaskConsumers/EXLocationTaskConsumer.m': replaceOnce(
      replaceOnce(
        replaceOnce(
          sources['ios/TaskConsumers/EXLocationTaskConsumer.m'],
          objcImport,
          objcImportPatched,
          'ios/TaskConsumers/EXLocationTaskConsumer.m#import',
        ),
        backgroundCallback,
        backgroundCallbackPatched,
        'ios/TaskConsumers/EXLocationTaskConsumer.m#callback',
      ),
      backgroundDelivery,
      backgroundDeliveryPatched,
      'ios/TaskConsumers/EXLocationTaskConsumer.m#delivery',
    ),
  };
}

module.exports = { EXPECTED, prepareExpoLocationIosPatch, sha256 };
