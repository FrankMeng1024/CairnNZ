import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export function useAppIsActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    setActive(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  return active;
}

/** Wait for a committed render frame, then recheck foreground visibility. */
export function scheduleVisibleFrame(callback: () => void): () => void {
  let cancelled = false;
  const run = () => {
    if (!cancelled && AppState.currentState === 'active') callback();
  };
  if (typeof requestAnimationFrame === 'function') {
    const frame = requestAnimationFrame(run);
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }
  const timer = setTimeout(run, 0);
  return () => { cancelled = true; clearTimeout(timer); };
}
