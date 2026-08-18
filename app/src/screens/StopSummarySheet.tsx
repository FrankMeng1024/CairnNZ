/**
 * StopSummarySheet — bottom sheet shown when user taps Done while tracking.
 *
 * Extracted from HikingScreen.tsx (O1 batch 21 refactor).
 * Shows completion summary, hero image, stats row, name input, and two CTAs.
 *
 * 2026-08-16 UI overhaul (H4 redesign): layout follows
 * docs/ui-redesign/sleep-run-2026-08-15/frames/H4-complete.png:
 *   - hero image uses aspectRatio (16/10) so it never crops on narrow phones
 *   - primary CTA "View Activity" → save + nav to MapHistory detail
 *   - secondary CTA "Done" → save + go Home
 *   - Discard replaced by a header X close (safety: no one-tap data loss)
 *
 * API additions (additive, non-breaking):
 *   - onConfirmAndHome(name): variant of onConfirm — save then nav Home.
 *     Falls back to onConfirm if the caller doesn't wire it (both save;
 *     only nav destination differs, decided in HikingScreen).
 *   - onDiscard retained for backward compat but no longer surfaced in UI
 *     (may be removed after full downstream migration).
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  TextInput, Animated, Easing, KeyboardAvoidingView, Platform, Keyboard,
  ActivityIndicator, Share,
} from 'react-native';
import Svg, { Polyline as SvgPolyline } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/Icon';
import { useDistance } from '../utils/distanceFormat';
import { formatDate } from '../utils/dateFormat';
import { useAppearance } from '../hooks/useAppearance';

type StopSummary = {
  distanceM: number;
  durationS: number;
  elevationGainM: number;
  activityMode: 'hiking' | 'running';
  trackPoints: Array<{ lat: number; lng: number }>;
  startedAt: number;
};

type Props = {
  summary: StopSummary;
  onCancel: () => void;
  onConfirm: (name: string) => void;
  /** 2026-08-16 (H4 redesign): optional variant — save + go Home.
   *  If omitted, the "Done" CTA falls back to onConfirm (same save
   *  path; HikingScreen decides where to navigate). */
  onConfirmAndHome?: (name: string) => void;
  /** Legacy Discard hook — no longer surfaced in the UI as of the H4
   *  redesign. Kept in the prop shape so existing callers compile; may
   *  be dropped in a follow-up once all downstream call sites are
   *  migrated. */
  onDiscard?: () => void;
  /** O14 Bug 4: when true, disable buttons + swap Save-button label to
   *  a spinner so the user sees "Saving…" while stopTracking runs its
   *  async flush → rename chain (up to 15s). */
  saving?: boolean;
  /** R114/O22 STORY-73017 (K9): detailed step from the tracking store
   *  (e.g. "Uploading your hike… (8s)"). Renders in place of the generic
   *  "Saving…" so users on long uploads get progress signal instead of
   *  a mystery spinner. */
  savingStep?: string | null;
};

/** Concept palette — locked to docs/ui-redesign/sleep-run-2026-08-15. */
const PAPER_BG = '#F9F6F3';
const CTA_GREEN = '#455D3C';
const TITLE_INK = '#1E2A24';
const MUTED_INK = '#8A8579';
const HAIRLINE = '#E9E3D8';

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
  points: Array<{ lat: number; lng: number }>;
  stroke: string;
  width: number;
  height: number;
}) {
  if (!points || points.length < 2) return null;

  // Downsample so the resulting SVG polyline stays under ~200 points.
  const step = Math.max(1, Math.floor(points.length / 200));
  const sampled: Array<{ lat: number; lng: number }> = [];
  for (let i = 0; i < points.length; i += step) sampled.push(points[i]);
  // Always include the last point so start→end reads correctly.
  if (sampled[sampled.length - 1] !== points[points.length - 1]) {
    sampled.push(points[points.length - 1]);
  }

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

  const coords = sampled
    .map(p => {
      const x = offsetX + (p.lng - minLng) * scale;
      // Invert Y (SVG origin is top-left, lat grows upward).
      const y = offsetY + (maxLat - p.lat) * scale;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <Svg width={width} height={height}>
      <SvgPolyline
        points={coords}
        fill="none"
        stroke={stroke}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function StopSummarySheet({ summary, onCancel, onConfirm, onConfirmAndHome, onDiscard: _onDiscard, saving = false, savingStep = null }: Props) {
  // _onDiscard is intentionally unused in the H4 redesign — see prop docs.
  const [name, setName] = useState('');
  // Sleep-run 2026-08-16: mini-map card width is measured at layout so the
  // SVG polyline fills the card responsively (SE 375pt → Pro Max 430pt).
  const [miniMapWidth, setMiniMapWidth] = useState(0);
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(500)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  // O12 Round-3 R3-C1 + R3-M8: settings-aware units. Users deserve
  // consistent units across distance + elevation.
  const dist = useDistance();

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();
  }, []);

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
  const heading = isRun ? 'Run Complete' : 'Hike Complete';
  const label = isRun ? 'Run' : 'Hike';
  // O18 HIST-09: default name uses user-preferred date format.
  const defaultName = `${label} — ${formatDate(summary.startedAt)}`;

  // Concept stat trio: distance / time / elevation gain. Uses the same
  // formatters as the live tracking bar so numbers are consistent.
  const distanceVal = dist.format(summary.distanceM, 2);
  const distanceLbl = dist.unit;
  const timeVal = formatDuration(summary.durationS);
  const elevVal = dist.formatElevation(summary.elevationGainM, 0);
  const elevLbl = `${dist.elevUnit} elev`;

  // R21 (2026-08-18 user "hike complete和confirm page也要follow 白天夜间"):
  // read Appearance so the sheet + text tokens swap into slate/cream when
  // the user's picked Dark (or Auto at night). Kept as inline overrides so
  // day rendering matches the concept 1:1.
  const { isDark: completeIsDark } = useAppearance();
  const sheetBg = completeIsDark ? 'rgba(15,22,38,0.98)' : PAPER_BG;
  const titleInk = completeIsDark ? '#F0EEE6' : TITLE_INK;
  const mutedInk = completeIsDark ? 'rgba(240,238,230,0.68)' : MUTED_INK;

  // Sleep-run 2026-08-16 (H4 concept): "Share this activity" action lives in
  // the header. Uses React Native's built-in Share API — iOS system share
  // sheet, no new dependency. Silent-fail on cancel (user dismissed sheet).
  const shareSummary = async () => {
    if (saving) return;
    try {
      const verb = isRun ? 'ran' : 'hiked';
      const message = `I just ${verb} ${distanceVal} ${distanceLbl} in ${timeVal} — tracked with CairnNZ.`;
      await Share.share({ message });
    } catch {
      // User cancelled or share unavailable — no-op.
    }
  };

  return (
    <Animated.View style={[stopSheetStyles.scrim, { opacity }]} pointerEvents="auto">
      <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => dismiss(onCancel)} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
        <Animated.View
          style={[
            stopSheetStyles.sheet,
            { backgroundColor: sheetBg, transform: [{ translateY: slideY }], paddingBottom: Math.max(insets.bottom, 20) + 8 },
          ]}
        >
          <View style={stopSheetStyles.handle} />

          {/* Header row: title on the left, X close on the right.
              R21 (2026-08-18 user "hike complete 不需要右上角分享"):
              share button removed. X still cancels (resume tracking). */}
          <View style={stopSheetStyles.headerRow}>
            <Text style={[stopSheetStyles.title, { color: titleInk }]} numberOfLines={1}>{heading}</Text>
            <View style={stopSheetStyles.headerActions}>
              <TouchableOpacity
                onPress={() => {
                  if (saving) return;
                  Keyboard.dismiss();
                  dismiss(onCancel);
                }}
                style={stopSheetStyles.closeHit}
                activeOpacity={0.6}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="Close and keep tracking"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={[stopSheetStyles.closeX, { color: titleInk }, saving && { opacity: 0.4 }]}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Hero image — 2026-08-17 concept H4/R4. Two extracted crops
              live side by side: the hike variant shows the cairn stack
              at a lush valley trail-head; the run variant swaps in a
              green teardrop pin on top of the same cairn stack, matching
              the concept sheet's per-activity flourish. aspectRatio 16/10
              keeps the composition centered across all target viewports. */}
          <View style={stopSheetStyles.heroWrap}>
            <Image
              source={isRun
                ? require('../../assets/running/complete-hero.png')
                : require('../../assets/hiking/complete-hero.png')}
              style={stopSheetStyles.hero}
              resizeMode="cover"
            />
          </View>

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
              <Text style={[stopSheetStyles.statLbl, { color: mutedInk }]}>time</Text>
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
              style={[stopSheetStyles.miniMapCard, completeIsDark ? { backgroundColor: 'rgba(240,238,230,0.06)', borderColor: 'rgba(220,230,240,0.14)' } : null]}
              onLayout={(e) => setMiniMapWidth(e.nativeEvent.layout.width)}
            >
              {miniMapWidth > 0 && (
                <MiniMapPolyline
                  points={summary.trackPoints}
                  stroke={CTA_GREEN}
                  width={miniMapWidth}
                  height={120}
                />
              )}
            </View>
          )}

          {/* "Great hike!" / "Great run!" positive-feedback card (concept H4/R4). */}
          <View style={[stopSheetStyles.feedbackCard, completeIsDark ? { backgroundColor: 'rgba(240,238,230,0.06)', borderColor: 'rgba(220,230,240,0.14)' } : null]}>
            <View style={stopSheetStyles.feedbackIcon}>
              <Icon name="Leaf" size={22} color={CTA_GREEN} strokeWidth={2} />
            </View>
            <View style={stopSheetStyles.feedbackText}>
              <Text style={[stopSheetStyles.feedbackTitle, { color: titleInk }]}>
                {isRun ? 'Great run!' : 'Great hike!'}
              </Text>
              <Text style={[stopSheetStyles.feedbackSubtitle, { color: mutedInk }]}>
                Another piece of your world explored.
              </Text>
            </View>
          </View>

          {/* Name input — R21 (2026-08-18 user "下方text位置 用户不知道是
              写hike的名字的 要让用户知道"): explicit label above the field
              plus a friendlier placeholder so users know this names the
              activity in their history. */}
          <Text style={[stopSheetStyles.nameLabel, { color: mutedInk }]}>{isRun ? 'Name this run (optional)' : 'Name this hike (optional)'}</Text>
          <TextInput
            style={[stopSheetStyles.nameInput, { color: titleInk, borderColor: completeIsDark ? 'rgba(220,230,240,0.14)' : 'rgba(20,42,30,0.10)', backgroundColor: completeIsDark ? 'rgba(240,238,230,0.06)' : 'rgba(255,253,247,0.5)' }]}
            placeholder={defaultName}
            placeholderTextColor={mutedInk}
            value={name}
            onChangeText={(t) => setName(t.slice(0, 60))}
            autoFocus={false}
            returnKeyType="done"
          />

          {/* Primary CTA — "View Activity" saves the hike and jumps to
              the MapHistory detail. R21 (2026-08-18 user "去掉done"):
              secondary Done button removed — a single explicit CTA is
              clearer. Cancel/close is still via the X in the header. */}
          <TouchableOpacity
            style={[stopSheetStyles.saveBtn, saving && { opacity: 0.7 }]}
            onPress={() => {
              if (saving) return;
              // O11 (2026-07-27): dismiss keyboard before invoking parent
              // so the iOS soft keyboard does not linger while stopTracking
              // is running.
              Keyboard.dismiss();
              // O14 Bug 4: do NOT dismiss the sheet here. HikingScreen
              // keeps it mounted, flips `saving` true, waits for
              // stopTracking to finish, then unmounts.
              onConfirm(name);
            }}
            activeOpacity={0.85}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Save hike and view activity"
          >
            {saving ? (
              <>
                <ActivityIndicator size="small" color={PAPER_BG} />
                <Text style={stopSheetStyles.saveText} numberOfLines={1}>
                  {savingStep || 'Saving…'}
                </Text>
              </>
            ) : (
              <Text style={stopSheetStyles.saveText}>View Activity</Text>
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
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
    zIndex: 200,
  },
  sheet: {
    backgroundColor: PAPER_BG,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingHorizontal: 24,
    gap: 16,
    // Shadow-overlay equivalent — sheet lifts off the scrim.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.10,
    shadowRadius: 24,
    elevation: 8,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: HAIRLINE,
    alignSelf: 'center',
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconBtn: {
    padding: 6,
  },
  closeHit: {
    padding: 6,
    marginRight: -6,
  },
  closeX: {
    fontSize: 20,
    fontWeight: '700',
    color: MUTED_INK,
    lineHeight: 20,
  },
  miniMapCard: {
    alignSelf: 'stretch',
    height: 120,
    borderRadius: 16,
    backgroundColor: '#EFEAE0',
    overflow: 'hidden',
  },
  feedbackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#EFEAE0',
  },
  feedbackIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#E0DACB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackText: {
    flex: 1,
    gap: 2,
  },
  feedbackTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: TITLE_INK,
    letterSpacing: -0.2,
  },
  feedbackSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: MUTED_INK,
  },
  heroWrap: {
    alignSelf: 'stretch',
    aspectRatio: 16 / 10,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: HAIRLINE,
  },
  hero: {
    width: '100%',
    height: '100%',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: TITLE_INK,
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
    color: CTA_GREEN,
    letterSpacing: -0.8,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  statLbl: {
    fontSize: 12,
    fontWeight: '600',
    color: MUTED_INK,
    textAlign: 'center',
  },
  nameLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: MUTED_INK,
    marginBottom: -8,
    marginTop: 4,
  },
  nameInput: {
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: HAIRLINE,
    fontSize: 15,
    color: TITLE_INK,
  },
  saveBtn: {
    height: 56,
    borderRadius: 28,
    backgroundColor: CTA_GREEN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveText: {
    color: PAPER_BG,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  doneHit: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  doneText: {
    fontSize: 15,
    fontWeight: '700',
    color: CTA_GREEN,
    textAlign: 'center',
  },
});
