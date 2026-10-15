import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line, Polyline, Rect } from 'react-native-svg';
import { useNavigation, useRoute } from '@react-navigation/native';
import { BackButton } from '../components/BackButton';
import { FontSize, Radius, Spacing } from '../components/tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { useSettingsStore } from '../store/useSettingsStore';
import type { LngLat } from '../services/routing/corridor/PolylineSampler';
import {
  getRouteDrawingTrace,
  listRouteDrawingOperationIds,
  replayRouteOperationEvidence,
  replayRouteDrawingFixture,
  replayRouteDrawingTrace,
  type RouteOperationReplayEvidence,
  type RouteDrawingReplayResult,
} from '../features/routeDrawing/routeDrawingTrace';
import {
  DEFAULT_ROUTE_DRAWING_REPLAY_FIXTURE,
  HUMAN_ROUTE_DRAWING_FIXTURES,
} from '../features/routeDrawing/humanIntentFixtures';

const CANVAS_WIDTH = 358;
const CANVAS_HEIGHT = 330;
const CANVAS_PADDING = 24;

function pathPoints(points: LngLat[], all: LngLat[]): string {
  if (points.length === 0 || all.length === 0) return '';
  const lngs = all.map(point => point.lng);
  const lats = all.map(point => point.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lngSpan = Math.max(1e-9, maxLng - minLng);
  const latSpan = Math.max(1e-9, maxLat - minLat);
  const scale = Math.min(
    (CANVAS_WIDTH - CANVAS_PADDING * 2) / lngSpan,
    (CANVAS_HEIGHT - CANVAS_PADDING * 2) / latSpan,
  );
  const usedWidth = lngSpan * scale;
  const usedHeight = latSpan * scale;
  const left = (CANVAS_WIDTH - usedWidth) / 2;
  const top = (CANVAS_HEIGHT - usedHeight) / 2;
  return points.map(point => {
    const x = left + (point.lng - minLng) * scale;
    const y = top + (maxLat - point.lat) * scale;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function ReplayCanvas({ replay }: { replay: RouteDrawingReplayResult }) {
  const overlays = replay.overlays;
  const all = [
    ...overlays.originalRoute,
    ...overlays.rawStroke,
    ...overlays.providerCandidate,
    ...replay.legacyGeometry,
    ...overlays.finalGeometry,
    ...overlays.recordedFinalGeometry,
  ];
  const grid = [55, 110, 165, 220, 275];
  return (
    <View style={styles.canvasCard}>
      <Svg width={CANVAS_WIDTH} height={CANVAS_HEIGHT}>
        <Rect x={0} y={0} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} rx={14} fill="#F7F5ED" />
        {grid.map(value => <Line key={`h-${value}`} x1={0} x2={CANVAS_WIDTH} y1={value} y2={value} stroke="#E4E0D5" strokeWidth={1} />)}
        {grid.map(value => <Line key={`v-${value}`} y1={0} y2={CANVAS_HEIGHT} x1={value} x2={value} stroke="#E4E0D5" strokeWidth={1} />)}
        <Polyline points={pathPoints(overlays.originalRoute, all)} fill="none" stroke="#7B817C" strokeWidth={7} strokeDasharray="9 7" opacity={0.7} />
        <Polyline points={pathPoints(replay.legacyGeometry, all)} fill="none" stroke="#C75662" strokeWidth={4} strokeDasharray="4 6" opacity={0.8} />
        <Polyline points={pathPoints(overlays.providerCandidate, all)} fill="none" stroke="#3C79A8" strokeWidth={4} strokeDasharray="2 5" opacity={0.85} />
        <Polyline points={pathPoints(overlays.rawStroke, all)} fill="none" stroke="#C87941" strokeWidth={5} opacity={0.95} />
        <Polyline points={pathPoints(overlays.finalGeometry, all)} fill="none" stroke="#1E6B45" strokeWidth={3} opacity={1} />
        {overlays.recordedFinalGeometry.length > 1 ? (
          <Polyline points={pathPoints(overlays.recordedFinalGeometry, all)} fill="none" stroke="#704B9E" strokeWidth={2} strokeDasharray="10 4" />
        ) : null}
      </Svg>
      <View style={styles.legend}>
        <Legend color="#7B817C" label="Original" />
        <Legend color="#C87941" label="Finger" />
        <Legend color="#3C79A8" label="Provider" />
        <Legend color="#C75662" label="Before" />
        <Legend color="#1E6B45" label="Final" />
      </View>
    </View>
  );
}

function CapturedEvidenceCanvas({ evidence }: { evidence: RouteOperationReplayEvidence }) {
  const all = [
    ...evidence.preStateGeometry,
    ...evidence.inputGeometry,
    ...evidence.providerGeometry,
    ...evidence.selectedGeometry,
    ...evidence.finalGeometry,
  ];
  const grid = [55, 110, 165, 220, 275];
  return (
    <View style={styles.canvasCard}>
      <Svg width={CANVAS_WIDTH} height={CANVAS_HEIGHT}>
        <Rect x={0} y={0} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} rx={14} fill="#F7F5ED" />
        {grid.map(value => <Line key={`h-${value}`} x1={0} x2={CANVAS_WIDTH} y1={value} y2={value} stroke="#E4E0D5" strokeWidth={1} />)}
        {grid.map(value => <Line key={`v-${value}`} y1={0} y2={CANVAS_HEIGHT} x1={value} x2={value} stroke="#E4E0D5" strokeWidth={1} />)}
        <Polyline points={pathPoints(evidence.preStateGeometry, all)} fill="none" stroke="#7B817C" strokeWidth={7} strokeDasharray="9 7" opacity={0.7} />
        <Polyline points={pathPoints(evidence.inputGeometry, all)} fill="none" stroke="#C87941" strokeWidth={5} opacity={0.95} />
        <Polyline points={pathPoints(evidence.providerGeometry, all)} fill="none" stroke="#3C79A8" strokeWidth={4} strokeDasharray="2 5" opacity={0.85} />
        <Polyline points={pathPoints(evidence.selectedGeometry, all)} fill="none" stroke="#1E6B45" strokeWidth={4} opacity={1} />
        <Polyline points={pathPoints(evidence.finalGeometry, all)} fill="none" stroke="#704B9E" strokeWidth={2} strokeDasharray="10 4" />
      </Svg>
      <View style={styles.legend}>
        <Legend color="#7B817C" label="Pre-state" />
        <Legend color="#C87941" label="Input" />
        <Legend color="#3C79A8" label="Provider" />
        <Legend color="#1E6B45" label="Selected" />
        <Legend color="#704B9E" label="Committed" />
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

export function RouteDrawingReplayScreen() {
  const nav = useNavigation();
  const route = useRoute<any>();
  const theme = useVisualTheme();
  const debugMode = useSettingsStore(state => state.debugMode);
  const fixtureIds = Object.keys(HUMAN_ROUTE_DRAWING_FIXTURES);
  const [fixtureId, setFixtureId] = useState<string>(route.params?.fixtureId ?? 'flattenV');
  const capturedTrace = useMemo(() => route.params?.sessionId
    ? getRouteDrawingTrace(route.params.sessionId)
    : null, [route.params?.sessionId]);
  const operationIds = useMemo(() => capturedTrace ? listRouteDrawingOperationIds(capturedTrace) : [], [capturedTrace]);
  const [operationId, setOperationId] = useState<string | undefined>(route.params?.operationId);
  useEffect(() => {
    if (!capturedTrace) return;
    if (!operationId || !operationIds.includes(operationId)) setOperationId(operationIds.at(-1));
  }, [capturedTrace, operationId, operationIds]);
  const selectedOperationId = operationId ?? operationIds.at(-1);
  const capturedEvidence = useMemo(() => capturedTrace
    ? replayRouteOperationEvidence(capturedTrace, selectedOperationId)
    : null, [capturedTrace, selectedOperationId]);
  const replay = useMemo(() => {
    if (capturedTrace) {
      return replayRouteDrawingTrace(capturedTrace, selectedOperationId);
    }
    return replayRouteDrawingFixture(
      HUMAN_ROUTE_DRAWING_FIXTURES[fixtureId] ?? DEFAULT_ROUTE_DRAWING_REPLAY_FIXTURE,
    );
  }, [capturedTrace, fixtureId, selectedOperationId]);
  const zoomComparison = useMemo(() => {
    if (capturedTrace || fixtureId !== 'flattenVWideZoom' || !replay) return null;
    const fixture = HUMAN_ROUTE_DRAWING_FIXTURES.flattenVWideZoom;
    const neighborhood = replayRouteDrawingFixture({
      ...fixture,
      viewport: { ...fixture.viewport, zoom: 17 },
    });
    return {
      wideZoom: fixture.viewport.zoom,
      neighborhoodZoom: neighborhood.fixture.viewport.zoom,
      sameFinal: JSON.stringify(replay.decision.finalGeometry) === JSON.stringify(neighborhood.decision.finalGeometry),
      wideMaxDeviationPx: replay.decision.metrics.selected.maxDeviationPx,
      neighborhoodMaxDeviationPx: neighborhood.decision.metrics.selected.maxDeviationPx,
    };
  }, [capturedTrace, fixtureId, replay]);

  // Route drawing capture is deliberately available in the installed
  // Owner-test runtime when the Owner explicitly enables Debug mode. It is
  // local and opt-in; unlike the Activity simulator it does not depend on a
  // development build capability.
  if (!debugMode) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.background }]}>
        <SafeAreaView>
          <BackButton onPress={() => nav.goBack()} />
          <Text style={[styles.unavailable, { color: theme.foreground }]}>Route replay is available only in internal Debug mode.</Text>
        </SafeAreaView>
      </View>
    );
  }

  const selected = replay?.decision.metrics.selected;
  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <BackButton onPress={() => nav.goBack()} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: theme.foreground }]}>Route drawing replay</Text>
            <Text style={[styles.subtitle, { color: theme.foregroundSecondary }]}>{capturedEvidence?.operationId ?? replay?.fixture.id ?? capturedTrace?.sessionId}</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {!capturedTrace ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fixtureRow}>
              {fixtureIds.map(id => (
                <TouchableOpacity
                  key={id}
                  style={[styles.fixtureChip, { borderColor: theme.border }, fixtureId === id && { backgroundColor: theme.primary }]}
                  onPress={() => setFixtureId(id)}
                >
                  <Text style={[styles.fixtureChipText, { color: fixtureId === id ? theme.onPrimary : theme.foreground }]}>{id}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fixtureRow}>
              {operationIds.map((id, index) => (
                <TouchableOpacity
                  key={id}
                  style={[styles.fixtureChip, { borderColor: theme.border }, selectedOperationId === id && { backgroundColor: theme.primary }]}
                  onPress={() => setOperationId(id)}
                ><Text style={[styles.fixtureChipText, { color: selectedOperationId === id ? theme.onPrimary : theme.foreground }]}>#{index + 1} {id.includes(':point:') ? 'Point' : id.endsWith(':session') ? 'Session' : 'Draw'}</Text></TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {replay ? <ReplayCanvas replay={replay} /> : capturedEvidence ? <CapturedEvidenceCanvas evidence={capturedEvidence} /> : null}
          <View style={[styles.summaryCard, { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle }]}>
            <Text style={[styles.summaryTitle, { color: theme.foreground }]}>Replay result</Text>
            {replay && selected ? <>
            <Text style={[styles.summaryLine, { color: theme.foregroundSecondary }]}>Intent: {replay.decision.intent}</Text>
            {capturedEvidence ? <Text style={[styles.summaryLine, { color: theme.foregroundSecondary }]}>Recorded outcome: {capturedEvidence.outcome} · {capturedEvidence.reason ?? 'no rejection reason'}</Text> : null}
            <Text style={[styles.summaryLine, { color: theme.foregroundSecondary }]}>Selected: {replay.decision.selectionSource}</Text>
            <Text style={[styles.summaryLine, { color: theme.foregroundSecondary }]}>First divergence: {replay.divergenceStage ?? 'none'}</Text>
            <Text style={[styles.summaryLine, { color: theme.foregroundSecondary }]}>Max finger deviation: {selected.maxDeviationM.toFixed(1)} m · {selected.maxDeviationPx.toFixed(1)} px</Text>
            <Text style={[styles.summaryLine, { color: theme.foregroundSecondary }]}>Length inflation: {selected.pathLengthInflation.toFixed(2)}× · turns {selected.sharpTurns} · reversals {selected.reversals} · spikes {selected.spikes}</Text>
            <Text style={[styles.summaryLine, { color: theme.foregroundSecondary }]}>Seams: {selected.seamEntryTurnDeg.toFixed(0)}° in · {selected.seamExitTurnDeg.toFixed(0)}° out</Text>
            {zoomComparison ? (
              <Text style={[styles.summaryLine, { color: theme.foregroundSecondary }]}>Zoom stability: z{zoomComparison.wideZoom} / z{zoomComparison.neighborhoodZoom} · same final {zoomComparison.sameFinal ? 'yes' : 'no'} · {zoomComparison.wideMaxDeviationPx.toFixed(1)} / {zoomComparison.neighborhoodMaxDeviationPx.toFixed(1)} px</Text>
            ) : null}
            </> : capturedEvidence ? <>
              <Text style={[styles.summaryLine, { color: theme.foregroundSecondary }]}>Kind: {capturedEvidence.kind} · outcome {capturedEvidence.outcome}</Text>
              <Text style={[styles.summaryLine, { color: theme.foregroundSecondary }]}>Recorded divergence: {capturedEvidence.divergenceStage ?? 'none'} · reason {capturedEvidence.reason ?? 'none'}</Text>
              <Text style={[styles.summaryLine, { color: theme.foregroundSecondary }]}>Points: pre {capturedEvidence.preStateGeometry.length} · input {capturedEvidence.inputGeometry.length} · provider {capturedEvidence.providerGeometry.length} · selected {capturedEvidence.selectedGeometry.length} · final {capturedEvidence.finalGeometry.length}</Text>
            </> : <Text style={[styles.summaryLine, { color: theme.foregroundSecondary }]}>This operation has no replayable geometry.</Text>}
          </View>
          {replay ? <View style={[styles.summaryCard, { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle }]}>
            <Text style={[styles.summaryTitle, { color: theme.foreground }]}>Why</Text>
            {replay.decision.reasons.map(reason => (
              <Text key={reason} style={[styles.reason, { color: theme.foregroundSecondary }]}>• {reason}</Text>
            ))}
          </View> : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm },
  title: { fontSize: FontSize.h2, fontWeight: '800' },
  subtitle: { fontSize: FontSize.small, marginTop: 2 },
  content: { paddingHorizontal: Spacing.base, paddingBottom: 48, gap: Spacing.md },
  fixtureRow: { gap: Spacing.sm, paddingVertical: 2 },
  fixtureChip: { paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderRadius: Radius.pill },
  fixtureChipText: { fontSize: FontSize.small, fontWeight: '700' },
  canvasCard: { alignItems: 'center', backgroundColor: '#F7F5ED', borderRadius: Radius.card, overflow: 'hidden' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, paddingHorizontal: Spacing.sm, paddingBottom: Spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendSwatch: { width: 14, height: 4, borderRadius: 2 },
  legendLabel: { fontSize: 10, color: '#4B514D' },
  summaryCard: { padding: Spacing.base, borderWidth: 1, borderRadius: Radius.card },
  summaryTitle: { fontSize: FontSize.body, fontWeight: '800', marginBottom: Spacing.xs },
  summaryLine: { fontSize: FontSize.small, lineHeight: 19 },
  reason: { fontSize: FontSize.small, lineHeight: 20 },
  unavailable: { padding: Spacing.xl, fontSize: FontSize.body, lineHeight: 22 },
});

export default RouteDrawingReplayScreen;
