/**
 * Kalman Filter + GPS Smoothing — Unit Tests
 * STORY-00139: GPS Kalman Filter + Dynamic Sampling
 */
import {
  kalmanInit,
  kalmanUpdate,
  classifyMovement,
  getSamplingInterval,
} from '../../utils/geo';

describe('Kalman Filter', () => {
  it('initializes with first measurement', () => {
    const state = kalmanInit(-39.2, 10);
    expect(state.x).toBe(-39.2);
    expect(state.p).toBeGreaterThan(0);
    expect(state.q).toBe(0.00001);
  });

  it('smooths noisy measurements toward true value', () => {
    const state = kalmanInit(0, 10);
    // Feed constant value with noise
    const measurements = [0.001, -0.001, 0.002, -0.002, 0.001, 0, -0.001, 0.001];
    let lastEstimate = 0;
    for (const m of measurements) {
      lastEstimate = kalmanUpdate(state, m);
    }
    // Should converge near 0
    expect(Math.abs(lastEstimate)).toBeLessThan(0.002);
  });

  it('responds to actual movement', () => {
    const state = kalmanInit(0, 5);
    // Gradually move from 0 to 0.01
    const steps = [0.002, 0.004, 0.006, 0.008, 0.01];
    let lastEstimate = 0;
    for (const m of steps) {
      lastEstimate = kalmanUpdate(state, m);
    }
    // Should track the movement (not stuck at 0)
    expect(lastEstimate).toBeGreaterThan(0.005);
  });

  it('handles varying accuracy', () => {
    const state = kalmanInit(10, 5);
    // High accuracy measurement should be trusted more
    kalmanUpdate(state, 10.001, 2); // accuracy 2m
    const afterGoodReading = state.x;

    const state2 = kalmanInit(10, 5);
    kalmanUpdate(state2, 10.001, 50); // accuracy 50m
    const afterBadReading = state2.x;

    // Good reading should move estimate more toward measurement
    expect(Math.abs(afterGoodReading - 10.001)).toBeLessThan(Math.abs(afterBadReading - 10.001));
  });
});

describe('classifyMovement', () => {
  it('classifies static (< 0.5 m/s)', () => {
    expect(classifyMovement(0)).toBe('static');
    expect(classifyMovement(0.3)).toBe('static');
    expect(classifyMovement(0.49)).toBe('static');
  });

  it('classifies walking (0.5 - 2.5 m/s)', () => {
    expect(classifyMovement(0.5)).toBe('walking');
    expect(classifyMovement(1.5)).toBe('walking');
    expect(classifyMovement(2.5)).toBe('walking');
  });

  it('classifies running (> 2.5 m/s)', () => {
    expect(classifyMovement(2.6)).toBe('running');
    expect(classifyMovement(5.0)).toBe('running');
  });
});

describe('getSamplingInterval', () => {
  it('returns 10000ms for static', () => {
    expect(getSamplingInterval('static')).toBe(10000);
  });

  it('returns 1000ms for walking', () => {
    expect(getSamplingInterval('walking')).toBe(1000);
  });

  it('returns 500ms for running', () => {
    expect(getSamplingInterval('running')).toBe(500);
  });

  it('forces 2000ms when battery low', () => {
    expect(getSamplingInterval('running', true)).toBe(2000);
    expect(getSamplingInterval('walking', true)).toBe(2000);
    expect(getSamplingInterval('static', true)).toBe(2000);
  });
});
