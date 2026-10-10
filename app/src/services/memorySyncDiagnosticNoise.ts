/**
 * Coalesces a proven high-volume diagnostic only. The underlying Memory sync
 * attach decision is untouched: callers still return immediately when the
 * same owner is already attached. We retain the first observation plus a
 * bounded summary containing the exact suppressed count and time window.
 */

const SUMMARY_WINDOW_MS = 60_000;
const SUMMARY_MAX_OCCURRENCES = 250;

interface AttachSkipAggregate {
  reason: string;
  firstAtMs: number;
  lastAtMs: number;
  occurrences: number;
}

let aggregate: AttachSkipAggregate | null = null;
let summaryTimer: ReturnType<typeof setTimeout> | null = null;

function operationalLog(tag: string, fields: Record<string, unknown>): void {
  // Keep the existing lazy dependency edge: memorySync and appLog both load
  // during boot and this diagnostic must never affect their initialization.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./appLog').log(tag, fields);
}

function clearSummaryTimer(): void {
  if (summaryTimer) clearTimeout(summaryTimer);
  summaryTimer = null;
}

function scheduleSummary(): void {
  if (summaryTimer) return;
  summaryTimer = setTimeout(() => {
    summaryTimer = null;
    flushMemorySyncAttachSkipSummary('time-window');
  }, SUMMARY_WINDOW_MS);
  (summaryTimer as any)?.unref?.();
}

export function recordMemorySyncAttachSkip(
  reason = 'same-user-already-attached',
  nowMs = Date.now(),
): void {
  if (!aggregate) {
    aggregate = { reason, firstAtMs: nowMs, lastAtMs: nowMs, occurrences: 1 };
    operationalLog('memory_sync.attach_skip', {
      reason,
      coalescing: 'first-in-window',
    });
    scheduleSummary();
    return;
  }
  aggregate.lastAtMs = nowMs;
  aggregate.occurrences += 1;
  if (aggregate.occurrences >= SUMMARY_MAX_OCCURRENCES) {
    flushMemorySyncAttachSkipSummary('bounded-count');
  }
}

export function flushMemorySyncAttachSkipSummary(
  trigger: 'bounded-count' | 'time-window' | 'detach',
): void {
  clearSummaryTimer();
  const completed = aggregate;
  aggregate = null;
  if (!completed || completed.occurrences <= 1) return;
  operationalLog('memory_sync.attach_skip_summary', {
    reason: completed.reason,
    trigger,
    occurrences: completed.occurrences,
    suppressed_occurrences: completed.occurrences - 1,
    window_ms: Math.max(0, completed.lastAtMs - completed.firstAtMs),
  });
}

export const __memorySyncDiagnosticNoiseTest = {
  SUMMARY_WINDOW_MS,
  SUMMARY_MAX_OCCURRENCES,
  reset(): void {
    clearSummaryTimer();
    aggregate = null;
  },
};
