/**
 * R2.7 track state debounce test.
 *
 * 反 self-licking: 真调 trackStateDebounce module。如果生产代码 R2.7 逻辑回退,
 * 这些 case 一定会 FAIL,因为它们调同一个函数。
 */

import {
  TrackDebounceState,
  initialTrackDebounceState,
  onTrackEvent,
  onDowngradeTimerFire,
  HARD_CAP_MS,
  DOWNGRADE_DELAY_MS,
} from '../src/services/trackStateDebounce';

describe('R2.7 track state debounce', () => {
  it('upgrade to tracking applies immediately', () => {
    let s = initialTrackDebounceState('limited');
    const r = onTrackEvent(s, { track: 'tracking', t: 100 });
    expect(r.state.applied).toBe('tracking');
    expect(r.scheduleDowngradeAt).toBeNull();
  });

  it("'none' applies immediately, not debounced", () => {
    let s = initialTrackDebounceState('tracking');
    const r = onTrackEvent(s, { track: 'none', t: 100 });
    expect(r.state.applied).toBe('none');
    expect(r.scheduleDowngradeAt).toBeNull();
  });

  it('same-value re-render is no-op (no timer rearm — sub#A guard)', () => {
    let s = initialTrackDebounceState('limited');
    s = { ...s, applied: 'limited' };
    const r = onTrackEvent(s, { track: 'limited', t: 100 });
    expect(r.state).toBe(s);  // same reference
    expect(r.scheduleDowngradeAt).toBeNull();
  });

  it('downgrade to limited schedules 200ms timer', () => {
    let s = initialTrackDebounceState('tracking');
    const r = onTrackEvent(s, { track: 'limited', t: 100 });
    expect(r.state.applied).toBe('tracking');  // not yet applied
    expect(r.state.downgradePending).toBe(true);
    expect(r.scheduleDowngradeAt).toBe(100 + DOWNGRADE_DELAY_MS);
  });

  it('repeated limited events do not cancel-then-rearm timer (sub#B fix)', () => {
    // sub#B BLOCKER: 原代码 cancel-then-rearm → limited 反复抖动 timer 永远不 fire
    let s = initialTrackDebounceState('tracking');
    const r1 = onTrackEvent(s, { track: 'limited', t: 100 });
    expect(r1.scheduleDowngradeAt).toBe(300);  // schedule 1
    s = r1.state;
    // 第二次 limited 不应再 schedule timer (一个 timer 在跑就够)
    const r2 = onTrackEvent(s, { track: 'limited', t: 150 });
    expect(r2.scheduleDowngradeAt).toBeNull();
    expect(r2.state.downgradePending).toBe(true);
  });

  it('hard cap: cumulative limited > 200ms forces apply on next tracking', () => {
    // sub#B BLOCKER: limited 累积 > HARD_CAP_MS 时,新 tracking 来要先强制 'limited'
    let s = initialTrackDebounceState('tracking');
    // 第一次 limited (t=100) → schedule timer for 300
    let r = onTrackEvent(s, { track: 'limited', t: 100 });
    s = r.state;
    // Timer fires at t=300 → applied = 'limited', accum += 300-100 = 200
    s = onDowngradeTimerFire(s, 300);
    expect(s.applied).toBe('limited');
    expect(s.limitedAccumMs).toBe(200);
    // tracking 来 (t=350): 因 accum >= HARD_CAP_MS,强制 'limited' 而不是直接 'tracking'
    r = onTrackEvent(s, { track: 'tracking', t: 350 });
    expect(r.state.applied).toBe('limited');  // hard cap forces 'limited'
    expect(r.state.limitedAccumMs).toBe(0);   // accum reset
  });

  it('hard cap below threshold: tracking applies normally', () => {
    let s = initialTrackDebounceState('tracking');
    // limited 100ms (< 200 hard cap)
    let r = onTrackEvent(s, { track: 'limited', t: 100 });
    s = r.state;
    s = onDowngradeTimerFire(s, 300);  // accum = 200ms... wait this hits cap
    // Use shorter window: limited 100ms only
    s = initialTrackDebounceState('tracking');
    r = onTrackEvent(s, { track: 'limited', t: 100 });
    s = r.state;
    s = onDowngradeTimerFire(s, 250);  // accum = 250-100 = 150ms < 200 cap
    expect(s.applied).toBe('limited');
    expect(s.limitedAccumMs).toBe(150);
    r = onTrackEvent(s, { track: 'tracking', t: 300 });
    expect(r.state.applied).toBe('tracking');  // normal upgrade
  });

  it('limited timer fire applies limited even if not retriggered', () => {
    let s = initialTrackDebounceState('tracking');
    let r = onTrackEvent(s, { track: 'limited', t: 100 });
    s = r.state;
    // Caller schedules setTimeout for 300ms
    s = onDowngradeTimerFire(s, 300);
    expect(s.applied).toBe('limited');
    expect(s.downgradePending).toBe(false);
  });
});
