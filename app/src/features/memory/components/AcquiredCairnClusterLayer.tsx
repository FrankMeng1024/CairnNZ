import React, { useMemo, useRef } from 'react';
import { useCairnPresentationStore } from '../../cairns/cairnPresentationStore';
import { getMapbox } from '../services/mapboxAdapter';
import { buildAcquiredCairnFeatureCollection, loadAllClusterLeaves } from './acquiredCairnClusters';
import { useVisualTheme } from '../../../hooks/useVisualTheme';

/**
 * One map point per acquired Cairn. Mapbox performs screen-space clustering,
 * so nearby acquisitions separate naturally with zoom while exact-coordinate
 * groups remain selectable through their grouped list.
 */
export function AcquiredCairnClusterLayer({
  onOpenSingle,
  onOpenGroup,
}: {
  onOpenSingle: (markerId: string) => void;
  onOpenGroup: (markerIds: string[]) => void;
}) {
  const theme = useVisualTheme();
  const markers = useCairnPresentationStore(state => state.acquiredMarkers);
  const sourceRef = useRef<any>(null);
  const featureCollection = useMemo(() => buildAcquiredCairnFeatureCollection(markers), [markers]);
  const Mapbox = getMapbox() as any;
  if (!Mapbox.available || markers.length === 0) return null;
  const { ShapeSource, SymbolLayer, CircleLayer, Images } = Mapbox;
  if (!ShapeSource || !SymbolLayer || !CircleLayer) return null;

  const openFeatures = async (features: any[]) => {
    const markerIds = features
      .map(feature => String(feature?.properties?.markerId ?? ''))
      .filter(Boolean);
    if (markerIds.length === 1) onOpenSingle(markerIds[0]);
    else if (markerIds.length > 1) onOpenGroup(markerIds);
  };

  const onPress = async (event: any) => {
    const feature = event?.features?.[0];
    if (!feature) return;
    const clusterCount = Number(feature?.properties?.point_count ?? 0);
    if (!clusterCount) {
      await openFeatures([feature]);
      return;
    }
    try {
      const leaves = await loadAllClusterLeaves(sourceRef.current, feature, clusterCount);
      await openFeatures(leaves);
    } catch {
      onOpenGroup([]);
    }
  };

  return (
    <>
      {Images ? <Images images={{ 'acquired-cairn': require('../../../../assets/ui-redesign/action-cairn.png') }} /> : null}
      <ShapeSource
        ref={sourceRef}
        id="acquired-cairn-clusters"
        shape={featureCollection}
        cluster
        clusterRadius={38}
        clusterMaxZoomLevel={24}
        clusterProperties={{
          unread_total: ['+', ['get', 'unread']],
          friends_total: ['+', ['get', 'friends']],
          public_total: ['+', ['get', 'public']],
        }}
        onPress={onPress}
      >
        <CircleLayer
          id="acquired-cairn-cluster-circles"
          filter={['has', 'point_count']}
          style={{
            circleColor: [
              'case',
              ['==', ['get', 'friends_total'], ['get', 'point_count']], theme.primary,
              ['==', ['get', 'public_total'], ['get', 'point_count']], '#B77743',
              theme.accent,
            ],
            circleRadius: ['step', ['get', 'point_count'], 18, 10, 22, 50, 27],
            circleStrokeColor: theme.surfaceElevated,
            circleStrokeWidth: 2,
          }}
        />
        <SymbolLayer
          id="acquired-cairn-cluster-count"
          filter={['has', 'point_count']}
          style={{
            textField: ['get', 'point_count_abbreviated'],
            textColor: theme.onPrimary,
            textSize: 12,
            textAllowOverlap: true,
          }}
        />
        <CircleLayer
          id="acquired-cairn-cluster-unread"
          filter={['all', ['has', 'point_count'], ['>', ['get', 'unread_total'], 0]]}
          style={{
            circleRadius: 4,
            circleColor: theme.primary,
            circleStrokeColor: theme.surfaceElevated,
            circleStrokeWidth: 1.5,
            circleTranslate: [14, -14],
          }}
        />
        <CircleLayer
          id="acquired-cairn-single-audience"
          filter={['!', ['has', 'point_count']]}
          style={{
            circleRadius: 15,
            circleColor: ['case', ['==', ['get', 'public'], 1], '#B77743', theme.primary],
            circleStrokeColor: theme.surfaceElevated,
            circleStrokeWidth: 2,
          }}
        />
        <SymbolLayer
          id="acquired-cairn-single"
          filter={['!', ['has', 'point_count']]}
          style={{
            iconImage: 'acquired-cairn',
            iconSize: ['interpolate', ['linear'], ['zoom'], 10, 0.08, 14, 0.12, 18, 0.16],
            iconAllowOverlap: true,
            iconIgnorePlacement: true,
          }}
        />
        <CircleLayer
          id="acquired-cairn-single-unread"
          filter={['all', ['!', ['has', 'point_count']], ['==', ['get', 'unread'], 1]]}
          style={{
            circleRadius: 4,
            circleColor: theme.primary,
            circleStrokeColor: theme.surfaceElevated,
            circleStrokeWidth: 1.5,
            circleTranslate: [9, -10],
          }}
        />
      </ShapeSource>
    </>
  );
}
