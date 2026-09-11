import {
  createMapboxCadenceState,
  observeMapboxLocation,
  resolveLocationCadenceExperiment,
} from '../locationCadenceExperiment';

const position = (overrides: Partial<Parameters<typeof observeMapboxLocation>[1]> = {}) => ({
  lat: -41,
  lng: 174,
  timestamp: 1_000,
  horizontalAccuracyM: 8,
  speedMps: 1.1,
  courseDeg: 90,
  ...overrides,
});

const context = (overrides: Partial<Parameters<typeof observeMapboxLocation>[2]> = {}) => ({
  callbackWallTimestamp: 1_100,
  monotonicTimestampMs: 50,
  appState: 'active',
  latestCairnRaw: { lat: -41, lng: 174.00001 },
  latestCanonical: { lat: -41, lng: 173.99999 },
  ...overrides,
});

describe('O44 location cadence experiment', () => {
  it('uses 1 m as the real foreground production candidate independent of Debug Mode', () => {
    expect(resolveLocationCadenceExperiment({
      internalBuild: false,
      debugMode: true,
      selectedDistanceFilterM: 1,
    })).toEqual({ distanceFilterM: 1, variant: 'distanceFilter1' });
    expect(resolveLocationCadenceExperiment({
      internalBuild: true,
      debugMode: false,
      selectedDistanceFilterM: 1,
    })).toEqual({ distanceFilterM: 1, variant: 'distanceFilter1' });
  });

  it('retains the explicit 5 m control only for an Internal Debug comparison', () => {
    expect(resolveLocationCadenceExperiment({
      internalBuild: true,
      debugMode: true,
      selectedDistanceFilterM: 5,
    })).toEqual({ distanceFilterM: 5, variant: 'distanceFilter5' });
  });

  it('emits privacy-safe relative evidence for a changed location', () => {
    const result = observeMapboxLocation(createMapboxCadenceState(), position(), context());
    expect(result.locationChanged).toBe(true);
    expect(result.fields).toMatchObject({
      sourceSequence: 1,
      sourceTimestamp: 1_000,
      sourceAgeMs: 100,
      coordinateChanged: true,
      headingOnly: false,
      horizontalAccuracyM: 8,
    });
    expect(result.fields?.displacementToLatestCairnRawM).toBeGreaterThan(0);
    expect(Object.keys(result.fields ?? {})).not.toEqual(
      expect.arrayContaining(['lat', 'lng', 'latitude', 'longitude', 'coordinate', 'coordinates']),
    );
  });

  it('does not count a heading-only repetition as a location fix', () => {
    const first = observeMapboxLocation(createMapboxCadenceState(), position(), context());
    const repeated = observeMapboxLocation(
      first.state,
      position({ courseDeg: 120 }),
      context({ callbackWallTimestamp: 1_150, monotonicTimestampMs: 100 }),
    );
    expect(repeated.locationChanged).toBe(false);
    expect(repeated.fields).toBeNull();
    expect(repeated.state.headingOnlyEventsSincePreviousLocation).toBe(1);

    const next = observeMapboxLocation(
      repeated.state,
      position({ lng: 174.00002, timestamp: 2_000 }),
      context({ callbackWallTimestamp: 2_100, monotonicTimestampMs: 1_050 }),
    );
    expect(next.locationChanged).toBe(true);
    expect(next.fields).toMatchObject({
      sourceSequence: 2,
      sourceIntervalMs: 1_000,
      callbackIntervalMs: 1_000,
      headingOnlyEventsSincePreviousLocation: 1,
    });
  });

  it('counts a newer stationary CLLocation timestamp as a real source fix', () => {
    const first = observeMapboxLocation(createMapboxCadenceState(), position(), context());
    const next = observeMapboxLocation(
      first.state,
      position({ timestamp: 2_000 }),
      context({ callbackWallTimestamp: 2_050, monotonicTimestampMs: 1_000 }),
    );
    expect(next.locationChanged).toBe(true);
    expect(next.fields).toMatchObject({
      sourceIntervalMs: 1_000,
      displacementFromPreviousMapboxLocationM: 0,
      coordinateChanged: false,
    });
  });
});
