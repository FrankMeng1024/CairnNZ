// BUILD-GATED CANDIDATE — not compiled by the current application binary.
// This file is designed to live inside the ExpoLocation iOS pod only after
// the exact-version patch gate in expoLocationIosPatch.js succeeds.

import CoreLocation
import Foundation
import UIKit

@objc(CairnNativeGpsEvidence)
public final class CairnNativeGpsEvidence: NSObject {
  @objc(shared)
  public static let shared = CairnNativeGpsEvidence()

  private let writer = DispatchQueue(label: "nz.cairn.native-gps-evidence", qos: .utility)
  private let maximumBytes = 512 * 1024
  private let collectorRunId = UUID().uuidString.lowercased()
  private var heartbeat: DispatchSourceTimer?
  private var sequence: UInt64 = 0
  private var retentionEpoch: UInt64 = 0
  private var evidenceByBatch = [String: [String]]()
  private var batchOrder = [String]()

  private override init() {
    super.init()
    let timer = DispatchSource.makeTimerSource(queue: writer)
    timer.schedule(deadline: .now() + 60, repeating: 60, leeway: .seconds(5))
    timer.setEventHandler { [weak self] in self?.recordHeartbeat() }
    timer.resume()
    heartbeat = timer
  }

  @objc(recordNativeCallbackWithSource:locations:)
  public func recordNativeCallback(source: String, locations: [CLLocation]) {
    enqueue(event: "native-callback", source: source, locations: locations, assignEvidence: true)
  }

  @objc(recordNativeToJsDeliveryWithSource:locations:)
  public func recordNativeToJsDelivery(source: String, locations: [CLLocation]) {
    enqueue(event: "native-js-delivery", source: source, locations: locations, assignEvidence: false)
  }

  private func enqueue(
    event: String,
    source: String,
    locations: [CLLocation],
    assignEvidence: Bool
  ) {
    guard source == "foreground-streamer" || source == "background-task" else {
      return
    }
    let appState = Self.applicationState()
    let authorization = Self.authorizationStatus()
    let accuracyAuthorization = Self.accuracyAuthorization()
    let receiptWallTimeMs = Int64(Date().timeIntervalSince1970 * 1_000)
    let receiptMonotonicTimeMs = Int64(ProcessInfo.processInfo.systemUptime * 1_000)
    let observationTimes = locations.map(Self.observationTimeMs)
    let batchKey = "\(source):\(observationTimes.map(String.init).joined(separator: ","))"

    // No file operation, JSON encoding, or queue wait occurs on CLLocation's
    // callback thread. The immutable scalars/locations are consumed later on
    // the utility writer; location payloads and delivery ordering are untouched.
    writer.async { [weak self] in
      guard let self, let correlationScopeId = self.currentCorrelationScope() else { return }
      self.sequence &+= 1
      let evidenceIds: [String]
      if assignEvidence || self.evidenceByBatch[batchKey] == nil {
        evidenceIds = locations.map { _ in "native-\(UUID().uuidString.lowercased())" }
        self.evidenceByBatch[batchKey] = evidenceIds
        self.batchOrder.append(batchKey)
      } else {
        evidenceIds = self.evidenceByBatch[batchKey]!
      }
      if self.batchOrder.count > 512 {
        let expired = self.batchOrder.prefix(self.batchOrder.count - 512)
        expired.forEach { self.evidenceByBatch.removeValue(forKey: $0) }
        self.batchOrder.removeFirst(self.batchOrder.count - 512)
      }
      let accuracies = locations.map(\.horizontalAccuracy).filter { $0 >= 0 && $0.isFinite }
      let payload: [String: Any] = [
        "schema": "cairn-native-gps-evidence",
        "version": 2,
        "event": event,
        "source": source,
        "collectorRunId": self.collectorRunId,
        "sequence": self.sequence,
        "correlationScopeId": correlationScopeId,
        "evidenceIds": evidenceIds,
        "receiptWallTimeMs": receiptWallTimeMs,
        "receiptMonotonicTimeMs": receiptMonotonicTimeMs,
        "firstObservationTimeMs": observationTimes.min() as Any,
        "lastObservationTimeMs": observationTimes.max() as Any,
        "batchCount": locations.count,
        "horizontalAccuracyMinM": accuracies.min() as Any,
        "horizontalAccuracyMaxM": accuracies.max() as Any,
        "applicationState": appState,
        "authorizationStatus": authorization,
        "accuracyAuthorization": accuracyAuthorization
      ]
      self.append(payload, correlationScopeId: correlationScopeId)
    }
  }

  private func recordHeartbeat() {
    guard let correlationScopeId = currentCorrelationScope() else { return }
    sequence &+= 1
    let nowWall = Int64(Date().timeIntervalSince1970 * 1_000)
    let nowMonotonic = Int64(ProcessInfo.processInfo.systemUptime * 1_000)
    append([
      "schema": "cairn-native-gps-evidence",
      "version": 2,
      "event": "collector-heartbeat",
      "source": "collector",
      "collectorRunId": collectorRunId,
      "sequence": sequence,
      "correlationScopeId": correlationScopeId,
      "evidenceIds": [],
      "receiptWallTimeMs": nowWall,
      "receiptMonotonicTimeMs": nowMonotonic,
      "firstObservationTimeMs": NSNull(),
      "lastObservationTimeMs": NSNull(),
      "batchCount": 0,
      "horizontalAccuracyMinM": NSNull(),
      "horizontalAccuracyMaxM": NSNull(),
      "applicationState": Self.applicationState(),
      "authorizationStatus": Self.authorizationStatus(),
      "accuracyAuthorization": Self.accuracyAuthorization()
    ], correlationScopeId: correlationScopeId)
  }

  /** Utility-queue-only read of the opaque JS-owned Activity scope. */
  private func currentCorrelationScope() -> String? {
    guard let directory = try? FileManager.default.url(
      for: .documentDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: false
    ),
    let data = try? Data(contentsOf: directory
      .appendingPathComponent("CairnDiagnostics", isDirectory: true)
      .appendingPathComponent("native-gps-context-v1.json")),
    let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
    value["schema"] as? String == "cairn-native-gps-context",
    value["version"] as? Int == 1,
    let scope = value["correlationScopeId"] as? String,
    scope.count >= 16 else { return nil }
    return scope
  }

  private func append(_ basePayload: [String: Any], correlationScopeId: String) {
    guard let directory = try? FileManager.default.url(
      for: .documentDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    ).appendingPathComponent("CairnDiagnostics", isDirectory: true) else { return }
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      let file = directory.appendingPathComponent("native-gps-evidence-v2.jsonl")
      var payload = basePayload
      payload["retentionEpoch"] = retentionEpoch
      guard var line = Self.encodedLine(payload) else { return }
      let existingBytes = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
      if existingBytes + line.count > maximumBytes {
        retentionEpoch &+= 1
        payload["retentionEpoch"] = retentionEpoch
        guard let rotatedLine = Self.encodedLine(payload) else { return }
        let marker: [String: Any] = [
          "schema": "cairn-native-gps-evidence",
          "version": 2,
          "event": "collector-retention-start",
          "source": "collector",
          "collectorRunId": collectorRunId,
          "retentionEpoch": retentionEpoch,
          "sequence": sequence,
          "correlationScopeId": correlationScopeId,
          "evidenceIds": [],
          "receiptWallTimeMs": Int64(Date().timeIntervalSince1970 * 1_000),
          "receiptMonotonicTimeMs": Int64(ProcessInfo.processInfo.systemUptime * 1_000),
          "firstObservationTimeMs": NSNull(),
          "lastObservationTimeMs": NSNull(),
          "batchCount": 0,
          "horizontalAccuracyMinM": NSNull(),
          "horizontalAccuracyMaxM": NSNull(),
          "applicationState": Self.applicationState(),
          "authorizationStatus": Self.authorizationStatus(),
          "accuracyAuthorization": Self.accuracyAuthorization()
        ]
        guard var replacement = Self.encodedLine(marker) else { return }
        replacement.append(rotatedLine)
        try replacement.write(to: file, options: .atomic)
      } else if FileManager.default.fileExists(atPath: file.path) {
        let handle = try FileHandle(forWritingTo: file)
        try handle.seekToEnd()
        try handle.write(contentsOf: line)
        try handle.close()
      } else {
        try line.write(to: file, options: .atomic)
      }
      try FileManager.default.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
        ofItemAtPath: file.path
      )
    } catch {
      // Diagnostics are strictly best-effort and can never delay or fail GPS.
    }
  }

  private static func encodedLine(_ payload: [String: Any]) -> Data? {
    guard JSONSerialization.isValidJSONObject(payload),
          var encoded = try? JSONSerialization.data(withJSONObject: payload) else { return nil }
    encoded.append(0x0A)
    return encoded
  }

  private static func observationTimeMs(_ location: CLLocation) -> Int64 {
    Int64(location.timestamp.timeIntervalSince1970 * 1_000)
  }

  private static func applicationState() -> String {
    switch UIApplication.shared.applicationState {
    case .active: return "active"
    case .inactive: return "inactive"
    case .background: return "background"
    @unknown default: return "unknown"
    }
  }

  private static func authorizationStatus() -> String {
    switch CLLocationManager.authorizationStatus() {
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .authorizedAlways: return "authorizedAlways"
    case .authorizedWhenInUse: return "authorizedWhenInUse"
    @unknown default: return "unknown"
    }
  }

  private static func accuracyAuthorization() -> String {
    if #available(iOS 14.0, *) {
      switch CLLocationManager().accuracyAuthorization {
      case .fullAccuracy: return "fullAccuracy"
      case .reducedAccuracy: return "reducedAccuracy"
      @unknown default: return "unknown"
      }
    }
    return "notAvailable"
  }
}
