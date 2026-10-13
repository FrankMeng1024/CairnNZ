import React from 'react';
import type { VisualThemeTokens } from '../tokens';
import type { CanonicalRouteGeometry } from '../../features/route/canonicalRouteGeometry';

interface Props {
  geometry: CanonicalRouteGeometry;
  theme: VisualThemeTokens;
  ShapeSource: any;
  LineLayer: any;
  idPrefix: string;
  hiddenPartId?: string;
}

/** One Mapbox line contract for draft, saved, reopened and received Routes. */
export function CanonicalRouteLayer({
  geometry,
  theme,
  ShapeSource,
  LineLayer,
  idPrefix,
  hiddenPartId,
}: Props) {
  if (!ShapeSource || !LineLayer) return null;
  const features = geometry.parts
    .filter(part => part.id !== hiddenPartId)
    .map(part => ({
      type: 'Feature' as const,
      id: part.id,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: part.points.map(point => [point.lng, point.lat]),
      },
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
}
