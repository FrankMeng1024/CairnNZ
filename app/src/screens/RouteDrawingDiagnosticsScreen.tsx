import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { BackButton } from '../components/BackButton';
import { FontSize, RadiusRole, Spacing } from '../components/tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  clearRouteDrawingTraces,
  exportRouteDrawingTrace,
  isRouteDrawingDiagnosticsEnabled,
  listRouteDrawingTraces,
  setRouteDrawingDiagnosticsEnabled,
  type RouteDrawingTrace,
} from '../features/routeDrawing/routeDrawingTrace';

/**
 * Narrow Owner-test surface available in the installed production runtime.
 * It exposes only bounded local Route evidence — never simulator, backend,
 * credential or telemetry-upload controls from the internal Debug screen.
 */
export function RouteDrawingDiagnosticsScreen() {
  const nav = useNavigation<any>();
  const theme = useVisualTheme();
  const debugMode = useSettingsStore(state => state.debugMode);
  const [armed, setArmed] = useState(isRouteDrawingDiagnosticsEnabled());
  const [traces, setTraces] = useState<RouteDrawingTrace[]>(listRouteDrawingTraces());
  const [exporting, setExporting] = useState(false);

  const refresh = useCallback(() => setTraces(listRouteDrawingTraces()), []);
  useFocusEffect(useCallback(() => {
    refresh();
    return undefined;
  }, [refresh]));

  const setCapture = useCallback((next: boolean) => {
    setRouteDrawingDiagnosticsEnabled(next);
    setArmed(next);
    refresh();
  }, [refresh]);

  const exportLatest = useCallback(async () => {
    const latest = listRouteDrawingTraces()[0];
    if (!latest) {
      Alert.alert('No Route trace yet', 'Arm capture, reproduce the Route issue, then return here.');
      return;
    }
    const body = exportRouteDrawingTrace(latest.sessionId);
    if (!body || !FileSystem.documentDirectory) {
      Alert.alert('Export unavailable', 'Cairn could not create the local trace file.');
      return;
    }
    setExporting(true);
    try {
      const directory = `${FileSystem.documentDirectory}cairn-route-drawing-traces/`;
      if (!(await FileSystem.getInfoAsync(directory)).exists) {
        await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      }
      const safeId = latest.sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const path = `${directory}${safeId}.json`;
      await FileSystem.writeAsStringAsync(path, body, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, {
          mimeType: 'application/json',
          dialogTitle: `Cairn Route trace ${latest.sessionId}`,
        });
      } else {
        Alert.alert('Trace saved locally', path);
      }
    } catch (error) {
      Alert.alert('Export failed', String(error));
    } finally {
      setExporting(false);
      refresh();
    }
  }, [refresh]);

  if (!debugMode) {
    return (
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <SafeAreaView><BackButton onPress={() => nav.goBack()} /></SafeAreaView>
      </View>
    );
  }

  const latest = traces[0];
  return (
    <View style={[styles.root, { backgroundColor: theme.background }]} testID="route-owner-diagnostics">
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <BackButton onPress={() => nav.goBack()} />
          <Text style={[styles.title, { color: theme.foreground }]}>Route diagnostics</Text>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle }]}>
            <View style={styles.switchRow}>
              <View style={styles.copy}>
                <Text style={[styles.cardTitle, { color: theme.foreground }]}>Capture next Route session</Text>
                <Text style={[styles.body, { color: theme.foregroundSecondary }]}>Arm, return to Trails, reproduce Draw or Point, then come back here.</Text>
              </View>
              <Switch testID="route-owner-trace-toggle" value={armed} onValueChange={setCapture} />
            </View>
            <Text style={[styles.meta, { color: theme.foregroundSecondary }]}>Local traces: {traces.length} / 8 · precise locations are never uploaded automatically.</Text>
          </View>

          <View style={[styles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle }]}>
            <Text style={[styles.cardTitle, { color: theme.foreground }]}>{latest ? 'Latest captured session' : 'No captured session'}</Text>
            {latest ? (
              <Text style={[styles.meta, { color: theme.foregroundSecondary }]}>{latest.sessionId}\n{latest.events.length} events · {latest.droppedEvents} dropped · {latest.captureError ?? 'complete original geometry'}</Text>
            ) : (
              <Text style={[styles.body, { color: theme.foregroundSecondary }]}>Representative synthetic fixtures remain available in Replay.</Text>
            )}
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.action, { backgroundColor: theme.primaryAction }]}
                onPress={() => nav.navigate('RouteDrawingReplay', latest ? { sessionId: latest.sessionId } : { fixtureId: 'flattenV' })}
                accessibilityRole="button"
              ><Text style={[styles.actionText, { color: theme.onPrimary }]}>Replay</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.action, { borderColor: theme.border, borderWidth: 1 }]} onPress={() => { void exportLatest(); }} disabled={exporting} accessibilityRole="button">
                <Text style={[styles.actionText, { color: theme.foreground }]}>{exporting ? 'Exporting…' : 'Export'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.action, { borderColor: theme.border, borderWidth: 1 }]} onPress={() => { clearRouteDrawingTraces(); setCapture(false); }} accessibilityRole="button">
                <Text style={[styles.actionText, { color: theme.foreground }]}>Clear</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base },
  title: { fontSize: FontSize.h2, fontWeight: '800' },
  content: { padding: Spacing.base, gap: Spacing.md },
  card: { borderWidth: 1, borderRadius: RadiusRole.card, padding: Spacing.base, gap: Spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  copy: { flex: 1 },
  cardTitle: { fontSize: FontSize.body, fontWeight: '800' },
  body: { marginTop: 4, fontSize: FontSize.small, lineHeight: 19 },
  meta: { fontSize: FontSize.small, lineHeight: 19 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.xs },
  action: { minHeight: 44, minWidth: 84, paddingHorizontal: Spacing.md, borderRadius: RadiusRole.button, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: FontSize.small, fontWeight: '800' },
});

export default RouteDrawingDiagnosticsScreen;
