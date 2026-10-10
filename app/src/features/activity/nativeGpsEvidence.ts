export interface NativeGpsEvidenceEvent {
  schema: 'cairn-native-gps-evidence';
  version: 1;
  event: 'native-callback' | 'native-js-delivery' | 'native-error';
  source: 'foreground-streamer' | 'background-task';
  evidenceIds: string[];
  receiptWallTimeMs: number;
  receiptMonotonicTimeMs: number;
  firstObservationTimeMs: number | null;
  lastObservationTimeMs: number | null;
  batchCount: number;
  horizontalAccuracyMinM: number | null;
  horizontalAccuracyMaxM: number | null;
  applicationState: string;
  authorizationStatus: string;
  accuracyAuthorization: string;
}

export interface NativeGpsEvidenceExport {
  schema: 'cairn-native-gps-evidence-export';
  version: 1;
  evidenceCompletenessStatus:
    | 'not-observable-current-binary'
    | 'native-file-unreadable'
    | 'native-evidence-available';
  sourcePath: 'app-documents/CairnDiagnostics/native-gps-evidence-v1.jsonl';
  privacy: {
    coordinatesIncluded: false;
    automaticUpload: false;
    maximumBytes: 524288;
  };
  malformedLineCount: number;
  retentionTruncated: boolean;
  events: NativeGpsEvidenceEvent[];
}

const RELATIVE_PATH = 'CairnDiagnostics/native-gps-evidence-v1.jsonl';
const MAX_EVENTS = 1_024;

function safeEvent(value: unknown): NativeGpsEvidenceEvent | null {
  const event = value as Partial<NativeGpsEvidenceEvent> | null;
  if (!event
    || event.schema !== 'cairn-native-gps-evidence'
    || event.version !== 1
    || (event.event !== 'native-callback'
      && event.event !== 'native-js-delivery'
      && event.event !== 'native-error')
    || (event.source !== 'foreground-streamer' && event.source !== 'background-task')
    || !Array.isArray(event.evidenceIds)
    || event.evidenceIds.some(identity => typeof identity !== 'string')
    || !Number.isFinite(event.receiptWallTimeMs)
    || !Number.isFinite(event.receiptMonotonicTimeMs)
    || !Number.isFinite(event.batchCount)) return null;
  // The native writer intentionally has no coordinate fields. Fail closed if
  // an incompatible future format adds them rather than copying it blindly.
  const serialized = JSON.stringify(event).toLowerCase();
  if (serialized.includes('latitude') || serialized.includes('longitude')
    || serialized.includes('"lat"') || serialized.includes('"lng"')) return null;
  return event as NativeGpsEvidenceEvent;
}

/**
 * Reads the optional new-binary native ring for the existing Settings export.
 * Current binaries have no such file and report that fact explicitly. The
 * read is bounded and user-initiated; it never runs on the GPS intake path.
 */
export async function exportNativeGpsEvidence(): Promise<NativeGpsEvidenceExport> {
  const base: Omit<NativeGpsEvidenceExport, 'evidenceCompletenessStatus' | 'events' | 'malformedLineCount' | 'retentionTruncated'> = {
    schema: 'cairn-native-gps-evidence-export',
    version: 1,
    sourcePath: 'app-documents/CairnDiagnostics/native-gps-evidence-v1.jsonl',
    privacy: { coordinatesIncluded: false, automaticUpload: false, maximumBytes: 524_288 },
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FileSystem = require('expo-file-system/legacy');
    if (!FileSystem?.documentDirectory) {
      return { ...base, evidenceCompletenessStatus: 'not-observable-current-binary', malformedLineCount: 0, retentionTruncated: false, events: [] };
    }
    const path = `${FileSystem.documentDirectory}${RELATIVE_PATH}`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info?.exists) {
      return { ...base, evidenceCompletenessStatus: 'not-observable-current-binary', malformedLineCount: 0, retentionTruncated: false, events: [] };
    }
    const raw = await FileSystem.readAsStringAsync(path);
    const lines = String(raw).split('\n').filter(Boolean);
    let malformedLineCount = 0;
    const events = lines.flatMap(line => {
      try {
        const parsed = safeEvent(JSON.parse(line));
        if (!parsed) malformedLineCount += 1;
        return parsed ? [parsed] : [];
      } catch {
        malformedLineCount += 1;
        return [];
      }
    }).slice(-MAX_EVENTS);
    return {
      ...base,
      evidenceCompletenessStatus: 'native-evidence-available',
      malformedLineCount,
      retentionTruncated: lines.length > MAX_EVENTS,
      events,
    };
  } catch {
    return { ...base, evidenceCompletenessStatus: 'native-file-unreadable', malformedLineCount: 0, retentionTruncated: false, events: [] };
  }
}
