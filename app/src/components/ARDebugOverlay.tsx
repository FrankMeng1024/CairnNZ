/**
 * ARDebugOverlay — surfaces recent breadcrumbs + cairn count + GL ready
 * state on screen, so the user can diagnose AR rendering issues without
 * needing Xcode / telemetry uploads.
 *
 * Polls crashLogger.getRecent() at 1Hz and renders the last 6 lines
 * filtered to AR-related breadcrumbs.
 *
 * Mount this beneath all overlays in ARScreen so it doesn't intercept
 * pointer events (it's pointerEvents="none" too).
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { crashLogger } from '../services/crashLogger';

interface Props {
  /** Number of cairns currently in the AR overlay. */
  cairnCount: number;
  /** Whether GL context is ready (set true once onContextCreate finishes). */
  glReady: boolean;
  /** User's GPS pos. */
  userPos: { lat: number; lng: number } | null;
  /** Heading in degrees. */
  userHeading: number | null;
}

export function ARDebugOverlay({ cairnCount, glReady, userPos, userHeading }: Props) {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const update = () => {
      const recent = crashLogger.getRecent();
      // Filter to AR-related events only and keep last 6
      const filtered = recent
        .filter((l) => /ar3d:|ar:plant:|errorBoundary:|unity-overlay:|unity-native:|unity-debug:/.test(l))
        .slice(-8)
        .map((l) => {
          // Strip ISO timestamp prefix for compactness
          const m = l.match(/^[\d-]+T[\d:.]+Z\s+(.+)$/);
          return m ? m[1] : l;
        });
      setLines(filtered);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={styles.statusRow}>
        <Text style={styles.statusText}>
          GL:{glReady ? '✓' : '✗'}  cairns:{cairnCount}
        </Text>
        <Text style={styles.statusText}>
          GPS:{userPos ? '✓' : '✗'}  hdg:{userHeading != null ? Math.round(userHeading) + '°' : '—'}
        </Text>
      </View>
      {lines.map((l, i) => (
        <Text key={i} style={styles.line} numberOfLines={1}>
          {l}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 100,
    left: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    zIndex: 200,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  statusText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  line: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 9,
    fontFamily: 'monospace',
    lineHeight: 12,
  },
});
