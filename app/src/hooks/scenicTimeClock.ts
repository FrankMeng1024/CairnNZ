import { AppState } from 'react-native';

type Listener = () => void;

const listeners = new Set<Listener>();
let nowMs = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: { remove: () => void } | null = null;

function emitNow(): void {
  nowMs = Date.now();
  for (const listener of listeners) listener();
}

function stopTimer(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

function startTimer(): void {
  if (timer || AppState.currentState !== 'active') return;
  timer = setInterval(emitNow, 60_000);
}

function startClock(): void {
  emitNow();
  startTimer();
  appStateSubscription = AppState.addEventListener('change', next => {
    if (next === 'active') {
      emitNow();
      startTimer();
    } else {
      stopTimer();
    }
  });
}

function stopClock(): void {
  stopTimer();
  appStateSubscription?.remove();
  appStateSubscription = null;
}

export function subscribeScenicTimeClock(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) startClock();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopClock();
  };
}

export function scenicTimeClockSnapshot(): number {
  return nowMs;
}

export const __scenicTimeClockTest = {
  reset(): void {
    listeners.clear();
    stopClock();
    nowMs = Date.now();
  },
};
