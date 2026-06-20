/**
 * PinAdjustStep — Step 2 of plant flow.
 *
 * v0.2.6.5 (U3+U4):
 *   - Default map style is the same as Hiking (outdoors-v12) — easier
 *     on the eye and battery. A toggle button in the corner switches
 *     to satellite imagery for users who want to see roof / tree
 *     features for ultra-precise positioning.
 *   - Pin drag handler now accepts both the legacy event shape
 *     (e.geometry.coordinates) and the v10+ shape (e.coordinates).
 *
 * Visual layers (bottom → top):
 *   1. Mapbox style raster
 *   2. ShapeSource + FillLayer for the accuracy circle
 *   3. ShapeSource + LineLayer for the max-nudge boundary
 *   4. PointAnnotation (draggable pin)
 */

import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Alert } from 'react-native';
import { getMapbox } from '../../memory/services/mapboxAdapter';
import { PinNudgeConfig } from '../config/plantConfig';
import { MemoryColors } from '../../memory/config/memoryConfig';
import { Colors } from '../../../components/tokens';
import { haversineM } from '../../../utils/geo';
import { getPrimaryMapStyle } from '../../../config/mapbox';
import { log } from '../../../services/appLog';
import { Icon } from '../../../components/Icon';

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
  // U3 (v0.2.6.5): default to outdoors style (same as Hiking; lighter
  // tile data; vector instead of raster). User can toggle to satellite
  // for finer roof/tree visibility, with a one-time data warning since
  // satellite tiles are ~3-5× heavier.
  const [mapStyle, setMapStyle] = useState<'outdoors' | 'satellite'>('outdoors');
  const [satelliteWarned, setSatelliteWarned] = useState(false);

  const onToggleStyle = () => {
    if (mapStyle === 'outdoors') {
      // First time switching to satellite this session: warn about data.
      if (!satelliteWarned) {
        Alert.alert(
          'Switch to satellite view?',
          'Satellite imagery uses about 1–2 MB of mobile data on first load. The view caches locally afterwards. Continue?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Use satellite',
              onPress: () => {
                log('plant.pin_style_toggle', { to: 'satellite' });
                setSatelliteWarned(true);
                setMapStyle('satellite');
              },
            },
          ]
        );
        return;
      }
      log('plant.pin_style_toggle', { to: 'satellite' });
      setMapStyle('satellite');
    } else {
      log('plant.pin_style_toggle', { to: 'outdoors' });
      setMapStyle('outdoors');
    }
  };

  const accuracyCircle = useMemo(
    () => makeCircleGeoJson(originRef.current.lat, originRef.current.lng, Math.max(accuracyM, 2)),
    [accuracyM]
  );
  const maxNudgeCircle = useMemo(
    () => makeCircleGeoJson(originRef.current.lat, originRef.current.lng, PinNudgeConfig.maxNudgeMeters),
    []
  );

  const onPinDragEnd = (e: any) => {
    // U4 fix (v0.2.6.5): @rnmapbox/maps v10+ payload may be either
    // top-level `coordinates` or nested `geometry.coordinates`.
    // Accept both shapes; log when we hit one of the unexpected
    // payloads so future SDK upgrades surface fast.
    let coord: any = null;
    if (Array.isArray(e?.coordinates)) coord = e.coordinates;
    else if (Array.isArray(e?.geometry?.coordinates)) coord = e.geometry.coordinates;
    else if (Array.isArray(e?.nativeEvent?.coordinates)) coord = e.nativeEvent.coordinates;
    if (!Array.isArray(coord) || coord.length < 2) {
      log('plant.pin_drag_unknown_shape', {
        keys: Object.keys(e ?? {}).slice(0, 10),
      });
      return;
    }
    const newLng = coord[0];
    const newLat = coord[1];
    log('plant.pin_drag_end', { newLat, newLng });
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
          styleURL={mapStyle === 'satellite' ? SATELLITE_STYLE : getPrimaryMapStyle()}
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
        {/* U3: style toggle overlay (top-right) */}
        <TouchableOpacity
          style={styles.styleToggle}
          onPress={onToggleStyle}
          activeOpacity={0.7}
        >
          <Icon
            name={mapStyle === 'satellite' ? 'Map' : 'Globe'}
            size={18}
            color={MemoryColors.sepiaDeep}
            strokeWidth={2}
          />
        </TouchableOpacity>
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
  styleToggle: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
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
