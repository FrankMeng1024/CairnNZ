/**
 * PinAdjustStep — Step 2 of plant flow.
 *
 * v0.2.6.6 (V1+V2):
 *   Drag UX rewritten to Didi/Uber style: the pin is FIXED at screen
 *   center; the user pans the MAP under it. This is dramatically
 *   smoother than PointAnnotation drag (no per-finger event lag, no
 *   pin jumping back, no SDK-version event-shape mismatch).
 *
 *   We subscribe to Camera regionDidChange and compute the new
 *   pin coords from the map's center coord. As the user drags the
 *   map, we update pinLat/pinLng in real time. The accuracy + max-
 *   nudge circles still render anchored to the original GPS spot.
 *
 *   When the user drags the map past the max-nudge boundary, we show
 *   a hint banner explaining why the pin can't move farther.
 *
 * Style toggle (top-right): outdoors ↔ satellite, with first-time
 * mobile-data warning.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  const [hintVisible, setHintVisible] = useState(false);
  const originRef = useRef({ lat, lng });
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapStyle, setMapStyle] = useState<'outdoors' | 'satellite'>('outdoors');
  const [satelliteWarned, setSatelliteWarned] = useState(false);
  // R-round N4: track last camera state so we can distinguish a real
  // pan (center moved appreciably) from a pure zoom (center didn't move).
  // Without this, onMapIdle after a pinch-to-zoom re-reads `center` —
  // which CAN drift a few pixels if the pinch focus isn't exactly screen
  // center — and the pin would jump every zoom.
  const lastSettleRef = useRef<{ lat: number; lng: number; zoom: number } | null>(null);

  const onToggleStyle = () => {
    if (mapStyle === 'outdoors') {
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

  // V2: show a hint banner when the user pushes past the boundary;
  // hide it 2 s after they stop pushing.
  const briefHint = () => {
    setHintVisible(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHintVisible(false), 2500);
  };

  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  /**
   * V1+R-round B7: onMapIdle fires AFTER pan/zoom settles (NOT during
   * pan like onCameraChanged would). This is the correct event for a
   * "drop pin where map stops" UX — high-frequency continuous events
   * caused setState jitter at ~30-60Hz on lower-end devices.
   *
   * @rnmapbox/maps v10 onMapIdle payload is a MapState whose center
   * lives at `properties.center` (NOT geometry.coordinates — that field
   * is undefined on MapState; previous fallback masked the wrong
   * contract).
   */
  const onMapSettle = (feature: any) => {
    const coord = feature?.properties?.center;
    if (!Array.isArray(coord) || coord.length < 2) return;
    const newLng = coord[0];
    const newLat = coord[1];
    const newZoom = feature?.properties?.zoom ?? 0;
    // R-round N4 (revised after sub#1 review): zoom CHANGED is a
    // reliable signal that this settle was triggered by a pinch, NOT
    // a pan. A pure pan doesn't change zoom. Previously we required
    // dPan < 5 too — but a pinch with off-center focus easily drifts
    // center by 10-30m at zoom 17.5, which incorrectly fell into the
    // pan branch and moved the pin. New rule: if zoom changed at all,
    // ignore the center delta — keep the pin where it was.
    const prev = lastSettleRef.current;
    if (prev) {
      const dZoom = Math.abs(newZoom - prev.zoom);
      if (dZoom > 0.05) {
        // zoom event — record new zoom but keep pin at prev center.
        lastSettleRef.current = { lat: prev.lat, lng: prev.lng, zoom: newZoom };
        return;
      }
    }
    lastSettleRef.current = { lat: newLat, lng: newLng, zoom: newZoom };
    const dist = haversineM(
      { lat: originRef.current.lat, lng: originRef.current.lng },
      { lat: newLat, lng: newLng }
    );
    if (dist > PinNudgeConfig.maxNudgeMeters) {
      const ratio = PinNudgeConfig.maxNudgeMeters / dist;
      const clampedLat = originRef.current.lat + (newLat - originRef.current.lat) * ratio;
      const clampedLng = originRef.current.lng + (newLng - originRef.current.lng) * ratio;
      setPinLat(clampedLat);
      setPinLng(clampedLng);
      briefHint();
      log('plant.pin_clamped', { distM: Math.round(dist) });
    } else {
      setPinLat(newLat);
      setPinLng(newLng);
    }
  };

  if (!Mapbox.available) {
    return <PinAdjustFallback lat={lat} lng={lng} accuracyM={accuracyM}
                              onConfirm={() => onConfirm(pinLat, pinLng)}
                              onBack={onBack} />;
  }
  const { MapView, Camera, ShapeSource, FillLayer, LineLayer } = Mapbox;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>You are here?</Text>
      <Text style={styles.sub}>
        Drag the map to fine-tune. The pin marks where your cairn will be planted.
      </Text>

      <View style={styles.mapWrap}>
        <MapView
          style={styles.map}
          styleURL={mapStyle === 'satellite' ? SATELLITE_STYLE : getPrimaryMapStyle()}
          compassEnabled={false}
          scaleBarEnabled={false}
          attributionEnabled={false}
          logoEnabled={false}
          onMapIdle={onMapSettle}
        >
          <Camera
            defaultSettings={{
              centerCoordinate: [originRef.current.lng, originRef.current.lat],
              // R-round N3 fix: zoom 18 made the 50m max-nudge ring extend
              // off the map preview (user couldn't see the boundary).
              // At zoom 17.5, ground resolution at lat≈-41° (NZ) is
              // ~0.6 m/px → 100m diameter ring ≈ 165px, comfortable on
              // a 340px-tall map frame.
              zoomLevel: 17.5,
            }}
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
        </MapView>

        {/* V1: pin is fixed at screen center — non-interactive overlay. */}
        <View pointerEvents="none" style={styles.centerOverlay}>
          <View style={styles.pin}>
            <View style={styles.pinHead} />
            <View style={styles.pinTail} />
          </View>
        </View>

        {/* V2: hint banner when user pushes past the max-nudge ring */}
        {hintVisible && (
          <View style={styles.hintBanner} pointerEvents="none">
            <Text style={styles.hintBannerText}>
              Pin stays within {PinNudgeConfig.maxNudgeMeters} m of your GPS spot.
            </Text>
          </View>
        )}

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
          ± {accuracyM.toFixed(1)} m · drag the map to fine-tune
        </Text>
      </View>

      <View style={{ flex: 1 }} />
      {/* R-round N4: hard-gate confirmation on distance. Even though the
          settle handler clamps, edge cases (zoom-only events, settle
          before first pan, etc.) could leave pin == origin but user
          intent unclear. Distance from origin to pin must be within
          maxNudge for the button to fire. */}
      {(() => {
        const pinDistFromOrigin = haversineM(
          { lat: originRef.current.lat, lng: originRef.current.lng },
          { lat: pinLat, lng: pinLng }
        );
        const canConfirm = pinDistFromOrigin <= PinNudgeConfig.maxNudgeMeters + 0.5;
        return (
          <TouchableOpacity
            style={[styles.primaryBtn, !canConfirm && styles.primaryBtnDisabled]}
            disabled={!canConfirm}
            onPress={() => {
              if (!canConfirm) return;
              log('plant.pin_confirm', { lat: pinLat, lng: pinLng });
              onConfirm(pinLat, pinLng);
            }}
          >
            <Text style={[styles.primaryBtnText, !canConfirm && styles.primaryBtnTextDisabled]}>
              {canConfirm ? 'Looks right' : `Pin too far — pan back within ${PinNudgeConfig.maxNudgeMeters} m`}
            </Text>
          </TouchableOpacity>
        );
      })()}
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Text style={styles.backBtnText}>Back</Text>
      </TouchableOpacity>
    </View>
  );
}

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
        <Text style={styles.fallbackCoord}>{lat.toFixed(6)}, {lng.toFixed(6)}</Text>
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
    // R-round N3 fix: 280 was too short to show the full 50m max-nudge
    // ring at any practical zoom. 340 gives the ring vertical breathing
    // room AND leaves room for content step content below the bottom
    // bar.
    height: 340,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  map: { flex: 1 },
  styleToggle: {
    position: 'absolute',
    top: 8, right: 8,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  centerOverlay: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0, right: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  hintBanner: {
    position: 'absolute',
    bottom: 12, left: 12, right: 12,
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 12,
  },
  hintBannerText: {
    color: '#fff', fontSize: 12, textAlign: 'center',
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
  primaryBtnDisabled: {
    backgroundColor: '#d4ccbd',
  },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  primaryBtnTextDisabled: { color: '#fff', opacity: 0.85 },
  backBtn: { padding: 14, alignItems: 'center' },
  backBtnText: { fontSize: 13, color: MemoryColors.cairnPublic },
});
