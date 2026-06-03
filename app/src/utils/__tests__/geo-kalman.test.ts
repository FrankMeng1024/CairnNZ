/**
 * Kalman Filter + GPS Smoothing — Unit Tests
 * STORY-00139: GPS Kalman Filter + Dynamic Sampling
 */
import {
  kalmanInit,
  kalmanUpdate,
  isConsistentPoint,
  classifyMovement,
  getSamplingInterval,
  createTrackSmoother,
  smoothGPSPoint,
  haversineM,
  type GPSPoint,
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

describe('isConsistentPoint', () => {
  const basePoint: GPSPoint = {
    lat: -39.2, lng: 175.6, timestamp: 1000000, speed: 1.5, heading: 90,
  };

  it('accepts normal walking speed point', () => {
    const next: GPSPoint = {
      lat: -39.20001, lng: 175.60001, timestamp: 1001000, speed: 1.5, heading: 92,
    };
    expect(isConsistentPoint(basePoint, next)).toBe(true);
  });

  it('rejects teleportation (impossible speed)', () => {
    // 1km in 1 second = 1000 m/s
    const teleported: GPSPoint = {
      lat: -39.21, lng: 175.6, timestamp: 1001000, speed: 0, heading: 90,
    };
    expect(isConsistentPoint(basePoint, teleported)).toBe(false);
  });

  it('rejects extreme direction change at low speed (drift)', () => {
    const drifted: GPSPoint = {
      lat: -39.200001, lng: 175.600001, timestamp: 1001000, speed: 0.5, heading: 270,
    };
    expect(isConsistentPoint(basePoint, drifted)).toBe(false);
  });

  it('allows direction change at higher speed (turning)', () => {
    const turning: GPSPoint = {
      lat: -39.20002, lng: 175.60002, timestamp: 1002000, speed: 2.0, heading: 270,
    };
    expect(isConsistentPoint(basePoint, turning)).toBe(true);
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

describe('smoothGPSPoint (integrated smoother)', () => {
  it('accepts first point and returns it directly', () => {
    const state = createTrackSmoother();
    const result = smoothGPSPoint(state, {
      lat: -39.2, lng: 175.6, alt: 500, accuracy: 5, speed: 0, heading: 0, timestamp: 1000,
    });
    expect(result).not.toBeNull();
    expect(result!.lat).toBe(-39.2);
    expect(result!.lng).toBe(175.6);
  });

  it('smooths a noisy track', () => {
    const state = createTrackSmoother();
    const baseLat = -39.2;
    const baseLng = 175.6;

    // Simulate walking north with GPS noise
    const points: GPSPoint[] = [];
    for (let i = 0; i < 20; i++) {
      points.push({
        lat: baseLat + i * 0.00001 + (Math.random() - 0.5) * 0.00002,
        lng: baseLng + (Math.random() - 0.5) * 0.00001,
        accuracy: 8,
        speed: 1.5,
        heading: 0,
        timestamp: 1000 + i * 1000,
      });
    }

    const smoothed: number[] = [];
    for (const p of points) {
      const result = smoothGPSPoint(state, p);
      if (result) smoothed.push(result.lat);
    }

    // Smoothed track should be less noisy than raw
    const rawVariance = computeVariance(points.map(p => p.lat));
    const smoothedVariance = computeVariance(smoothed);
    expect(smoothedVariance).toBeLessThan(rawVariance);
  });

  it('rejects impossible jumps', () => {
    const state = createTrackSmoother();

    // Normal first point
    smoothGPSPoint(state, {
      lat: -39.2, lng: 175.6, accuracy: 5, speed: 1, heading: 0, timestamp: 1000,
    });

    // Teleportation: 10km jump in 1 second
    const result = smoothGPSPoint(state, {
      lat: -39.3, lng: 175.6, accuracy: 5, speed: 1, heading: 0, timestamp: 2000,
    });

    expect(result).toBeNull();
  });
});

// Helper
function computeVariance(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}
