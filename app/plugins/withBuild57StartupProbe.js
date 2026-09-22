const fs = require('fs');
const path = require('path');
const {
  IOSConfig,
  createRunOncePlugin,
  withAppDelegate,
  withXcodeProject,
} = require('@expo/config-plugins');

const SWIFT_FILENAME = 'Build57StartupProbe.swift';
const BRIDGE_FILENAME = 'Build57StartupProbeBridge.m';
const APP_DELEGATE_MARKER = 'BUILD57_DIAGNOSTIC_PROBE';

const swiftSource = `import Foundation
import os.log

@objc(Build57StartupProbe)
final class Build57StartupProbe: NSObject {
  private static let lock = NSLock()
  private static let sessionId = UUID().uuidString.lowercased()
  private static var sequence = 0
  private static let maxLogBytes: UInt64 = 512 * 1024
  private static let lastPhaseKey = "cairn.build57Diagnostic.lastPhase"
  private static let lastSessionKey = "cairn.build57Diagnostic.lastSession"
  private static let log = OSLog(
    subsystem: Bundle.main.bundleIdentifier ?? "com.yiiling.cairn",
    category: "Build57Startup"
  )

  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc static func recordNativeLaunch() {
    let defaults = UserDefaults.standard
    let previousPhase = defaults.string(forKey: lastPhaseKey)
    let previousSession = defaults.string(forKey: lastSessionKey)
    let expo = loadExpoConfiguration()
    recordNativePhase("native_did_finish_launching_enter", fields: [
      "previousPhase": previousPhase ?? NSNull(),
      "previousSession": previousSession ?? NSNull(),
      "appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
      "buildNumber": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown",
      "updatesEnabled": expo["EXUpdatesEnabled"] ?? NSNull(),
      "runtimeVersion": expo["EXUpdatesRuntimeVersion"] ?? NSNull(),
      "updatesURL": expo["EXUpdatesURL"] ?? NSNull(),
      "channel": expoChannel(from: expo) ?? NSNull(),
    ])
  }

  @objc static func recordNativePhase(_ phase: String, fields: NSDictionary = [:]) {
    lock.lock()
    defer { lock.unlock() }

    sequence += 1
    let cleanPhase = String(phase.prefix(120))
    UserDefaults.standard.set(cleanPhase, forKey: lastPhaseKey)
    UserDefaults.standard.set(sessionId, forKey: lastSessionKey)

    var event: [String: Any] = [
      "sessionId": sessionId,
      "sequence": sequence,
      "phase": cleanPhase,
      "wallClockMs": Int64(Date().timeIntervalSince1970 * 1000),
      "monotonicNs": DispatchTime.now().uptimeNanoseconds,
      "thread": Thread.isMainThread ? "main" : "background",
    ]
    event["fields"] = sanitize(fields)

    guard JSONSerialization.isValidJSONObject(event),
          let payload = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]),
          var line = String(data: payload, encoding: .utf8) else {
      return
    }
    line.append("\\n")
    append(line)
    os_log("%{public}@", log: log, type: .info, line)
  }

  @objc(recordSync:fields:)
  func recordSync(_ phase: String, fields: NSDictionary) -> NSNumber {
    Self.recordNativePhase(phase, fields: fields)
    return true
  }

  private static func loadExpoConfiguration() -> NSDictionary {
    guard let path = Bundle.main.path(forResource: "Expo", ofType: "plist"),
          let config = NSDictionary(contentsOfFile: path) else {
      return [:]
    }
    return config
  }

  private static func expoChannel(from config: NSDictionary) -> String? {
    guard let headers = config["EXUpdatesRequestHeaders"] as? NSDictionary else { return nil }
    return headers["expo-channel-name"] as? String
  }

  private static func sanitize(_ fields: NSDictionary) -> [String: Any] {
    let forbidden = [
      "token", "password", "authorization", "cookie", "secret", "email",
      "latitude", "longitude", "coordinate", "accesskey", "apikey",
    ]
    var result: [String: Any] = [:]
    for (rawKey, rawValue) in fields {
      guard let key = rawKey as? String else { continue }
      let lower = key.lowercased()
      if forbidden.contains(where: { lower.contains($0) }) { continue }
      switch rawValue {
      case let value as String:
        result[key] = String(value.prefix(1_500))
      case let value as NSNumber:
        result[key] = value
      case _ as NSNull:
        result[key] = NSNull()
      default:
        result[key] = String(describing: rawValue).prefix(500).description
      }
    }
    return result
  }

  private static func documentsDirectory() -> URL? {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
  }

  private static func append(_ line: String) {
    guard let directory = documentsDirectory(),
          let data = line.data(using: .utf8) else { return }
    let file = directory.appendingPathComponent("Build57StartupProbe.jsonl")
    let previous = directory.appendingPathComponent("Build57StartupProbe.previous.jsonl")
    let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.uint64Value ?? 0
    if size > maxLogBytes {
      try? FileManager.default.removeItem(at: previous)
      try? FileManager.default.moveItem(at: file, to: previous)
    }
    if !FileManager.default.fileExists(atPath: file.path) {
      FileManager.default.createFile(atPath: file.path, contents: nil)
    }
    guard let handle = try? FileHandle(forWritingTo: file) else { return }
    defer { try? handle.close() }
    do {
      try handle.seekToEnd()
      try handle.write(contentsOf: data)
      try handle.synchronize()
    } catch {
      // Diagnostic persistence is best-effort and must never become a new
      // startup failure mode.
    }
  }
}
`;

const bridgeSource = `#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(Build57StartupProbe, NSObject)
RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(recordSync:(NSString *)phase fields:(NSDictionary *)fields)
@end
`;

function injectAppDelegate(contents) {
  if (contents.includes(APP_DELEGATE_MARKER)) return contents;

  const signature = `    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {`;
  if (!contents.includes(signature)) {
    throw new Error('Build57 diagnostic probe could not locate AppDelegate launch signature');
  }
  let next = contents.replace(
    signature,
    `${signature}\n    // ${APP_DELEGATE_MARKER}\n    Build57StartupProbe.recordNativeLaunch()`,
  );

  const factoryStart = '    factory.startReactNative(';
  if (!next.includes(factoryStart)) {
    throw new Error('Build57 diagnostic probe could not locate React factory start');
  }
  next = next.replace(
    factoryStart,
    `    Build57StartupProbe.recordNativePhase("native_before_react_factory_start")\n${factoryStart}`,
  );

  const factoryEnd = '      launchOptions: launchOptions)';
  if (!next.includes(factoryEnd)) {
    throw new Error('Build57 diagnostic probe could not locate React factory completion');
  }
  next = next.replace(
    factoryEnd,
    `${factoryEnd}\n    Build57StartupProbe.recordNativePhase("native_after_react_factory_start")`,
  );

  const superReturn = '    return super.application(application, didFinishLaunchingWithOptions: launchOptions)';
  if (!next.includes(superReturn)) {
    throw new Error('Build57 diagnostic probe could not locate Expo AppDelegate completion');
  }
  next = next.replace(
    superReturn,
    `    Build57StartupProbe.recordNativePhase("native_before_expo_super")\n` +
      `    let build57LaunchResult = super.application(application, didFinishLaunchingWithOptions: launchOptions)\n` +
      `    Build57StartupProbe.recordNativePhase("native_after_expo_super", fields: ["result": build57LaunchResult])\n` +
      `    return build57LaunchResult`,
  );
  return next;
}

const withBuild57StartupProbe = (config) => {
  config = withAppDelegate(config, (modConfig) => {
    if (modConfig.modResults.language !== 'swift') {
      throw new Error('Build57 diagnostic probe requires a Swift AppDelegate');
    }
    modConfig.modResults.contents = injectAppDelegate(modConfig.modResults.contents);
    return modConfig;
  });

  config = withXcodeProject(config, (modConfig) => {
    const projectName = modConfig.modRequest.projectName;
    const iosRoot = modConfig.modRequest.platformProjectRoot;
    const sourceDirectory = path.join(iosRoot, projectName);
    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(path.join(sourceDirectory, SWIFT_FILENAME), swiftSource);
    fs.writeFileSync(path.join(sourceDirectory, BRIDGE_FILENAME), bridgeSource);

    for (const filename of [SWIFT_FILENAME, BRIDGE_FILENAME]) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: `${projectName}/${filename}`,
        groupName: projectName,
        project: modConfig.modResults,
        verbose: true,
      });
    }
    return modConfig;
  });

  return config;
};

module.exports = createRunOncePlugin(
  withBuild57StartupProbe,
  'with-build57-startup-probe',
  '1.0.0',
);

