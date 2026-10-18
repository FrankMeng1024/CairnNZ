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
  const features = display.baseLines.map(line => ({
      type: 'Feature' as const,
      id: line.id,
      properties: { occurrenceIds: line.occurrenceIds.join(',') },
      geometry: {
        type: 'LineString' as const,
        coordinates: line.coordinates.map(point => [point.lng, point.lat]),
      },
    }));
  const repeatFeatures = display.repeatLanes.map(lane => ({
    type: 'Feature' as const,
    id: lane.id,
    properties: {
      offsetPx: lane.offsetPx,
      direction: lane.direction,
      multiplicity: lane.multiplicity,
      occurrenceIds: lane.occurrenceIds.join(','),
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
      {repeatFeatures.length > 0 ? (
        <ShapeSource
          id={`${idPrefix}-repeated-traversals`}
          shape={{ type: 'FeatureCollection', features: repeatFeatures }}
        >
          {([3] as const).flatMap(offset => [
            <LineLayer
              key={`repeat-casing-${offset}`}
              id={`${idPrefix}-repeat-casing-${offset}`}
              slot="top"
              filter={['==', ['get', 'offsetPx'], offset]}
              style={{
                lineColor: theme.mapRouteCasing,
                lineWidth: 8,
                lineOffset: offset,
                lineOpacity: 0.82,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />,
            <LineLayer
              key={`repeat-line-${offset}`}
              id={`${idPrefix}-repeat-line-${offset}`}
              slot="top"
              filter={['==', ['get', 'offsetPx'], offset]}
              style={{
                lineColor: theme.mapRouteLine,
                lineWidth: 4.5,
                lineOffset: offset,
                lineOpacity: 0.98,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />,
          ])}
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
            minZoomLevel={11}
            style={{
              textField: ['get', 'text'],
              textSize: 10,
              textOffset: [0, 1.15],
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
