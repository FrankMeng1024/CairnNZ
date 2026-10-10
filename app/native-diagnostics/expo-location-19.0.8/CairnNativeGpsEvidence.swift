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
  private var sequence: UInt64 = 0
  private var evidenceByObservationTime = [Int64: String]()
  private var observationOrder = [Int64]()

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

    // No file operation, JSON encoding, or queue wait occurs on CLLocation's
    // callback thread. Retaining this immutable batch until the utility queue
    // runs is bounded by the platform-delivered callback size.
    writer.async { [weak self] in
      guard let self else { return }
      self.sequence &+= 1
      let evidenceIds = locations.map { location -> String in
        let observationTime = Self.observationTimeMs(location)
        if assignEvidence || self.evidenceByObservationTime[observationTime] == nil {
          let identity = "native-\(UUID().uuidString.lowercased())"
          self.evidenceByObservationTime[observationTime] = identity
          self.observationOrder.append(observationTime)
        }
        return self.evidenceByObservationTime[observationTime]!
      }
      if self.observationOrder.count > 512 {
        let expired = self.observationOrder.prefix(self.observationOrder.count - 512)
        expired.forEach { self.evidenceByObservationTime.removeValue(forKey: $0) }
        self.observationOrder.removeFirst(self.observationOrder.count - 512)
      }
      let observationTimes = locations.map(Self.observationTimeMs)
      let accuracies = locations.map(\.horizontalAccuracy).filter { $0 >= 0 && $0.isFinite }
      let payload: [String: Any] = [
        "schema": "cairn-native-gps-evidence",
        "version": 1,
        "event": event,
        "source": source,
        "sequence": self.sequence,
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
      self.append(payload)
    }
  }

  private func append(_ payload: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(payload),
          let encoded = try? JSONSerialization.data(withJSONObject: payload),
          let directory = try? FileManager.default.url(
            for: .documentDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
          ).appendingPathComponent("CairnDiagnostics", isDirectory: true) else {
      return
    }
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      let file = directory.appendingPathComponent("native-gps-evidence-v1.jsonl")
      var line = encoded
      line.append(0x0A)
      let existingBytes = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
      if existingBytes + line.count > maximumBytes {
        try line.write(to: file, options: .atomic)
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
