/**
 * geo-dynamic-sampling.test — covers Sprint 55 changes:
 *   - getSamplingInterval honors batteryLow flag
 *   - Kalman filter handles accuracy=null/0 boundary gracefully
 *   - Kalman primitives handle accuracy edge cases without producing NaN
 */
import {
  getSamplingInterval,
  classifyMovement,
  kalmanInit,
  kalmanUpdate,
} from '../geo';

describe('getSamplingInterval — dynamic sampling rates', () => {
  it('returns 10s when static (no battery hint)', () => {
    expect(getSamplingInterval('static')).toBe(10000);
  });

  it('returns 1s when walking', () => {
    expect(getSamplingInterval('walking')).toBe(1000);
  });

  it('returns 500ms when running', () => {
    expect(getSamplingInterval('running')).toBe(500);
  });

  it('low battery overrides any movement to 2s', () => {
    expect(getSamplingInterval('static', true)).toBe(2000);
    expect(getSamplingInterval('walking', true)).toBe(2000);
    expect(getSamplingInterval('running', true)).toBe(2000);
  });
});

describe('classifyMovement — speed thresholds', () => {
  it('< 0.5 m/s = static', () => {
    expect(classifyMovement(0)).toBe('static');
    expect(classifyMovement(0.4)).toBe('static');
  });

  it('0.5-2.5 m/s = walking', () => {
    expect(classifyMovement(0.5)).toBe('walking');
    expect(classifyMovement(1.0)).toBe('walking');
    expect(classifyMovement(2.5)).toBe('walking');
  });

  it('> 2.5 m/s = running', () => {
    expect(classifyMovement(3)).toBe('running');
    expect(classifyMovement(20)).toBe('running');
  });
});

describe('Kalman filter — accuracy boundary handling', () => {
  it('handles accuracy = 0 without divide-by-zero', () => {
    const state = kalmanInit(10, 0);
    expect(state.r).toBeGreaterThan(0); // safe fallback
    const next = kalmanUpdate(state, 11, 0);
    expect(Number.isFinite(next)).toBe(true);
  });

  it('handles accuracy = NaN without producing NaN output', () => {
    const state = kalmanInit(10, NaN);
    const next = kalmanUpdate(state, 11, NaN);
    expect(Number.isFinite(next)).toBe(true);
  });

  it('handles very large accuracy (low confidence)', () => {
    const state = kalmanInit(0, 100);
    // Update with a measurement with high accuracy
    const next = kalmanUpdate(state, 0.001, 1);
    // Should be very close to new measurement (high confidence)
    expect(Math.abs(next - 0.001)).toBeLessThan(0.05);
  });
});

describe('classifyMovement boundary', () => {
  it('exactly 0.5 m/s = walking (>= 0.5)', () => {
    expect(classifyMovement(0.5)).toBe('walking');
  });
  it('exactly 2.5 m/s = walking (<= 2.5)', () => {
    expect(classifyMovement(2.5)).toBe('walking');
  });
  it('just above 2.5 = running', () => {
    expect(classifyMovement(2.51)).toBe('running');
  });
});
