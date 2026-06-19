/**
 * GpsLockStep — Step 1 of plant flow.
 *
 * Runs the GPS sampler service for `windowSeconds` and reports the
 * result back via onLocked(). Renders a progress bar + live accuracy
 * readout.
 *
 * Visual states:
 *   - Sampling (default): progress bar fills 0→100% over 5s
 *   - Failed (accuracy too poor / too jumpy): retry button + reason
 *   - Success: auto-advance via onLocked()
 *
 * No business logic here — all the GPS / EKF math is in
 * services/gpsSampler.ts.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { sampleGpsWindow, SampleResult } from '../services/gpsSampler';
import { GpsSamplingConfig } from '../config/plantConfig';
import { MemoryColors } from '../../memory/config/memoryConfig';

interface Props {
  onLocked: (lat: number, lng: number, accuracyM: number) => void;
  onCancel: () => void;
}

export function GpsLockStep({ onLocked, onCancel }: Props) {
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<SampleResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [retryToken, setRetryToken] = useState(0);
  // Read latest onLocked from a ref so this effect's deps array can be
  // empty — otherwise a parent re-render with an inline arrow would
  // restart the GPS sample window and leak Location subscriptions.
  const onLockedRef = useRef(onLocked);
  onLockedRef.current = onLocked;

  useEffect(() => {
    let cancelled = false;
    let raf: any = null;

    setProgress(0);
    setResult(null);
    setBusy(true);

    const start = Date.now();
    const tick = () => {
      const elapsedMs = Date.now() - start;
      const p = Math.min(1, elapsedMs / (GpsSamplingConfig.windowSeconds * 1000));
      setProgress(p);
      if (p < 1 && !cancelled) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    sampleGpsWindow().then((res) => {
      if (cancelled) return;
      setResult(res);
      setBusy(false);
      if (res.ok) onLockedRef.current(res.lat, res.lng, res.accuracyMeters);
    });

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    };
    // Re-run when the user taps "Try again" (retryToken bumps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryToken]);

  const failed = !busy && result && !result.ok;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Locking your spot…</Text>
      <Text style={styles.sub}>
        Hold still for a moment while we get an accurate reading.
      </Text>

      <View style={styles.progressBox}>
        <ActivityIndicator color={MemoryColors.sepia} size="large" />
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.progressText}>
          {busy
            ? `${Math.max(0, GpsSamplingConfig.windowSeconds - Math.round(progress * GpsSamplingConfig.windowSeconds))}s remaining`
            : result?.ok
            ? `Locked · accuracy ${result.accuracyMeters.toFixed(1)} m`
            : 'Could not lock'}
        </Text>
      </View>

      {failed && (
        <View style={styles.failBox}>
          <Text style={styles.failTitle}>{describeFailure(result)}</Text>
          <Text style={styles.failSub}>
            Move to a more open spot and try again.
          </Text>
          <TouchableOpacity style={styles.retry} onPress={() => setRetryToken((n) => n + 1)}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={{ flex: 1 }} />
      <TouchableOpacity style={styles.cancel} onPress={onCancel}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

function describeFailure(res: SampleResult | null): string {
  switch (res?.reason) {
    case 'accuracy-too-poor': return 'GPS signal is weak';
    case 'too-jumpy':         return 'GPS is jumping around';
    case 'no-readings':       return 'No GPS readings received';
    case 'permission-denied': return 'Location permission needed';
    default:                  return 'Could not lock GPS';
  }
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 22, fontWeight: '500', color: MemoryColors.sepiaDeep, marginBottom: 8 },
  sub:   { fontSize: 13, color: MemoryColors.cairnPublic, marginBottom: 20 },
  progressBox: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e8dfc8',
  },
  progressBar: {
    width: '100%',
    height: 4,
    backgroundColor: '#e8dfc8',
    borderRadius: 2,
    marginTop: 16,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: MemoryColors.sepia },
  progressText: { fontSize: 12, color: MemoryColors.cairnPublic, marginTop: 10 },
  failBox: {
    backgroundColor: '#fee5e0',
    borderColor: '#c44545',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
  },
  failTitle: { fontSize: 13, fontWeight: '500', color: '#c44545' },
  failSub:   { fontSize: 12, color: '#a83838', marginTop: 4 },
  retry: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: MemoryColors.sepia,
    borderRadius: 10,
    alignItems: 'center',
  },
  retryText: { color: '#fff', fontSize: 13, fontWeight: '500' },
  cancel: { padding: 14, alignItems: 'center' },
  cancelText: { fontSize: 14, color: MemoryColors.cairnPublic },
});
