import React from 'react';
import type { VisualThemeTokens } from '../tokens';
import type { CanonicalRouteGeometry } from '../../features/route/canonicalRouteGeometry';
import { buildReliableRouteDisplayGeometry } from '../../features/route/routeDisplayGeometry';

interface Props {
  geometry: CanonicalRouteGeometry;
  theme: VisualThemeTokens;
  ShapeSource: any;
  LineLayer: any;
  CircleLayer?: any;
  SymbolLayer?: any;
  idPrefix: string;
  hiddenPartId?: string;
  aboveLayerID?: string;
}

/** One Mapbox line contract for draft, saved, reopened and received Routes. */
export const CanonicalRouteLayer = React.memo(function CanonicalRouteLayer({
  geometry,
  theme,
  ShapeSource,
  LineLayer,
  CircleLayer,
  SymbolLayer,
  idPrefix,
  hiddenPartId,
  aboveLayerID,
}: Props) {
  if (!ShapeSource || !LineLayer) return null;
  const visibleGeometry = hiddenPartId
    ? { ...geometry, parts: geometry.parts.filter(part => part.id !== hiddenPartId) }
    : geometry;
  const display = buildReliableRouteDisplayGeometry(visibleGeometry);
  // Always paint the untouched canonical line. Repeat lanes are optional
  // decoration above it, never the only representation of route truth.
  // This guarantees a continuous, visible fallback if display classification
  // or an optional repeat layer is unavailable at runtime.
  const features = display.baseLines.map(line => ({
      type: 'Feature' as const,
      id: line.id,
      properties: {
        occurrenceIds: line.occurrenceIds.join(','),
        coverageIds: line.coverageIds.join(','),
        role: 'canonical-safety',
      },
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
      coverageIds: lane.coverageIds.join(','),
      multiplicity: lane.multiplicity,
      offsetPx: lane.offsetPx,
      role: 'repeat-lane',
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
  const turnCapFeatures = display.turnConnectors.map(connector => ({
    type: 'Feature' as const,
    id: connector.id,
    properties: {
      occurrenceIds: connector.occurrenceIds.join(','),
      multiplicity: connector.multiplicity,
      role: 'repeat-turn-cap',
    },
    geometry: {
      type: 'Point' as const,
      coordinates: [connector.coordinate.lng, connector.coordinate.lat],
    },
  }));
  // Reversals are split into opposing screen-offset lanes. A small filled
  // screen-space cap at the truthful turn anchor joins their anti-aliased
  // inner edges. It is not persisted route geometry and cannot grow into the
  // old metre-scaled Omega loop as the map zoom changes.
  const repeatPresentationFeatures = repeatLaneFeatures;
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
            aboveLayerID={aboveLayerID}
            style={{
              lineColor: theme.mapRouteCasing,
              lineWidth: display.repeatLanes.length > 0 ? 6 : 9,
              lineOpacity: 0.78,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
          <LineLayer
            id={`${idPrefix}-line`}
            slot="top"
            aboveLayerID={aboveLayerID}
            style={{
              lineColor: theme.mapRouteLine,
              lineWidth: display.repeatLanes.length > 0 ? 3.5 : 6,
              lineOpacity: 0.96,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>
      ) : null}
      {repeatPresentationFeatures.length > 0 ? (
        <ShapeSource
          id={`${idPrefix}-repeat-lanes`}
          shape={{ type: 'FeatureCollection', features: repeatPresentationFeatures }}
        >
          <LineLayer
            id={`${idPrefix}-repeat-lane-casing`}
            slot="top"
            aboveLayerID={aboveLayerID}
            filter={['==', ['get', 'role'], 'repeat-lane']}
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
            aboveLayerID={aboveLayerID}
            filter={['==', ['get', 'role'], 'repeat-lane']}
            style={{
              lineColor: theme.mapRouteLine,
              lineWidth: 7,
              lineOffset: ['get', 'offsetPx'],
              lineOpacity: 0.98,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>
      ) : null}
      {CircleLayer && turnCapFeatures.length > 0 ? (
        <ShapeSource
          id={`${idPrefix}-repeat-turn-caps`}
          shape={{ type: 'FeatureCollection', features: turnCapFeatures }}
        >
          <CircleLayer
            id={`${idPrefix}-repeat-turn-cap`}
            slot="top"
            aboveLayerID={aboveLayerID}
            style={{
              circleRadius: 5.25,
              circleColor: theme.mapRouteLine,
              circleOpacity: 0.98,
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
            aboveLayerID={aboveLayerID}
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
            aboveLayerID={aboveLayerID}
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
