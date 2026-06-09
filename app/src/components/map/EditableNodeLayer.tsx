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
import { View, StyleSheet, Platform } from 'react-native';
import type { RouteNodeAnchor } from '../../services/routing/routeNodeAnchors';

let PointAnnotation: any = null;
if (Platform.OS !== 'web') {
  try {
    const Mapbox = require('@rnmapbox/maps');
    PointAnnotation = Mapbox.PointAnnotation;
  } catch {
    // unavailable
  }
}

export interface EditableNodeLayerProps {
  anchors: RouteNodeAnchor[];
  selectedAnchorId: string | null;
  candidateAnchorIds: Set<string>;
  onAnchorTap: (anchor: RouteNodeAnchor) => void;
}

export function EditableNodeLayer({
  anchors,
  selectedAnchorId,
  candidateAnchorIds,
  onAnchorTap,
}: EditableNodeLayerProps): React.JSX.Element | null {
  if (!PointAnnotation) return null;
  if (anchors.length === 0) return null;

  return (
    <>
      {anchors.map(anchor => {
        const isSelected = anchor.id === selectedAnchorId;
        const isCandidate = candidateAnchorIds.has(anchor.id);
        const isTrimRestore =
          anchor.kind === 'trim-restore-start' || anchor.kind === 'trim-restore-end';

        // Trim-restore anchors only visible when their endpoint is the
        // selected source (i.e. they're a candidate). Otherwise they
        // sit hidden — too many original-trace points would clutter
        // the map.
        if (isTrimRestore && !isCandidate) return null;

        const isEndpoint =
          anchor.kind === 'endpoint-start' || anchor.kind === 'endpoint-end';

        const visualState: 'idle' | 'selected' | 'candidate-midpoint' | 'candidate-trim' =
          isSelected
            ? 'selected'
            : isCandidate
              ? (isTrimRestore || isEndpoint || anchor.kind === 'intersection'
                  ? (selectedIsEndpoint(selectedAnchorId, anchors) ? 'candidate-trim' : 'candidate-midpoint')
                  : 'candidate-midpoint')
              : 'idle';

        return (
          <PointAnnotation
            key={anchor.id}
            id={`anchor-${anchor.id}`}
            coordinate={[anchor.lng, anchor.lat]}
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

  if (state === 'selected') {
    return {
      backgroundColor: isEndpoint ? (isStart ? '#10B981' : '#EF4444') : '#3B82F6',
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 4,
      borderColor: 'rgba(59,130,246,0.35)',
    };
  }
  if (state === 'candidate-trim') {
    return {
      backgroundColor: '#F59E0B', // orange — trim semantics
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 2,
      borderColor: '#FFFFFF',
    };
  }
  if (state === 'candidate-midpoint') {
    return {
      backgroundColor: '#10B981', // green — midpoint replace
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 2,
      borderColor: '#FFFFFF',
    };
  }
  // idle
  if (isEndpoint) {
    return {
      backgroundColor: isStart ? '#10B981' : '#EF4444',
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 2,
      borderColor: '#FFFFFF',
    };
  }
  return {
    backgroundColor: '#94A3B8', // slate — quiet idle
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
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
