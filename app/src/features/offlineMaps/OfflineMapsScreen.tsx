import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackButton } from '../../components/BackButton';
import { ContentSurface } from '../../components/ContentSurface';
import { Icon } from '../../components/Icon';
import { PrimaryButton } from '../../components/PrimaryButton';
import { FontSize, RadiusRole, Spacing } from '../../components/tokens';
import { getPrimaryMapStyle } from '../../config/mapbox';
import { useVisualTheme } from '../../hooks/useVisualTheme';
import { getMapbox } from '../memory/services/mapboxAdapter';
import { useTrackingStore } from '../../store/useTrackingStore';
import {
  OFFLINE_MAP_RADIUS_OPTIONS_KM,
  formatOfflineMapBytes,
  offlineMapBoundaryFeature,
  type OfflineMapCenter,
  type OfflineMapPackRecord,
  type OfflineMapPackStatus,
} from './offlineMapContracts';
import { offlineMapService } from './offlineMapService';

const DEFAULT_CENTER: OfflineMapCenter = { lat: -41.2865, lng: 174.7762 };

function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

function packTitle(pack: OfflineMapPackRecord): string {
  if (!pack.center) return 'Saved area';
  return `${Math.abs(pack.center.lat).toFixed(2)}°${pack.center.lat < 0 ? 'S' : 'N'} · ${Math.abs(pack.center.lng).toFixed(2)}°${pack.center.lng < 0 ? 'W' : 'E'}`;
}

export function OfflineMapsScreen() {
  const theme = useVisualTheme();
  const trackingStatus = useTrackingStore(state => state.status);
  const recordingActive = trackingStatus === 'tracking' || trackingStatus === 'paused' || trackingStatus === 'requesting';
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [radiusKm, setRadiusKm] = useState<number>(5);
  const [packs, setPacks] = useState<OfflineMapPackRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<Record<string, OfflineMapPackStatus>>({});
  const subscribedPackNames = useRef(new Set<string>());
  const Mapbox = useMemo(() => getMapbox(), []);
  const boundary = useMemo(() => offlineMapBoundaryFeature({ center, radiusKm }), [center, radiusKm]);

  const refreshList = useCallback(async () => {
    try {
      setPacks(await offlineMapService.list());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Saved maps could not be read.');
    }
  }, []);

  useEffect(() => {
    void refreshList();
    const timer = setInterval(() => void refreshList(), 3_000);
    return () => {
      clearInterval(timer);
      for (const name of subscribedPackNames.current) offlineMapService.release(name);
      subscribedPackNames.current.clear();
    };
  }, [refreshList]);

  const useLastLocation = useCallback(async () => {
    setError('');
    try {
      const last = await Location.getLastKnownPositionAsync({ maxAge: 60 * 60 * 1_000 });
      if (!last) {
        setError('No recent device location is available. Pan the map to choose an area.');
        return;
      }
      setCenter({ lat: last.coords.latitude, lng: last.coords.longitude });
    } catch {
      setError('Cairn could not read the device’s last known location. Pan the map instead.');
    }
  }, []);

  const createPack = useCallback(async () => {
    if (recordingActive) {
      setError('Finish or discard the current Activity before changing offline maps. Recording remains the priority.');
      return;
    }
    setError('');
    setBusy('create');
    let createdName: string | null = null;
    try {
      createdName = await offlineMapService.create({ center, radiusKm }, status => {
        setProgress(current => ({ ...current, [status.name]: status }));
      }, message => setError(message));
      subscribedPackNames.current.add(createdName);
      await refreshList();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The offline map could not be started.');
    } finally {
      setBusy(null);
    }
  }, [center, radiusKm, recordingActive, refreshList]);

  const mutatePack = useCallback(async (pack: OfflineMapPackRecord, action: 'pause' | 'resume' | 'refresh' | 'remove') => {
    if (recordingActive) {
      setError('Finish or discard the current Activity before changing offline maps. Recording remains the priority.');
      return;
    }
    const execute = async () => {
      setBusy(`${action}:${pack.name}`);
      setError('');
      try {
        if (action === 'pause') await offlineMapService.pause(pack.name);
        if (action === 'resume') await offlineMapService.resume(pack.name);
        if (action === 'refresh') await offlineMapService.refresh(pack.name);
        if (action === 'remove') await offlineMapService.remove(pack.name);
        await refreshList();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The offline map could not be changed.');
      } finally {
        setBusy(null);
      }
    };
    if (action === 'remove') {
      Alert.alert('Remove offline map?', 'The downloaded map tiles for this area will be removed from this device.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void execute() },
      ]);
      return;
    }
    await execute();
  }, [recordingActive, refreshList]);

  const { MapView, Camera, ShapeSource, FillLayer } = Mapbox;
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top', 'bottom']} testID="offline-maps-screen">
      <View style={styles.header}>
        <BackButton variant="inline" label="Back" />
        <Text style={[styles.title, { color: theme.foreground }]}>Offline maps</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <ContentSurface level="elevated" style={styles.introCard}>
          <View style={[styles.iconBubble, { backgroundColor: theme.controlSelected }]}>
            <Icon name="Download" size={22} color={theme.icon} />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Device map pilot</Text>
            <Text style={[styles.body, { color: theme.textSecondary }]}>Map tiles can be downloaded for a chosen area. Activities already record and save locally without this download.</Text>
          </View>
        </ContentSurface>

        <View style={[styles.mapWrap, { borderColor: theme.borderSubtle, backgroundColor: theme.surface }]}> 
          {Mapbox.available && MapView ? (
            <MapView
              style={StyleSheet.absoluteFill}
              styleURL={getPrimaryMapStyle()}
              logoEnabled
              attributionEnabled
              logoPosition={{ bottom: 8, left: 8 }}
              attributionPosition={{ bottom: 8, right: 8 }}
              compassEnabled={false}
              scaleBarEnabled={false}
              onMapIdle={(event: any) => {
                const next = event?.properties?.center ?? event?.geometry?.coordinates;
                if (Array.isArray(next) && Number.isFinite(next[0]) && Number.isFinite(next[1])) {
                  setCenter({ lng: next[0], lat: next[1] });
                }
              }}
            >
              <Camera centerCoordinate={[center.lng, center.lat]} zoomLevel={11} animationDuration={250} />
              <ShapeSource id="offline-map-boundary" shape={boundary}>
                <FillLayer id="offline-map-boundary-fill" style={{ fillColor: theme.primary, fillOpacity: 0.16, fillOutlineColor: theme.primary }} />
              </ShapeSource>
            </MapView>
          ) : (
            <View style={styles.mapFallback}>
              <Icon name="Map" size={28} color={theme.iconInactive} />
              <Text style={[styles.body, { color: theme.textSecondary, textAlign: 'center' }]}>Map selection is available in the native app.</Text>
            </View>
          )}
          <View pointerEvents="none" style={[styles.crosshair, { borderColor: theme.primary }]} />
        </View>

        <Text style={[styles.sectionTitle, { color: theme.foreground }]}>Choose coverage</Text>
        <View style={styles.radiusRow}>
          {OFFLINE_MAP_RADIUS_OPTIONS_KM.map(option => (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: radiusKm === option }}
              onPress={() => setRadiusKm(option)}
              style={({ pressed }) => [
                styles.radiusButton,
                { borderColor: radiusKm === option ? theme.borderStrong : theme.borderSubtle, backgroundColor: radiusKm === option ? theme.controlSelected : theme.recordSurface },
                pressed && { backgroundColor: theme.recordPressed },
              ]}
            >
              <Text style={[styles.radiusText, { color: theme.textPrimary }]}>{option} km radius</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.hint, { color: theme.foregroundSecondary }]}>Pan the map so the crosshair marks the centre. Zoom 10–15 is included. Actual storage depends on Mapbox resources and is reported after the download starts.</Text>
        <View style={styles.actionRow}>
          <PrimaryButton label="Use last location" variant="secondary" onPress={() => void useLastLocation()} style={styles.flex} />
          <PrimaryButton label="Download area" onPress={() => void createPack()} loading={busy === 'create'} disabled={!offlineMapService.supported || recordingActive} style={styles.flex} />
        </View>
        {!offlineMapService.supported && Platform.OS === 'web' ? <Text style={[styles.notice, { color: theme.foregroundSecondary }]}>Downloads require the native app; this web view is a layout preview.</Text> : null}
        {recordingActive ? <Text style={[styles.notice, { color: theme.destructive }]}>Offline-map changes are paused while an Activity is active.</Text> : null}
        {error ? <Text style={[styles.error, { color: theme.destructive }]} accessibilityRole="alert">{error}</Text> : null}

        <Text style={[styles.sectionTitle, { color: theme.foreground }]}>On this device</Text>
        {packs.length === 0 ? (
          <ContentSurface style={styles.emptyCard}>
            <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>No downloaded areas</Text>
            <Text style={[styles.body, { color: theme.textSecondary }]}>Downloads are stored on this device and are not part of Activity sync.</Text>
          </ContentSurface>
        ) : packs.map(pack => {
          const live = progress[pack.name];
          const shown = live ? { ...pack, ...live } : pack;
          const itemBusy = busy?.endsWith(pack.name) ?? false;
          return (
            <ContentSurface key={pack.name} style={styles.packCard} testID={`offline-map-pack-${pack.name}`}>
              <View style={styles.packHeader}>
                <View style={styles.flex}>
                  <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{packTitle(pack)}</Text>
                  <Text style={[styles.body, { color: theme.textSecondary }]}>{pack.radiusKm ? `${pack.radiusKm} km radius · ` : ''}{percent(shown.percentage)} · {formatOfflineMapBytes(shown.completedResourceSize)}</Text>
                </View>
                <Text style={[styles.percent, { color: theme.primary }]}>{percent(shown.percentage)}</Text>
              </View>
              <View style={[styles.progressTrack, { backgroundColor: theme.disabledSurface }]}>
                <View style={[styles.progressFill, { width: `${shown.percentage}%`, backgroundColor: theme.primary }]} />
              </View>
              <View style={styles.packActions}>
                <Pressable disabled={itemBusy || recordingActive} onPress={() => void mutatePack(pack, 'pause')} style={styles.smallAction}><Icon name="Pause" size={16} color={theme.icon} /><Text style={[styles.smallActionText, { color: theme.textPrimary }]}>Pause</Text></Pressable>
                <Pressable disabled={itemBusy || recordingActive} onPress={() => void mutatePack(pack, 'resume')} style={styles.smallAction}><Icon name="Play" size={16} color={theme.icon} /><Text style={[styles.smallActionText, { color: theme.textPrimary }]}>Resume</Text></Pressable>
                <Pressable disabled={itemBusy || recordingActive} onPress={() => void mutatePack(pack, 'refresh')} style={styles.smallAction}><Icon name="RotateCcw" size={16} color={theme.icon} /><Text style={[styles.smallActionText, { color: theme.textPrimary }]}>Update</Text></Pressable>
                <Pressable disabled={itemBusy || recordingActive} onPress={() => void mutatePack(pack, 'remove')} style={styles.smallAction}><Icon name="Trash2" size={16} color={theme.destructive} /><Text style={[styles.smallActionText, { color: theme.destructive }]}>Remove</Text></Pressable>
              </View>
            </ContentSurface>
          );
        })}

        <ContentSurface style={styles.limitCard}>
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>What works offline</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>Downloaded Mapbox basemap resources can render without network access. GPS recording, local Finish/Save and personal Cairn evidence are already local-first.</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>Road refinement, sharing, public Cairns and server sync still wait for connectivity. A map download does not change canonical Activity geometry.</Text>
        </ContentSurface>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg },
  title: { flex: 1, textAlign: 'center', fontSize: FontSize.h2, fontWeight: '700' },
  headerSpacer: { width: 54 },
  scroll: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl, gap: Spacing.md },
  introCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  iconBubble: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  cardTitle: { fontSize: FontSize.body, fontWeight: '700', lineHeight: 21 },
  body: { fontSize: FontSize.caption, lineHeight: 19, marginTop: 3 },
  mapWrap: { height: 260, overflow: 'hidden', borderRadius: RadiusRole.card, borderWidth: 1 },
  mapFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.xl },
  crosshair: { position: 'absolute', width: 18, height: 18, borderWidth: 2, borderRadius: 9, left: '50%', top: '50%', marginLeft: -9, marginTop: -9 },
  sectionTitle: { fontSize: FontSize.small, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase', marginTop: Spacing.sm },
  radiusRow: { flexDirection: 'row', gap: Spacing.sm },
  radiusButton: { flex: 1, borderWidth: 1, borderRadius: RadiusRole.button, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xs },
  radiusText: { fontSize: FontSize.small, fontWeight: '700' },
  hint: { fontSize: FontSize.caption, lineHeight: 19 },
  actionRow: { flexDirection: 'row', gap: Spacing.md },
  notice: { fontSize: FontSize.caption, lineHeight: 18, fontWeight: '600', textAlign: 'center' },
  error: { fontSize: FontSize.caption, lineHeight: 18, fontWeight: '700' },
  emptyCard: { padding: Spacing.lg },
  packCard: { gap: Spacing.md },
  packHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  percent: { fontSize: FontSize.body, fontWeight: '800' },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  packActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  smallAction: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: Spacing.sm },
  smallActionText: { fontSize: FontSize.small, fontWeight: '700' },
  limitCard: { marginTop: Spacing.md, padding: Spacing.lg },
});
