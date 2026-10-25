/**
 * StopSummarySheet — bottom sheet shown when user taps Done while tracking.
 *
 * Extracted from HikingScreen.tsx (O1 batch 21 refactor).
 * Shows the finish intent, trace summary, optional name, and final CTA.
 *
 * The close action keeps tracking; the final CTA delegates persistence and
 * Activity Detail navigation to the parent. The legacy onDiscard prop remains
 * in the contract but is intentionally not surfaced as a one-tap action.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, Animated, Easing, KeyboardAvoidingView, Platform, Keyboard,
  ActivityIndicator,
} from 'react-native';
import Svg, { Polyline as SvgPolyline } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDistance } from '../utils/distanceFormat';
import { formatDate } from '../utils/dateFormat';
import { useVisualTheme } from '../hooks/useVisualTheme';
import type { ActivityFinishProgress } from '../store/useTrackingStore';
import { cairnText } from '../i18n/runtime';

export type StopSummary = {
  distanceM: number;
  durationS: number;
  elevationGainM: number;
  activityMode: 'hiking' | 'running';
  trackPoints: Array<{ lat: number; lng: number; segmentId?: string }>;
  startedAt: number;
};

type Props = {
  summary: StopSummary;
  onCancel: () => void;
  onConfirm: (name: string) => void;
  /** Legacy Discard hook — no longer surfaced in the UI as of the H4
   *  redesign. Kept in the prop shape so existing callers compile; may
   *  be dropped in a follow-up once all downstream call sites are
   *  migrated. */
  onDiscard?: () => void;
  /** Finish is still reconciling or selecting the stable route. */
  saving?: boolean;
  /** Retained only for source compatibility; internal step copy is never rendered. */
  savingStep?: string | null;
  finishProgress?: ActivityFinishProgress | null;
  syncState?: 'synced' | 'pending' | 'syncing' | 'sync_error';
  /** Once true, summary.trackPoints is the selected route used by Detail/reload/Save as Route. */
  committed?: boolean;
  /** The selected route remains usable while optional online work is pending. */
  refining?: boolean;
  roadRefinementPending?: boolean;
  routeRefined?: boolean;
  onViewActivity?: () => void;
};

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Sleep-run 2026-08-16: mini-map polyline preview.
 *
 * Projects trackPoints (lat/lng) into an SVG viewBox with padding. This is a
 * fallback renderer used everywhere — Mapbox on the summary sheet would add
 * cost + complexity for a static preview. The rounded card behind the SVG
 * mirrors the concept H4/R4 mini-map style (see CONCEPT_TRUTH.md).
 *
 * Returns null if fewer than 2 points (nothing to draw). Aggressively
 * downsamples if the track is long (>200 points → every Nth point) so the
 * SVG string stays small on Metro/Hermes.
 */
function MiniMapPolyline({ points, stroke, width, height }: {
  points: Array<{ lat: number; lng: number; segmentId?: string }>;
  stroke: string;
  width: number;
  height: number;
}) {
  if (!points || points.length < 2) return null;

  // Downsample so the resulting SVG polyline stays under ~200 points.
  const step = Math.max(1, Math.floor(points.length / 200));
  const segments: Array<Array<{ lat: number; lng: number; segmentId?: string }>> = [];
  for (const point of points) {
    const prior = segments[segments.length - 1];
    if (!prior || (prior[0].segmentId ?? 'legacy-0') !== (point.segmentId ?? 'legacy-0')) {
      segments.push([point]);
    } else {
      prior.push(point);
    }
  }
  const sampledSegments = segments.map(segment => {
    const sampled = segment.filter((_, index) => index % step === 0);
    if (sampled[sampled.length - 1] !== segment[segment.length - 1]) sampled.push(segment[segment.length - 1]);
    return sampled;
  }).filter(segment => segment.length >= 2);
  const sampled = sampledSegments.flat();

  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of sampled) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const latSpan = Math.max(1e-6, maxLat - minLat);
  const lngSpan = Math.max(1e-6, maxLng - minLng);
  const pad = 8;
  const w = width - pad * 2;
  const h = height - pad * 2;
  // Preserve aspect ratio (approximate — good enough for a preview at this scale).
  const scale = Math.min(w / lngSpan, h / latSpan);
  const offsetX = pad + (w - lngSpan * scale) / 2;
  const offsetY = pad + (h - latSpan * scale) / 2;

  const project = (p: { lat: number; lng: number }) => {
      const x = offsetX + (p.lng - minLng) * scale;
      // Invert Y (SVG origin is top-left, lat grows upward).
      const y = offsetY + (maxLat - p.lat) * scale;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
  };

  return (
    <Svg width={width} height={height}>
      {sampledSegments.map((segment, index) => (
        <SvgPolyline
          key={`${segment[0]?.segmentId ?? 'legacy'}-${index}`}
          points={segment.map(project).join(' ')}
          fill="none"
          stroke={stroke}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </Svg>
  );
}

export function StopSummarySheet({
  summary,
  onCancel,
  onConfirm,
  onDiscard: _onDiscard,
  saving = false,
  savingStep = null,
  finishProgress = null,
  syncState = 'pending',
  committed = false,
  refining = false,
  roadRefinementPending,
  routeRefined = false,
  onViewActivity,
}: Props) {
  // _onDiscard is intentionally unused in the H4 redesign — see prop docs.
  const [name, setName] = useState('');
  // Sleep-run 2026-08-16: mini-map card width is measured at layout so the
  // SVG polyline fills the card responsively (SE 375pt → Pro Max 430pt).
  const [miniMapWidth, setMiniMapWidth] = useState(0);
  const [showCompletedRail, setShowCompletedRail] = useState(false);
  const insets = useSafeAreaInsets();
  // RN Web can leave the native-driver entrance value stranded when the QA
  // replay has just released its deterministic clock. Start Web at its final
  // accessible position; native retains the light 280 ms sheet entrance.
  const slideY = useRef(new Animated.Value(Platform.OS === 'web' ? 0 : 500)).current;
  const opacity = useRef(new Animated.Value(Platform.OS === 'web' ? 1 : 0)).current;
  // O12 Round-3 R3-C1 + R3-M8: settings-aware units. Users deserve
  // consistent units across distance + elevation.
  const dist = useDistance();

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    const completionSynced = syncState === 'synced' || finishProgress?.sync === 'synced';
    if (!committed || !completionSynced) {
      setShowCompletedRail(false);
      return undefined;
    }
    setShowCompletedRail(true);
    if (saving) return undefined;
    const timer = setTimeout(() => setShowCompletedRail(false), 1_200);
    return () => clearTimeout(timer);
  }, [committed, finishProgress?.sync, saving, syncState]);

  // v407 fix #6: dismiss guard — prevents a double-dismiss race where
  // the scrim tap during the 220ms exit animation would fire onCancel
  // after onConfirm had already started (resulting in resumeTracking
  // running against a torn-down tracking store).
  const dismissedRef = useRef(false);
  const dismiss = (then?: () => void) => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    Animated.parallel([
      Animated.timing(slideY, { toValue: 500, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => then?.());
  };

  const isRun = summary.activityMode === 'running';
  const completionSync = syncState === 'sync_error'
    ? 'attention' as const
    : syncState === 'syncing'
      ? 'syncing' as const
      : syncState === 'synced'
        ? 'synced' as const
        : finishProgress?.sync ?? 'pending';
  const routeReady = committed && (finishProgress?.route ?? 'ready') === 'ready';
  const heading = routeReady
    ? (isRun ? cairnText('stop-summary-sheet.run-complete') : cairnText('stop-summary-sheet.hike-complete'))
    : saving
      ? (isRun ? cairnText('stop-summary-sheet.finishing-run') : cairnText('stop-summary-sheet.finishing-hike'))
      : (isRun ? cairnText('stop-summary-sheet.finish-run') : cairnText('stop-summary-sheet.finish-hike'));
  const label = isRun ? cairnText('stop-summary-sheet.run') : cairnText('stop-summary-sheet.hike');
  // O18 HIST-09: default name uses user-preferred date format.
  const defaultName = cairnText('stop-summary-sheet.value-value', { label: label, value2: formatDate(summary.startedAt) });

  // Concept stat trio: distance / time / elevation gain. Uses the same
  // formatters as the live tracking bar so numbers are consistent.
  const distanceVal = dist.format(summary.distanceM, 2);
  const distanceLbl = dist.unit;
  const timeVal = formatDuration(summary.durationS);
  const elevVal = dist.formatElevation(summary.elevationGainM, 0);
  const elevLbl = `${dist.elevUnit} elev`;

  // The summary is a shared semantic sheet in all three appearances.
  const completeTheme = useVisualTheme();
  const sheetBg = completeTheme.sheetSurface;
  const titleInk = completeTheme.textPrimary;
  const mutedInk = completeTheme.textSecondary;
  const actionColor = completeTheme.primaryAction;
  const actionForeground = completeTheme.onPrimary;
  const committedSync = completionSync;
  const visibleProgress: ActivityFinishProgress | null = saving
    ? finishProgress ?? {
        hike: 'saving', route: 'pending', sync: 'pending', roadRefinementPending: false,
      }
    : committed && (committedSync !== 'synced' || showCompletedRail)
      ? {
          ...(finishProgress ?? {
          hike: 'saved',
          route: 'ready',
          sync: committedSync,
          roadRefinementPending: false,
          }),
          sync: committedSync,
          roadRefinementPending: roadRefinementPending
            ?? finishProgress?.roadRefinementPending
            ?? false,
        }
      : null;
  const progressRows = visibleProgress ? [
    { key: 'hike', label: visibleProgress.hike === 'saved' ? cairnText('stop-summary-sheet.value-saved', { label: label }) : cairnText('stop-summary-sheet.saving-value', { value1: label.toLowerCase() }), state: visibleProgress.hike === 'saved' ? 'complete' : 'current' },
    { key: 'route', label: visibleProgress.route === 'ready' ? cairnText('stop-summary-sheet.route-ready') : cairnText('stop-summary-sheet.refining-route'), state: visibleProgress.route === 'ready' ? 'complete' : visibleProgress.route === 'refining' ? 'current' : 'pending' },
    { key: 'sync', label: visibleProgress.sync === 'synced' ? cairnText('stop-summary-sheet.synced') : visibleProgress.sync === 'waiting' ? cairnText('stop-summary-sheet.sync-waiting-for-connection') : visibleProgress.sync === 'attention' ? cairnText('stop-summary-sheet.sync-needs-attention') : visibleProgress.sync === 'syncing' ? cairnText('stop-summary-sheet.syncing') : cairnText('stop-summary-sheet.sync'), state: visibleProgress.sync === 'synced' ? 'complete' : visibleProgress.sync === 'waiting' ? 'waiting' : visibleProgress.sync === 'attention' ? 'attention' : visibleProgress.sync === 'syncing' ? 'current' : 'pending' },
  ] as const : [];

  return (
    <Animated.View style={[stopSheetStyles.scrim, { opacity, backgroundColor: completeTheme.scrim }]} pointerEvents="auto">
      <TouchableOpacity
        style={StyleSheet.absoluteFillObject}
        activeOpacity={1}
        onPress={() => { if (!saving) dismiss(onCancel); }}
        disabled={saving}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
        <Animated.View
          style={[
            stopSheetStyles.sheet,
            { backgroundColor: sheetBg, borderColor: completeTheme.borderSubtle, shadowColor: completeTheme.shadow, transform: [{ translateY: slideY }], paddingBottom: Math.max(insets.bottom, 20) + 8 },
          ]}
        >
          <View style={[stopSheetStyles.handle, { backgroundColor: completeTheme.borderStrong }]} />

          {/* Outside tap is the quiet cancel/resume action when not saving. */}
          <View style={stopSheetStyles.headerRow}>
            <Text style={[stopSheetStyles.title, { color: titleInk }]} numberOfLines={1}>{heading}</Text>
          </View>

          {visibleProgress ? (
            <View style={stopSheetStyles.progressRail} testID="activity-finish-progress-rail">
              {progressRows.map(row => (
                <View key={row.key} style={stopSheetStyles.progressRow} testID={`activity-finish-${row.key}`}>
                  <View style={stopSheetStyles.progressIndicator}>
                    {row.state === 'current' ? (
                      <ActivityIndicator size="small" color={actionColor} />
                    ) : (
                      <Text style={[
                        stopSheetStyles.progressGlyph,
                        { color: row.state === 'complete' ? actionColor : mutedInk },
                      ]}>{row.state === 'complete' ? '✓' : row.state === 'waiting' ? '☁' : row.state === 'attention' ? '!' : '○'}</Text>
                    )}
                  </View>
                  <Text style={[
                    stopSheetStyles.progressLabel,
                    { color: row.state === 'pending' ? mutedInk : titleInk },
                  ]}>{row.label}</Text>
                </View>
              ))}
              {visibleProgress.roadRefinementPending ? (
                <Text style={[stopSheetStyles.progressNote, { color: mutedInk }]}>{cairnText('stop-summary-sheet.road-refinement-will-continue-when-online')}</Text>
              ) : null}
            </View>
          ) : null}

          {/* Three-stat row: value on top (30pt weight 900), label beneath
              (12pt muted). Distance uses user's unit preference; time
              formats to h:mm:ss when >= 1h else m:ss; elevation rounds to
              whole units (m or ft). */}
          <View style={stopSheetStyles.statsRow}>
            <View style={stopSheetStyles.statCol}>
              <Text style={[stopSheetStyles.statVal, { color: titleInk }]} numberOfLines={1}>{distanceVal}</Text>
              <Text style={[stopSheetStyles.statLbl, { color: mutedInk }]}>{distanceLbl}</Text>
            </View>
            <View style={stopSheetStyles.statCol}>
              <Text style={[stopSheetStyles.statVal, { color: titleInk }]} numberOfLines={1}>{timeVal}</Text>
              <Text style={[stopSheetStyles.statLbl, { color: mutedInk }]}>{cairnText('stop-summary-sheet.time')}</Text>
            </View>
            <View style={stopSheetStyles.statCol}>
              <Text style={[stopSheetStyles.statVal, { color: titleInk }]} numberOfLines={1}>{elevVal}</Text>
              <Text style={[stopSheetStyles.statLbl, { color: mutedInk }]}>{elevLbl}</Text>
            </View>
          </View>

          {/* Mini-map preview card. R21 (2026-08-18 user "数字下有一行空的div
              不知道是啥"): only render when there are enough trackPoints to
              draw a polyline — an empty card just below the stats looked
              like a mystery blank div when the hike had 0 points. */}
          {summary.trackPoints.length >= 2 && (
            <View
              style={[stopSheetStyles.miniMapCard, { backgroundColor: completeTheme.surfaceSecondary, borderColor: completeTheme.borderSubtle }]}
              onLayout={(e) => setMiniMapWidth(e.nativeEvent.layout.width)}
            >
              {miniMapWidth > 0 && (
                <MiniMapPolyline
                  points={summary.trackPoints}
                  stroke={actionColor}
                  width={miniMapWidth}
                  height={120}
                />
              )}
              <Text style={[stopSheetStyles.routePreviewLabel, { color: mutedInk }]}>
                {committed ? cairnText('stop-summary-sheet.route-ready') : cairnText('stop-summary-sheet.walked-route-preview')}
              </Text>
            </View>
          )}

          {/* Name input — R21 (2026-08-18 user "下方text位置 用户不知道是
              写hike的名字的 要让用户知道"): explicit label above the field
              plus a friendlier placeholder so users know this names the
              activity in their history. */}
          {!committed ? (
            <>
              <Text style={[stopSheetStyles.nameLabel, { color: mutedInk }]}>{isRun ? cairnText('stop-summary-sheet.name-this-run-optional') : cairnText('stop-summary-sheet.name-this-hike-optional')}</Text>
              <TextInput
                style={[stopSheetStyles.nameInput, { color: titleInk, borderColor: completeTheme.borderSubtle, backgroundColor: completeTheme.inputSurface }]}
                placeholder={defaultName}
                placeholderTextColor={mutedInk}
                value={name}
                onChangeText={(t) => setName(t.slice(0, 60))}
                autoFocus={false}
                returnKeyType="done"
              />
            </>
          ) : (
            <Text style={[stopSheetStyles.finalRouteNote, { color: mutedInk }]}>
              {routeRefined ? cairnText('stop-summary-sheet.route-refined') : refining ? cairnText('stop-summary-sheet.route-ready') : cairnText('stop-summary-sheet.route-saved-on-this-device')}
            </Text>
          )}

          {/* Primary CTA — "View Activity" saves the hike and jumps to
              the MapHistory detail. R21 (2026-08-18 user "去掉done"):
              secondary Done button removed — a single explicit CTA is
              clearer. Cancel/close remains available by tapping outside the sheet. */}
          <TouchableOpacity
            style={[stopSheetStyles.saveBtn, { backgroundColor: actionColor }, saving && { opacity: 0.7 }]}
            onPress={() => {
              if (saving) return;
              // O11 (2026-07-27): dismiss keyboard before invoking parent
              // so the iOS soft keyboard does not linger while stopTracking
              // is running.
              Keyboard.dismiss();
              // O14 Bug 4: do NOT dismiss the sheet here. HikingScreen
              // keeps it mounted, flips `saving` true, waits for
              // stopTracking to finish, then unmounts.
              if (committed) onViewActivity?.();
              else onConfirm(name);
            }}
            activeOpacity={0.85}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel={cairnText('stop-summary-sheet.finish-value-and-view-activity', { value1: label.toLowerCase() })}
          >
            {saving ? (
              <>
                <ActivityIndicator size="small" color={actionForeground} />
                <Text style={[stopSheetStyles.saveText, { color: actionForeground }]} numberOfLines={1}>{cairnText('stop-summary-sheet.finishing')}</Text>
              </>
            ) : (
              <Text style={[stopSheetStyles.saveText, { color: actionForeground }]}>{committed ? cairnText('stop-summary-sheet.view-activity') : cairnText('stop-summary-sheet.finish-value', { value1: label.toLowerCase() })}</Text>
            )}
          </TouchableOpacity>
        </Animated.View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

const stopSheetStyles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 200,
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingTop: 10,
    paddingHorizontal: 24,
    gap: 16,
    // Shadow-overlay equivalent — sheet lifts off the scrim.
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.10,
    shadowRadius: 24,
    elevation: 8,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 4,
  },
  progressRail: {
    alignSelf: 'stretch',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 7,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 22,
  },
  progressIndicator: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressGlyph: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
  },
  progressLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  progressNote: {
    marginLeft: 38,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  miniMapCard: {
    alignSelf: 'stretch',
    height: 120,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  routePreviewLabel: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'left',
    flexShrink: 1,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statVal: {
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.8,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  statLbl: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  nameLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: -8,
    marginTop: 4,
  },
  nameInput: {
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    fontSize: 15,
  },
  finalRouteNote: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  saveBtn: {
    height: 56,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveText: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
});
