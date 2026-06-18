/**
 * PinAdjustStep — Step 2 of plant flow.
 *
 * Shows the algorithm-suggested position on a Mapbox satellite mini map
 * with a draggable pin and accuracy circle. User can:
 *   - Confirm (default — most users will)
 *   - Drag the pin within PinNudgeConfig.maxNudgeMeters of the original
 *     algorithm position (prevents accidental kilometer-scale moves)
 *
 * Visual layers (bottom → top):
 *   1. Mapbox satellite raster (most useful tile-set for ground features)
 *   2. ShapeSource + FillLayer for the accuracy circle
 *   3. ShapeSource + LineLayer for the max-nudge boundary (subtle)
 *   4. PointAnnotation (draggable pin)
 *
 * The map uses `mapbox://styles/mapbox/satellite-streets-v12` so users
 * can read street labels while dropping a pin on a path/building edge.
 */

import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { getMapbox } from '../../memory/services/mapboxAdapter';
import { PinNudgeConfig } from '../config/plantConfig';
import { MemoryColors } from '../../memory/config/memoryConfig';
import { Colors } from '../../../components/tokens';
import { haversineM } from '../../../utils/geo';

interface Props {
  lat: number;
  lng: number;
  accuracyM: number;
  onConfirm: (lat: number, lng: number) => void;
  onBack: () => void;
}

const SATELLITE_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';

/**
 * Generate a circle GeoJSON polygon (used for accuracy + max-nudge rings).
 * Returns 64-vertex polygon centered at (lat, lng).
 */
function makeCircleGeoJson(lat: number, lng: number, radiusM: number): any {
  const points: [number, number][] = [];
  const earthRad = 6378137;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i <= 64; i++) {
    const theta = (i / 64) * Math.PI * 2;
    const dLat = (radiusM * Math.cos(theta)) / earthRad;
    const dLng = (radiusM * Math.sin(theta)) / (earthRad * cosLat);
    points.push([lng + (dLng * 180) / Math.PI, lat + (dLat * 180) / Math.PI]);
  }
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [points] },
    properties: {},
  };
}

export function PinAdjustStep({ lat, lng, accuracyM, onConfirm, onBack }: Props) {
  const Mapbox = getMapbox();
  const [pinLat, setPinLat] = useState(lat);
  const [pinLng, setPinLng] = useState(lng);
  const originRef = useRef({ lat, lng });

  const accuracyCircle = useMemo(
    () => makeCircleGeoJson(originRef.current.lat, originRef.current.lng, Math.max(accuracyM, 2)),
    [accuracyM]
  );
  const maxNudgeCircle = useMemo(
    () => makeCircleGeoJson(originRef.current.lat, originRef.current.lng, PinNudgeConfig.maxNudgeMeters),
    []
  );

  const onPinDragEnd = (e: any) => {
    const coord = e?.geometry?.coordinates;
    if (!Array.isArray(coord)) return;
    const newLng = coord[0];
    const newLat = coord[1];
    // Enforce maxNudgeMeters — clamp to the nearest point on the boundary
    // if the user dragged too far.
    const dist = haversineM(
      { lat: originRef.current.lat, lng: originRef.current.lng },
      { lat: newLat, lng: newLng }
    );
    if (dist > PinNudgeConfig.maxNudgeMeters) {
      const ratio = PinNudgeConfig.maxNudgeMeters / dist;
      setPinLat(originRef.current.lat + (newLat - originRef.current.lat) * ratio);
      setPinLng(originRef.current.lng + (newLng - originRef.current.lng) * ratio);
    } else {
      setPinLat(newLat);
      setPinLng(newLng);
    }
  };

  // Web fallback / Mapbox unavailable
  if (!Mapbox.available || Platform.OS === 'web') {
    return <PinAdjustFallback lat={lat} lng={lng} accuracyM={accuracyM}
                              onConfirm={() => onConfirm(pinLat, pinLng)}
                              onBack={onBack} />;
  }
  const { MapView, Camera, ShapeSource, FillLayer, LineLayer, PointAnnotation } = Mapbox;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>You are here?</Text>
      <Text style={styles.sub}>
        We placed the pin where the GPS said. Drag if you can see a more accurate spot.
      </Text>

      <View style={styles.mapWrap}>
        <MapView
          style={styles.map}
          styleURL={SATELLITE_STYLE}
          compassEnabled={false}
          scaleBarEnabled={false}
          attributionEnabled={false}
          logoEnabled={false}
        >
          <Camera
            centerCoordinate={[originRef.current.lng, originRef.current.lat]}
            zoomLevel={18}
            animationMode={'flyTo'}
            animationDuration={400}
          />
          <ShapeSource id="acc-src" shape={accuracyCircle}>
            <FillLayer
              id="acc-fill"
              style={{ fillColor: Colors.primary, fillOpacity: 0.18 }}
            />
            <LineLayer
              id="acc-line"
              style={{ lineColor: Colors.primary, lineWidth: 1.5, lineOpacity: 0.6 }}
            />
          </ShapeSource>
          <ShapeSource id="nudge-src" shape={maxNudgeCircle}>
            <LineLayer
              id="nudge-line"
              style={{
                lineColor: Colors.flag,
                lineWidth: 1,
                lineOpacity: 0.4,
                lineDasharray: [2, 3],
              }}
            />
          </ShapeSource>
          <PointAnnotation
            id="plant-pin"
            coordinate={[pinLng, pinLat]}
            draggable={true}
            onDragEnd={onPinDragEnd}
          >
            <View style={styles.pin}>
              <View style={styles.pinHead} />
              <View style={styles.pinTail} />
            </View>
          </PointAnnotation>
        </MapView>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>
          ± {accuracyM.toFixed(1)} m · drag pin to fine-tune
        </Text>
      </View>

      <View style={{ flex: 1 }} />
      <TouchableOpacity style={styles.primaryBtn} onPress={() => onConfirm(pinLat, pinLng)}>
        <Text style={styles.primaryBtnText}>Looks right</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Text style={styles.backBtnText}>Back</Text>
      </TouchableOpacity>
    </View>
  );
}

/** Web / Mapbox-unavailable fallback — text-only version. */
function PinAdjustFallback({
  lat, lng, accuracyM, onConfirm, onBack,
}: {
  lat: number; lng: number; accuracyM: number;
  onConfirm: () => void; onBack: () => void;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>You are here?</Text>
      <Text style={styles.sub}>Map preview not available on this platform.</Text>
      <View style={styles.fallbackBox}>
        <Text style={styles.fallbackCoord}>
          {lat.toFixed(6)}, {lng.toFixed(6)}
        </Text>
        <Text style={styles.fallbackAcc}>± {accuracyM.toFixed(1)} m</Text>
      </View>
      <View style={{ flex: 1 }} />
      <TouchableOpacity style={styles.primaryBtn} onPress={onConfirm}>
        <Text style={styles.primaryBtnText}>Confirm</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Text style={styles.backBtnText}>Back</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 22, fontWeight: '500', color: MemoryColors.sepiaDeep, marginBottom: 6 },
  sub:   { fontSize: 13, color: MemoryColors.cairnPublic, marginBottom: 16 },
  mapWrap: {
    height: 280,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  map: { flex: 1 },
  metaRow: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  metaText: { fontSize: 11, color: Colors.textSecondary },
  pin: { alignItems: 'center', justifyContent: 'center' },
  pinHead: {
    width: 24, height: 24,
    borderRadius: 12,
    backgroundColor: Colors.flag,
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  pinTail: {
    marginTop: -3,
    width: 0, height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: Colors.flag,
  },
  fallbackBox: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    padding: 16, alignItems: 'center',
  },
  fallbackCoord: { fontFamily: 'Courier', fontSize: 13, color: MemoryColors.sepiaDeep },
  fallbackAcc:   { fontSize: 12, color: Colors.primary, marginTop: 6 },
  primaryBtn: {
    backgroundColor: MemoryColors.sepia,
    padding: 14, borderRadius: 12, alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  backBtn: { padding: 14, alignItems: 'center' },
  backBtnText: { fontSize: 13, color: MemoryColors.cairnPublic },
});
