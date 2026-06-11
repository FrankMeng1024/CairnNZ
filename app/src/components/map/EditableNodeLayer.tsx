/**
 * EditableNodeLayer — render route node anchors as small circles on the
 * map, plus highlight the selected source and its candidate targets.
 *
 * v200 spec implementation. Three visual states:
 *   - idle:      small grey circle (12pt visual, 44pt hit target)
 *   - selected:  larger blue circle with halo
 *   - candidate: green (intersection) or orange (trim) circle
 *   - trim-restore: dashed grey ring (visible only when its endpoint is
 *                   selected, hidden otherwise)
 *
 * Interaction:
 *   - PointAnnotation onSelected fires when user taps the circle.
 *   - Parent (RouteEditorScreen) holds the selected anchor id and
 *     candidate set; this component only renders.
 *
 * Hidden when the map zoom is below MIN_NODE_DISPLAY_ZOOM.
 */

import React from 'react';
import { View, StyleSheet, Platform, TouchableOpacity } from 'react-native';
import type { RouteNodeAnchor } from '../../services/routing/routeNodeAnchors';

let PointAnnotation: any = null;
let MarkerView: any = null;
if (Platform.OS !== 'web') {
  try {
    const Mapbox = require('@rnmapbox/maps');
    PointAnnotation = Mapbox.PointAnnotation;
    // v208 fix B2: MarkerView renders endpoint anchors as native view
    // annotations (always-on-top by design — bypasses the POI symbol
    // layer z-order issue where outdoors-v12 restaurant icons were
    // covering the endpoint dots on iOS).
    MarkerView = Mapbox.MarkerView;
  } catch {
    // unavailable
  }
}

export interface EditableNodeLayerProps {
  anchors: RouteNodeAnchor[];
  selectedAnchorId: string | null;
  candidateAnchorIds: Set<string>;
  onAnchorTap: (anchor: RouteNodeAnchor) => void;
  /**
   * v200 Phase 5: drag-with-magnet. When the user drags the SELECTED
   * source anchor (Mapbox PointAnnotation draggable), find the nearest
   * candidate within snapRadiusM and commit replacement. Drag-release
   * on empty space = no-op. This complements tap-to-tap — power users
   * can drag for the more direct gesture; new users discover tap.
   */
  onAnchorDragEnd?: (
    sourceAnchor: RouteNodeAnchor,
    releaseLng: number,
    releaseLat: number,
  ) => void;
  /** Current map zoom — anchors hidden below MIN_NODE_DISPLAY_ZOOM. */
  currentZoom?: number;
}

const MIN_NODE_DISPLAY_ZOOM = 14;

export function EditableNodeLayer({
  anchors,
  selectedAnchorId,
  candidateAnchorIds,
  onAnchorTap,
  onAnchorDragEnd,
  currentZoom,
}: EditableNodeLayerProps): React.JSX.Element | null {
  if (!PointAnnotation) return null;
  if (anchors.length === 0) return null;
  // v200 Phase 6: hide all anchor circles when zoomed out too far.
  // Endpoints stay visible because they're the trim handles — losing
  // them would leave the user with no edit surface at all on long
  // routes. Intersection nodes + trim-restore anchors hide.
  const hideIntersections =
    typeof currentZoom === 'number' && currentZoom < MIN_NODE_DISPLAY_ZOOM;

  return (
    <>
      {anchors.map(anchor => {
        const isSelected = anchor.id === selectedAnchorId;
        const isCandidate = candidateAnchorIds.has(anchor.id);
        const isTrimRestore =
          anchor.kind === 'trim-restore-start' || anchor.kind === 'trim-restore-end';
        const isEndpoint =
          anchor.kind === 'endpoint-start' || anchor.kind === 'endpoint-end';

        // Trim-restore anchors only visible when their endpoint is the
        // selected source (i.e. they're a candidate). Otherwise they
        // sit hidden — too many original-trace points would clutter
        // the map.
        if (isTrimRestore && !isCandidate) return null;
        // v200 Phase 6 + fix C1: hide intersection anchors at low zoom,
        // BUT keep them visible if they're currently lit candidates
        // (otherwise tapping an endpoint at low zoom would compute
        // candidates that the user can't see, leaving the screen
        // unresponsive). Endpoints stay visible regardless of zoom —
        // those are the trim handles and must always be reachable.
        if (
          hideIntersections &&
          anchor.kind === 'intersection' &&
          !isSelected &&
          !isCandidate
        ) {
          return null;
        }

        const visualState: 'idle' | 'selected' | 'candidate-midpoint' | 'candidate-trim' =
          isSelected
            ? 'selected'
            : isCandidate
              ? (isTrimRestore || isEndpoint || anchor.kind === 'intersection'
                  ? (selectedIsEndpoint(selectedAnchorId, anchors) ? 'candidate-trim' : 'candidate-midpoint')
                  : 'candidate-midpoint')
              : 'idle';

        // v208 fix B2: endpoints (start/end) render via MarkerView so
        // they sit above the Mapbox POI symbol layer (outdoors-v12 POI
        // restaurant/business icons were covering the endpoint dots on
        // iOS). MarkerView is a native view-annotation — guaranteed
        // top z-order. PointAnnotation in @rnmapbox/maps 10.3.1 on iOS
        // is implemented via SymbolLayer and is therefore subject to
        // layer ordering. Trade-off: MarkerView has no onSelected /
        // draggable — tap is wired via TouchableOpacity child; drag-
        // with-magnet on endpoints is dropped (rare path; tap-to-tap
        // still works). All non-endpoint anchors continue to use
        // PointAnnotation (drag retained where applicable).
        if (isEndpoint && MarkerView) {
          return (
            <MarkerView
              key={anchor.id}
              coordinate={[anchor.lng, anchor.lat]}
              anchor={{ x: 0.5, y: 0.5 }}
              allowOverlap={true}
            >
              <TouchableOpacity
                style={styles.hitTarget}
                onPress={() => onAnchorTap(anchor)}
                activeOpacity={0.7}
              >
                <View style={[styles.dot, dotStyleFor(visualState, anchor.kind)]} />
              </TouchableOpacity>
            </MarkerView>
          );
        }

        return (
          <PointAnnotation
            key={anchor.id}
            id={`anchor-${anchor.id}`}
            coordinate={[anchor.lng, anchor.lat]}
            // v233 fix: drag was confusing — required iOS long-press
            // (~500ms) and the map kept scrolling under the user's
            // finger, so 90% of users couldn't drop on the right
            // candidate. We're tap-to-tap only now: tap source → tap
            // target = commit. Disabling drag entirely.
            draggable={false}
            onDragEnd={(e: any) => {
              if (!onAnchorDragEnd) return;
              const c = e?.geometry?.coordinates;
              if (Array.isArray(c) && c.length >= 2) {
                onAnchorDragEnd(anchor, c[0], c[1]);
              }
            }}
            onSelected={() => onAnchorTap(anchor)}
          >
            <View style={styles.hitTarget}>
              <View style={[styles.dot, dotStyleFor(visualState, anchor.kind)]} />
            </View>
          </PointAnnotation>
        );
      })}
    </>
  );
}

function selectedIsEndpoint(
  selectedAnchorId: string | null,
  anchors: RouteNodeAnchor[],
): boolean {
  if (!selectedAnchorId) return false;
  const sel = anchors.find(a => a.id === selectedAnchorId);
  return sel?.kind === 'endpoint-start' || sel?.kind === 'endpoint-end';
}

function dotStyleFor(
  state: 'idle' | 'selected' | 'candidate-midpoint' | 'candidate-trim',
  kind: RouteNodeAnchor['kind'],
) {
  // Endpoint trim handles get a distinct base color so they're recognizable
  // even when idle (matches legacy DraggableHandle palette).
  const isEndpoint = kind === 'endpoint-start' || kind === 'endpoint-end';
  const isStart = kind === 'endpoint-start';

  // v233 fix: dots were too small to see/tap reliably on a busy map.
  // Sizes raised ~1.7x. idle now 18 (was 10), candidates 22 (was 14),
  // selected 28 (was 18). Borders thicker for contrast against road.
  if (state === 'selected') {
    return {
      backgroundColor: isEndpoint ? (isStart ? '#10B981' : '#EF4444') : '#3B82F6',
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: 5,
      borderColor: 'rgba(59,130,246,0.45)',
    };
  }
  if (state === 'candidate-trim') {
    return {
      backgroundColor: '#F59E0B', // orange — trim semantics
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 3,
      borderColor: '#FFFFFF',
    };
  }
  if (state === 'candidate-midpoint') {
    return {
      backgroundColor: '#10B981', // green — midpoint replace
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 3,
      borderColor: '#FFFFFF',
    };
  }
  // idle
  if (isEndpoint) {
    return {
      backgroundColor: isStart ? '#10B981' : '#EF4444',
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 3,
      borderColor: '#FFFFFF',
    };
  }
  return {
    backgroundColor: '#64748B', // slate-500 — darker than v232's 400 for contrast
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
  };
}

const styles = StyleSheet.create({
  hitTarget: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    // base styling provided by dotStyleFor() inline overrides
  },
});
