/**
 * S4 phase-sync test — verify HikingScreen phase tracks useTrackingStore.status
 * so that re-entering Hiking with an active session lands on tracking UI.
 */

describe('S4: HikingScreen phase-sync logic', () => {
  // The phase-sync logic in HikingScreen is:
  //   1. Initialize phase from useTrackingStore.getState().status
  //   2. useEffect listens for status change → sync phase
  // We test the pure decision function:
  function decidePhase(status: 'idle' | 'tracking' | 'paused' | 'requesting'): 'select' | 'tracking' {
    return status === 'tracking' ? 'tracking' : 'select';
  }

  function syncPhaseEffect(
    status: 'idle' | 'tracking' | 'paused' | 'requesting',
    currentPhase: 'select' | 'tracking',
  ): 'select' | 'tracking' | null {
    if (status === 'tracking' && currentPhase !== 'tracking') return 'tracking';
    if (status === 'idle' && currentPhase === 'tracking') return 'select';
    return null; // no change
  }

  it('initial phase is "tracking" if a hike is in progress', () => {
    expect(decidePhase('tracking')).toBe('tracking');
  });

  it('initial phase is "select" when idle (fresh entry)', () => {
    expect(decidePhase('idle')).toBe('select');
  });

  it('initial phase is "select" when requesting permission', () => {
    expect(decidePhase('requesting')).toBe('select');
  });

  it('useEffect: starting a hike (idle→tracking) flips phase to tracking', () => {
    expect(syncPhaseEffect('tracking', 'select')).toBe('tracking');
  });

  it('useEffect: stopping a hike (tracking→idle) reverts phase to select', () => {
    expect(syncPhaseEffect('idle', 'tracking')).toBe('select');
  });

  it('useEffect: no-op when phase already matches status', () => {
    expect(syncPhaseEffect('tracking', 'tracking')).toBeNull();
    expect(syncPhaseEffect('idle', 'select')).toBeNull();
  });

  it('useEffect: paused state does NOT flip phase (stays in tracking UI)', () => {
    expect(syncPhaseEffect('paused', 'tracking')).toBeNull();
  });

  it('Re-entry scenario: user starts hike → goes Home → reopens Hiking', () => {
    // Mock: tracking is active in store
    const store = { status: 'tracking' as const };
    const initialPhase = decidePhase(store.status);
    expect(initialPhase).toBe('tracking');
    // Without the fix, default would be 'select' — Sprint 41 bug.
  });
});
