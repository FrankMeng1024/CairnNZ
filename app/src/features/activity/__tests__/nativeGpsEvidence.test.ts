const mockGetInfo = jest.fn();
const mockRead = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  getInfoAsync: (...args: unknown[]) => mockGetInfo(...args),
  readAsStringAsync: (...args: unknown[]) => mockRead(...args),
}));

import { exportNativeGpsEvidence } from '../nativeGpsEvidence';

const event = {
  schema: 'cairn-native-gps-evidence',
  version: 1,
  event: 'native-callback',
  source: 'background-task',
  evidenceIds: ['native-7'],
  receiptWallTimeMs: 1_000,
  receiptMonotonicTimeMs: 500,
  firstObservationTimeMs: 900,
  lastObservationTimeMs: 900,
  batchCount: 1,
  horizontalAccuracyMinM: 8,
  horizontalAccuracyMaxM: 8,
  applicationState: 'background',
  authorizationStatus: 'authorizedAlways',
  accuracyAuthorization: 'fullAccuracy',
};

describe('optional native GPS evidence export', () => {
  beforeEach(() => jest.clearAllMocks());

  test('current binaries explicitly report that the pre-JS boundary is not observable', async () => {
    mockGetInfo.mockResolvedValue({ exists: false });
    await expect(exportNativeGpsEvidence()).resolves.toMatchObject({
      evidenceCompletenessStatus: 'not-observable-current-binary',
      events: [],
      privacy: { coordinatesIncluded: false, automaticUpload: false, maximumBytes: 524288 },
    });
  });

  test('returns bounded coordinate-free native callback and delivery evidence', async () => {
    mockGetInfo.mockResolvedValue({ exists: true });
    mockRead.mockResolvedValue(`${JSON.stringify(event)}\n${JSON.stringify({
      ...event,
      event: 'native-js-delivery',
      receiptWallTimeMs: 1_010,
    })}\n`);
    const exported = await exportNativeGpsEvidence();
    expect(exported).toMatchObject({
      evidenceCompletenessStatus: 'native-evidence-available',
      malformedLineCount: 0,
      retentionTruncated: false,
    });
    expect(exported.events).toHaveLength(2);
    expect(JSON.stringify(exported)).not.toContain('latitude');
    expect(JSON.stringify(exported)).not.toContain('longitude');
  });

  test('fails closed instead of copying an incompatible coordinate-bearing record', async () => {
    mockGetInfo.mockResolvedValue({ exists: true });
    mockRead.mockResolvedValue(`${JSON.stringify({ ...event, latitude: -41 })}\n`);
    const exported = await exportNativeGpsEvidence();
    expect(exported.events).toEqual([]);
    expect(exported.malformedLineCount).toBe(1);
  });
});
