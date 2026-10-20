import { auditSnapLabDeliveryAuthenticity } from '../snapLabDeliveryAudit';

const event = (ordinal: number, observationTimeMs: number, deliveryTimeMs: number) => ({
  ordinal, observationTimeMs, deliveryTimeMs, appState: 'background',
});

describe('Snap Lab native delivery authenticity audit', () => {
  test('rejects the former Q08 shape where a held callback arrives after newer callbacks', () => {
    const audit = auditSnapLabDeliveryAuthenticity([
      event(0, 1_000, 1_000),
      event(1, 4_000, 4_000),
      event(2, 2_000, 5_000),
      event(3, 3_000, 5_000),
    ], 'arrival-ordered-with-late-batch');
    expect(audit.authenticForConfiguredNativeBatchModel).toBe(false);
    expect(audit.issues).toEqual([
      expect.objectContaining({
        kind: 'cross-callback-observation-regression',
        ordinal: 2,
        previousMaximumObservationTimeMs: 4_000,
      }),
    ]);
  });

  test('accepts one contiguous native callback containing the delayed and newer samples', () => {
    const audit = auditSnapLabDeliveryAuthenticity([
      event(0, 1_000, 1_000),
      event(1, 2_000, 5_000),
      event(2, 3_000, 5_000),
      event(3, 4_000, 5_000),
    ], 'native-callback-batched-late-window');
    expect(audit).toMatchObject({
      callbackCount: 2,
      eventCount: 4,
      authenticForConfiguredNativeBatchModel: true,
      issues: [],
    });
  });
});

