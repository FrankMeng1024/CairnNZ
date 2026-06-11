/**
 * ViaPointLayer — render via points (blue dots, draggable, tap-to-select) on
 * the Mapbox map.
 *
 * Sprint 67 v236 — second pass after Arch review.
 *
 * Gesture model (avoids the iOS PointAnnotation drag vs TouchableOpacity
 * long-press conflict the first pass had):
 *   - Tap a dot → select it (visual ring). The PARENT (RouteEditorScreen)
 *     decides what tapping a selected dot does: a second tap on a selected
 *     dot triggers `onTapSelectedAgain(viaId)` which prompts delete.
 *   - Drag (PointAnnotation onDragEnd) → debounced refit by parent.
 *   - There is NO long-press on the dot. Long-press is reserved for the
 *     map background (add via).
 */

import React from 'react';
import { View, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import type { ViaPoint } from '../../services/routing/mapmatch/types';

let PointAnnotation: any = null;
if (Platform.OS !== 'web') {
  try {
    const Mapbox = require('@rnmapbox/maps');
    PointAnnotation = Mapbox.PointAnnotation;
  } catch {
    // Mapbox unavailable
  }
}

export interface ViaPointLayerProps {
  vias: ViaPoint[];
  selectedViaId?: string | null;
  computingViaIds?: Set<string>;
  onTapVia?: (viaId: string) => void;
  onDragEnd?: (viaId: string, lng: number, lat: number) => void;
}

export function ViaPointLayer({
  vias,
  selectedViaId,
  computingViaIds,
  onTapVia,
  onDragEnd,
}: ViaPointLayerProps): React.JSX.Element | null {
  if (!PointAnnotation) return null;
  if (vias.length === 0) return null;

  return (
    <>
      {vias.map(via => {
        const isComputing = computingViaIds?.has(via.id) ?? false;
        const isSelected = selectedViaId === via.id;
        return (
          <PointAnnotation
            key={via.id}
            id={`via-${via.id}`}
            coordinate={[via.lng, via.lat]}
            draggable={true}
            onDragEnd={(e: any) => {
              if (!onDragEnd) return;
              const c = e?.geometry?.coordinates;
              if (Array.isArray(c) && c.length >= 2) {
                onDragEnd(via.id, c[0], c[1]);
              }
            }}
            onSelected={() => onTapVia?.(via.id)}
          >
            <View style={styles.hitTarget} pointerEvents="none">
              {isSelected && <View style={styles.selectionRing} />}
              <View style={styles.dotOuter}>
                <View style={styles.dotInner} />
                {isComputing && (
                  <View style={styles.spinnerOverlay}>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  </View>
                )}
              </View>
            </View>
          </PointAnnotation>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  hitTarget: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionRing: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: '#3B82F6',
    backgroundColor: 'rgba(59,130,246,0.15)',
  },
  dotOuter: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#3B82F6',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  dotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
  },
  spinnerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(59,130,246,0.6)',
    borderRadius: 13,
  },
});
