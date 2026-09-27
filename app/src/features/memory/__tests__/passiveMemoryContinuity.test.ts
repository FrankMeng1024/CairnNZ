import {
  createPassiveMemoryContinuityState,
  reducePassiveMemoryObservation,
} from '../services/passiveMemoryContinuity';
import type { RealGpsObservation } from '../../activity/realGpsContinuity';

const observation = (eastM: number, t: number, overrides: Partial<RealGpsObservation> = {}): RealGpsObservation => ({
  lat: -41,
  lng: 174 + eastM / (111_320 * Math.cos(41 * Math.PI / 180)),
  t,
  accuracy: 6,
  speed: null,
  source: 'background',
  observationId: `passive-${t}`,
  ...overrides,
});

describe('passive Memory continuity', () => {
  test('stationary qualified updates do not paint a cloud of new evidence', () => {
    let state = createPassiveMemoryContinuityState();
    const accepted: RealGpsObservation[] = [];
    for (const [index, east] of [0, 1.5, -1, 2, -2, 1].entries()) {
      const result = reducePassiveMemoryObservation(
        state,
        observation(east, 1_000 + index * 10_000, { speed: 0.05, accuracy: 8 }),
        100_000 + index * 10_000,
      );
      state = result.state;
      accepted.push(...result.accepted);
      expect(result.qualifiedPosition).not.toBeNull();
    }
    expect(accepted).toHaveLength(1);
  });

  test('coherent walking eventually commits positive evidence at 15-second cadence', () => {
    let state = createPassiveMemoryContinuityState();
    const accepted: RealGpsObservation[] = [];
    for (const [index, east] of [0, 12, 24, 36].entries()) {
      const result = reducePassiveMemoryObservation(
        state,
        observation(east, 1_000 + index * 15_000, { speed: null }),
        50_000 + index * 15_000,
      );
      state = result.state;
      accepted.push(...result.accepted);
    }
    expect(accepted.length).toBeGreaterThanOrEqual(3);
  });
});
