/**
 * Sprint 72 STORY-00553 — getSamplingInterval background context.
 */
import { getSamplingInterval, BG_SAMPLING } from '../geo';

describe('getSamplingInterval — Sprint 72 background downgrade', () => {
  test('background + battery=0.4 + running + !charging → BG rate', () => {
    expect(
      getSamplingInterval('running', false, { appState: 'background', batteryLevel: 0.4, isCharging: false })
    ).toBe(BG_SAMPLING.RUNNING_MS); // 1000
  });

  test('foreground + running → tight rate (500)', () => {
    expect(
      getSamplingInterval('running', false, { appState: 'active', batteryLevel: 0.4, isCharging: false })
    ).toBe(500);
  });

  test('background + charging → tight rate', () => {
    expect(
      getSamplingInterval('running', false, { appState: 'background', batteryLevel: 0.4, isCharging: true })
    ).toBe(500);
  });

  test('background + battery ≥50% → tight rate', () => {
    expect(
      getSamplingInterval('running', false, { appState: 'background', batteryLevel: 0.55, isCharging: false })
    ).toBe(500);
  });

  test('background + walking → BG walking rate (3000)', () => {
    expect(
      getSamplingInterval('walking', false, { appState: 'background', batteryLevel: 0.4, isCharging: false })
    ).toBe(BG_SAMPLING.WALKING_MS);
  });

  test('background + static → BG static rate (15000)', () => {
    expect(
      getSamplingInterval('static', false, { appState: 'background', batteryLevel: 0.4, isCharging: false })
    ).toBe(BG_SAMPLING.STATIC_MS);
  });

  test('battery low <20% forces 2000 regardless of AppState', () => {
    expect(getSamplingInterval('running', true, { appState: 'active' })).toBe(2000);
    expect(getSamplingInterval('running', true, { appState: 'background', batteryLevel: 0.4 })).toBe(2000);
  });

  test('legacy call without opts still works (foreground default)', () => {
    expect(getSamplingInterval('running')).toBe(500);
    expect(getSamplingInterval('walking')).toBe(1000);
    expect(getSamplingInterval('static')).toBe(10000);
  });

  test('inactive state treated as background', () => {
    expect(
      getSamplingInterval('running', false, { appState: 'inactive', batteryLevel: 0.4, isCharging: false })
    ).toBe(BG_SAMPLING.RUNNING_MS);
  });
});
