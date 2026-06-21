/**
 * MarkerDetailScreen — v299
 *
 * Read-only detail page for a single cairn / marker. Used by two
 * entry points (per user spec, "Flags detail and plant complete
 * flag 最后成功展示的页面是一样的"):
 *
 *   1. Plant flow success: PlantScreen.commit replaces the route
 *      with this screen instead of dismissing back to home.
 *   2. RoutesScreen Flags tab: tapping a flag row navigates here
 *      (replacing the previous editable FlagEditSheet).
 *
 * Layout matches the project's other detail screens (MapHistoryScreen
 * for activity, RouteEditorScreen for route): top map + scrollable
 * detail panel + top-left BackButton.
 *
 * Read-only by design — user confirmed in plant flow that once
 * planted, a cairn cannot be edited. Editing previously lived in
 * FlagEditSheet and has been removed.
 */
import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Dimensions, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useMarkerStore } from '../store/useMarkerStore';
import { MARKER_TYPES } from '../config/markerTypes';
import { splitTitleBody } from '../features/plant/services/noteEncoding';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../components/tokens';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import { BackButton } from '../components/BackButton';
import { MemoryColors } from '../features/memory/config/memoryConfig';
import { getPrimaryMapStyle } from '../config/mapbox';
import { formatDate } from '../utils/geo';

// Native Mapbox import (web falls back to no-map panel — same pattern
// as MapHistoryScreen).
let MapView: any = null;
let CameraComponent: any = null;
let PointAnnotation: any = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Mapbox = require('@rnmapbox/maps');
    MapView = Mapbox.MapView;
    CameraComponent = Mapbox.Camera;
    PointAnnotation = Mapbox.PointAnnotation;
  } catch {
    // not available — fall back to web stub below
  }
} else {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const adapter = require('../features/memory/services/mapboxAdapter.web');
    const m = adapter.makeWebMapboxAdapter();
    if (m && m.available) {
      MapView = m.MapView;
      CameraComponent = m.Camera;
      PointAnnotation = m.PointAnnotation;
    }
  } catch {
    // web adapter unavailable — show no-map fallback panel
  }
}

const { height: H } = Dimensions.get('window');
const MAP_H = Math.max(300, H - 420);

type DetailRoute = RouteProp<RootStackParamList, 'MarkerDetail'>;

const VISIBILITY_LABEL: Record<string, { label: string; iconName: IconName }> = {
  personal: { label: 'Just me',  iconName: 'Lock' },
  group:    { label: 'Friends',  iconName: 'Users' },
  public:   { label: 'Anyone',   iconName: 'Globe' },
};

export function MarkerDetailScreen() {
  const route = useRoute<DetailRoute>();
  const markerId = route.params?.markerId;
  const markers = useMarkerStore((s) => s.markers);
  const marker = useMemo(
    () => markers.find((m) => m.id === markerId),
    [markers, markerId]
  );

  if (!marker) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.backRow}>
          <BackButton variant="pill" />
        </View>
        <View style={styles.notFoundBox}>
          <Text style={styles.notFoundTitle}>Cairn not found</Text>
          <Text style={styles.notFoundSub}>
            This cairn may have been removed or hasn't synced yet.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const meta = MARKER_TYPES[marker.type];
  const { title, body } = splitTitleBody(marker.note);
  const vis = VISIBILITY_LABEL[marker.permission] ?? VISIBILITY_LABEL.personal;
  const dateStr = formatDate(marker.createdAt);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* Top map area */}
      <View style={[styles.mapWrap, { height: MAP_H }]}>
        {MapView ? (
          <MapView
            style={styles.map}
            styleURL={getPrimaryMapStyle()}
            compassEnabled={false}
            scaleBarEnabled={false}
            attributionEnabled={false}
            logoEnabled={false}
          >
            <CameraComponent
              defaultSettings={{
                centerCoordinate: [marker.lng, marker.lat],
                zoomLevel: 17,
              }}
            />
            {PointAnnotation && (
              <PointAnnotation id="marker-pin" coordinate={[marker.lng, marker.lat]}>
                <View style={[styles.pinHead, { backgroundColor: meta.color }]} />
              </PointAnnotation>
            )}
          </MapView>
        ) : (
          <View style={styles.mapFallback}>
            <Text style={styles.mapFallbackText}>
              {marker.lat.toFixed(5)}, {marker.lng.toFixed(5)}
            </Text>
          </View>
        )}
        <View style={styles.backRow} pointerEvents="box-none">
          <BackButton variant="pill" />
        </View>
      </View>

      {/* Detail panel */}
      <ScrollView
        style={styles.panel}
        contentContainerStyle={styles.panelContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Type badge */}
        <View style={[styles.typeBadge, { backgroundColor: meta.bg, borderColor: meta.color }]}>
          <Icon name={meta.icon as IconName} size={14} color={meta.color} strokeWidth={2} />
          <Text style={[styles.typeBadgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>

        {/* Title */}
        {title ? (
          <Text style={styles.title}>{title}</Text>
        ) : (
          <Text style={styles.titleEmpty}>Untitled cairn</Text>
        )}

        {/* Body */}
        {body ? <Text style={styles.body}>{body}</Text> : null}

        {/* Meta row */}
        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Icon name="Calendar" size={13} color={MemoryColors.cairnPublic} strokeWidth={2} />
            <Text style={styles.metaText}>{dateStr}</Text>
          </View>
          <View style={styles.metaItem}>
            <Icon name={vis.iconName} size={13} color={MemoryColors.cairnPublic} strokeWidth={2} />
            <Text style={styles.metaText}>{vis.label}</Text>
          </View>
          <View style={styles.metaItem}>
            <Icon name="MapPin" size={13} color={MemoryColors.cairnPublic} strokeWidth={2} />
            <Text style={styles.metaText}>
              {marker.lat.toFixed(5)}, {marker.lng.toFixed(5)}
            </Text>
          </View>
        </View>

        {/* Read-only notice */}
        <View style={styles.lockNotice}>
          <Icon name="Lock" size={12} color={MemoryColors.cairnPublic} strokeWidth={2} />
          <Text style={styles.lockNoticeText}>
            Once planted, a cairn cannot be edited.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MemoryColors.cream },
  mapWrap: {
    width: '100%',
    backgroundColor: '#dde4d2',
    overflow: 'hidden',
  },
  map: { flex: 1 },
  mapFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapFallbackText: {
    fontFamily: 'Courier',
    fontSize: 13,
    color: MemoryColors.sepiaDeep,
  },
  backRow: {
    position: 'absolute',
    top: Spacing.md, left: Spacing.md,
    zIndex: 10,
  },
  pinHead: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 3, borderColor: '#fff',
    ...Shadow.card,
  },
  panel: {
    flex: 1,
  },
  panelContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 14,
  },
  typeBadgeText: { fontSize: FontSize.small, fontWeight: '600' },
  title: {
    fontSize: 22,
    fontWeight: '500',
    color: MemoryColors.sepiaDeep,
    marginBottom: 12,
  },
  titleEmpty: {
    fontSize: 22,
    fontWeight: '500',
    color: MemoryColors.cairnPublic,
    fontStyle: 'italic',
    marginBottom: 12,
  },
  body: {
    fontSize: 14,
    color: MemoryColors.sepiaDeep,
    lineHeight: 20,
    marginBottom: 18,
  },
  metaRow: {
    flexDirection: 'column',
    gap: 8,
    marginBottom: 18,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaText: {
    fontSize: FontSize.caption,
    color: MemoryColors.cairnPublic,
  },
  lockNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#e8dfc8',
  },
  lockNoticeText: {
    fontSize: 11,
    color: MemoryColors.cairnPublic,
    fontStyle: 'italic',
  },
  notFoundBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  notFoundTitle: {
    fontSize: 18,
    fontWeight: '500',
    color: MemoryColors.sepiaDeep,
    marginBottom: 8,
  },
  notFoundSub: {
    fontSize: 13,
    color: MemoryColors.cairnPublic,
    textAlign: 'center',
  },
});
