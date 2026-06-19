/**
 * Unit tests — unlockEngine
 *
 * Verifies the GPS-reading → fog-unlock pipeline:
 *   - Speed gate (drives don't unlock)
 *   - Accuracy gate (bad GPS doesn't unlock)
 *   - Duplicate cell suppression
 *   - Initial reveal idempotency
 */

import {
  processReading,
  performInitialRevealIfNeeded,
  __resetForTest,
} from '../src/features/memory/services/unlockEngine';
import { useMemoryStore } from '../src/features/memory/store/useMemoryStore';

beforeEach(() => {
  __resetForTest();
  useMemoryStore.getState().clearAll();
});

describe('unlockEngine · processReading', () => {
  it('unlocks when accuracy + speed are good', () => {
    const out = processReading({
      lat: 31.23, lng: 121.43,
      accuracyM: 5, speedMs: 1.0,
      timestampMs: Date.now(),
    });
    expect(out.kind).toBe('unlocked');
    expect(useMemoryStore.getState().points.length).toBeGreaterThan(0);
  });

  it('skips when speed is above the vehicle threshold', () => {
    const out = processReading({
      lat: 31.23, lng: 121.43,
      accuracyM: 5,
      speedMs: 20, // 72 km/h — vehicle
      timestampMs: Date.now(),
    });
    expect(out.kind).toBe('skipped');
    if (out.kind === 'skipped') expect(out.reason).toBe('speed-too-fast');
    expect(useMemoryStore.getState().points.length).toBe(0);
  });

  it('skips when accuracy is too poor', () => {
    const out = processReading({
      lat: 31.23, lng: 121.43,
      accuracyM: 100,
      speedMs: 1.0,
      timestampMs: Date.now(),
    });
    expect(out.kind).toBe('skipped');
    if (out.kind === 'skipped') expect(out.reason).toBe('accuracy-too-poor');
  });

  it('skips duplicate readings in the same cell', () => {
    const args = {
      lat: 31.23, lng: 121.43,
      accuracyM: 5, speedMs: 1.0,
      timestampMs: Date.now(),
    };
    const a = processReading(args);
    const b = processReading(args);
    expect(a.kind).toBe('unlocked');
    expect(b.kind).toBe('skipped');
    if (b.kind === 'skipped') expect(b.reason).toBe('duplicate-cell');
  });

  it('accepts a moved reading after a duplicate', () => {
    processReading({
      lat: 31.23, lng: 121.43,
      accuracyM: 5, speedMs: 1.0,
      timestampMs: Date.now(),
    });
    // Move 50m south (~0.00045 deg lat)
    const out = processReading({
      lat: 31.23 - 0.00045, lng: 121.43,
      accuracyM: 5, speedMs: 1.0,
      timestampMs: Date.now(),
    });
    expect(out.kind).toBe('unlocked');
  });
});

describe('unlockEngine · performInitialRevealIfNeeded', () => {
  it('reveals the first time and is idempotent thereafter', () => {
    const a = performInitialRevealIfNeeded(31.23, 121.43);
    const b = performInitialRevealIfNeeded(31.23, 121.43);
    expect(a).toBe(true);
    expect(b).toBe(false);
    expect(useMemoryStore.getState().initialRevealDone).toBe(true);
  });

  it('reveal is reset by store.clearAll', () => {
    performInitialRevealIfNeeded(31.23, 121.43);
    useMemoryStore.getState().clearAll();
    const out = performInitialRevealIfNeeded(31.23, 121.43);
    expect(out).toBe(true);
  });
});
