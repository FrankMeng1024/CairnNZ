import React from 'react';
import type { VisualThemeTokens } from '../tokens';
import type { CanonicalRouteGeometry } from '../../features/route/canonicalRouteGeometry';
import { buildRouteDisplayGeometry } from '../../features/route/routeDisplayGeometry';

interface Props {
  geometry: CanonicalRouteGeometry;
  theme: VisualThemeTokens;
  ShapeSource: any;
  LineLayer: any;
  SymbolLayer?: any;
  idPrefix: string;
  hiddenPartId?: string;
}

/** One Mapbox line contract for draft, saved, reopened and received Routes. */
export const CanonicalRouteLayer = React.memo(function CanonicalRouteLayer({
  geometry,
  theme,
  ShapeSource,
  LineLayer,
  SymbolLayer,
  idPrefix,
  hiddenPartId,
}: Props) {
  if (!ShapeSource || !LineLayer) return null;
  const visibleGeometry = hiddenPartId
    ? { ...geometry, parts: geometry.parts.filter(part => part.id !== hiddenPartId) }
    : geometry;
  const display = buildRouteDisplayGeometry(visibleGeometry);
  const features = display.ordinaryLines.map(line => ({
      type: 'Feature' as const,
      id: line.id,
      properties: { occurrenceIds: line.occurrenceIds.join(',') },
      geometry: {
        type: 'LineString' as const,
        coordinates: line.coordinates.map(point => [point.lng, point.lat]),
      },
    }));
  const repeatLaneFeatures = display.repeatLanes.map(lane => ({
    type: 'Feature' as const,
    id: lane.id,
    properties: {
      occurrenceIds: lane.occurrenceIds.join(','),
      multiplicity: lane.multiplicity,
      offsetPx: lane.offsetPx,
    },
    geometry: {
      type: 'LineString' as const,
      coordinates: lane.coordinates.map(point => [point.lng, point.lat]),
    },
  }));
  const repeatLabelFeatures = display.repeatLabels.map(label => ({
    type: 'Feature' as const,
    id: label.id,
    properties: { text: label.text, direction: label.direction, occurrenceIds: label.occurrenceIds.join(',') },
    geometry: { type: 'Point' as const, coordinates: [label.coordinate.lng, label.coordinate.lat] },
  }));
  const gapFeatures = geometry.gaps.map(gap => ({
    type: 'Feature' as const,
    id: gap.id,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: [[gap.from.lng, gap.from.lat], [gap.to.lng, gap.to.lat]],
    },
  }));

  return (
    <>
      {features.length > 0 ? (
        <ShapeSource
          id={`${idPrefix}-parts`}
          shape={{ type: 'FeatureCollection', features }}
        >
          <LineLayer
            id={`${idPrefix}-casing`}
            slot="top"
            style={{
              lineColor: theme.mapRouteCasing,
              lineWidth: 9,
              lineOpacity: 0.78,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
          <LineLayer
            id={`${idPrefix}-line`}
            slot="top"
            style={{
              lineColor: theme.mapRouteLine,
              lineWidth: 6,
              lineOpacity: 0.96,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>
      ) : null}
      {repeatLaneFeatures.length > 0 ? (
        <ShapeSource
          id={`${idPrefix}-repeat-lanes`}
          shape={{ type: 'FeatureCollection', features: repeatLaneFeatures }}
        >
          <LineLayer
            id={`${idPrefix}-repeat-lane-casing`}
            slot="top"
            style={{
              lineColor: theme.mapRouteCasing,
              lineWidth: 9,
              lineOffset: ['get', 'offsetPx'],
              lineOpacity: 0.84,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
          <LineLayer
            id={`${idPrefix}-repeat-lane-line`}
            slot="top"
            style={{
              lineColor: theme.mapRouteLine,
              lineWidth: 5.5,
              lineOffset: ['get', 'offsetPx'],
              lineOpacity: 0.98,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>
      ) : null}
      {SymbolLayer && repeatLabelFeatures.length > 0 ? (
        <ShapeSource
          id={`${idPrefix}-repeat-labels`}
          shape={{ type: 'FeatureCollection', features: repeatLabelFeatures }}
        >
          <SymbolLayer
            id={`${idPrefix}-repeat-label-text`}
            slot="top"
            minZoomLevel={16}
            style={{
              textField: ['get', 'text'],
              textSize: 9.5,
              textOffset: [0, 1],
              textColor: theme.foreground,
              textHaloColor: theme.surfaceElevated,
              textHaloWidth: 1.5,
              textAllowOverlap: true,
              textIgnorePlacement: true,
            }}
          />
        </ShapeSource>
      ) : null}
      {gapFeatures.length > 0 ? (
        <ShapeSource
          id={`${idPrefix}-gaps`}
          shape={{ type: 'FeatureCollection', features: gapFeatures }}
        >
          <LineLayer
            id={`${idPrefix}-gap-line`}
            slot="top"
            style={{
              lineColor: theme.mapRouteGap,
              lineWidth: 3,
              lineOpacity: 0.9,
              lineDasharray: [2, 2],
            }}
          />
        </ShapeSource>
      ) : null}
    </>
  );
});
