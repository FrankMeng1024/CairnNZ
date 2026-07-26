/**
 * MysteryCairnSheet — bottom sheet shown when a user taps a cairn that
 * is still in fog (not yet within 25m of the cairn's location).
 *
 * Visible information:
 *   - "Someone left a cairn here"
 *   - Like count
 *   - How long ago it was planted
 *   - Distance from user (in meters or km)
 *   - Bearing arrow (compass direction)
 *
 * NOT shown (would defeat the discovery mechanic):
 *   - Title
 *   - Body text
 *   - Voice memo
 *   - Author identity (only if from a friend, see config)
 *
 * Visibility rules come from MysteryPreviewConfig — the rendering
 * doesn't hard-code "show like count" decisions.
 */

import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { Marker } from '../../../store/useMarkerStore';
import { MemoryColors, MysteryPreviewConfig } from '../config/memoryConfig';
import { Colors } from '../../../components/tokens';
import { haversineM } from '../../../utils/geo';

interface Props {
  marker: Marker | null;
  userLat: number;
  userLng: number;
  onClose: () => void;
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function formatAge(planted: number): string {
  const diff = Date.now() - planted;
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  if (diff < hour)       return 'just now';
  if (diff < day)        return `${Math.floor(diff / hour)} h ago`;
  if (diff < 30 * day)   return `${Math.floor(diff / day)} d ago`;
  return new Date(planted).toLocaleDateString();
}

/**
 * Compute bearing from (lat1,lng1) to (lat2,lng2) in degrees from north.
 */
function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) -
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function bearingArrow(deg: number): string {
  // Coarse 8-direction arrow.
  if (deg >= 337.5 || deg < 22.5)  return '↑';
  if (deg < 67.5)                  return '↗';
  if (deg < 112.5)                 return '→';
  if (deg < 157.5)                 return '↘';
  if (deg < 202.5)                 return '↓';
  if (deg < 247.5)                 return '↙';
  if (deg < 292.5)                 return '←';
  return '↖';
}

export function MysteryCairnSheet({ marker, userLat, userLng, onClose }: Props) {
  if (!marker) return null;
  const distance = haversineM(
    { lat: userLat, lng: userLng },
    { lat: marker.lat, lng: marker.lng }
  );
  const bearing = bearingDeg(userLat, userLng, marker.lat, marker.lng);

  return (
    <Modal visible={true} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.iconCircle}>
            <Text style={styles.iconChar}>?</Text>
          </View>
          <Text style={styles.title}>Someone left a cairn here</Text>
          <Text style={styles.desc}>You'll be able to read it when you get closer.</Text>

          <View style={styles.metaRow}>
            {MysteryPreviewConfig.showAgeRelative && (
              <Meta label="ago" value={formatAge(marker.createdAt)} />
            )}
            {MysteryPreviewConfig.showDistanceBearing && (
              <Meta label="away" value={formatDistance(distance)} />
            )}
          </View>

          {MysteryPreviewConfig.showDistanceBearing && (
            <>
              <View style={styles.arrowCircle}>
                <Text style={styles.arrowChar}>{bearingArrow(bearing)}</Text>
              </View>
              <Text style={styles.cta}>Walk this way to reveal</Text>
            </>
          )}

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.meta}>
      <Text style={styles.metaValue}>{value}</Text>
      <Text style={styles.metaLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,20,20,0.30)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#2d2a26',
    paddingTop: 28,
    paddingHorizontal: 24,
    paddingBottom: 40,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    alignItems: 'center',
  },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(200,121,65,0.18)',
    borderWidth: 2, borderStyle: 'dashed', borderColor: Colors.flag,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
  },
  iconChar: { fontSize: 32, color: Colors.flag, fontWeight: '700' },
  title: {
    fontSize: 17, fontWeight: '600',
    color: Colors.flag, marginBottom: 6,
  },
  desc: {
    fontSize: 13, color: 'rgba(247,242,229,0.7)',
    textAlign: 'center', maxWidth: 240, lineHeight: 18,
    marginBottom: 18,
  },
  metaRow: {
    flexDirection: 'row', gap: 14,
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 16, marginBottom: 18,
  },
  meta: { alignItems: 'center' },
  metaValue: { fontSize: 14, fontWeight: '600', color: Colors.flag },
  metaLabel: { fontSize: 10, color: 'rgba(247,242,229,0.6)', marginTop: 2 },
  arrowCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Colors.flag,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 6,
  },
  arrowChar: { fontSize: 26, color: '#fff', fontWeight: '700' },
  cta: { fontSize: 12, color: Colors.flag, fontWeight: '500' },
  closeBtn: {
    marginTop: 18, paddingVertical: 8, paddingHorizontal: 16,
  },
  closeBtnText: { fontSize: 13, color: 'rgba(247,242,229,0.8)' },
});

