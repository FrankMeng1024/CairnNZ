/**
 * EditOverlayV236 — the entire route-edit interaction surface.
 *
 * Mounted by RouteEditorScreen when `dualEditActive` is true. Replaces the
 * v229–v235 EditableNodeLayer + DraggableHandle stack with the via-point +
 * trim-slider model.
 *
 * Sprint 67 v236.
 *
 * Renders in two zones:
 *   - Inside the MapView: ViaPointLayer (blue dots) — must be a child of
 *     MapView so PointAnnotation works. Caller mounts that piece directly.
 *   - Outside (overlay): the bottom TrimSlider, top status banner, and any
 *     loading/error UI.
 *
 * The map's onLongPress fires `onMapLongPress(coord)` — caller wires this to
 * `useRouteEditStore.getState().addVia(coord)`.
 */

import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { TrimSlider } from './TrimSlider';
import { useRouteEditStore } from '../../store/useRouteEditStore';
import { polylineLengthM } from '../../services/routing/corridor/PolylineSampler';

interface EditOverlayV236Props {
  onCancel: () => void;
  onSave: () => Promise<void> | void;
}

export function EditOverlayV236({ onCancel, onSave }: EditOverlayV236Props): React.JSX.Element {
  const isComputing = useRouteEditStore(s => s.isComputing);
  const lastError = useRouteEditStore(s => s.lastError);
  const lastWarning = useRouteEditStore(s => s.lastWarning);
  const matchedPoints = useRouteEditStore(s => s.matchedPoints);
  const trimStartFrac = useRouteEditStore(s => s.trimStartFrac);
  const trimEndFrac = useRouteEditStore(s => s.trimEndFrac);
  const viaCount = useRouteEditStore(s => s.viaPoints.length);
  const setLastError = useRouteEditStore(s => s.setLastError);
  const setTrimStart = useRouteEditStore(s => s.setTrimStart);
  const setTrimEnd = useRouteEditStore(s => s.setTrimEnd);
  const resetEdits = useRouteEditStore(s => s.resetEdits);

  const totalLengthM = polylineLengthM(matchedPoints);

  return (
    <View pointerEvents="box-none" style={styles.container}>
      {/* Top: status + cancel/save */}
      <View style={styles.topBar} pointerEvents="auto">
        <TouchableOpacity onPress={onCancel} style={styles.topBtn}>
          <Text style={styles.topBtnText}>取消</Text>
        </TouchableOpacity>
        <View style={styles.topCenter}>
          {isComputing ? (
            <View style={styles.computingRow}>
              <ActivityIndicator size="small" color="#3B82F6" />
              <Text style={styles.computingText}>计算中…</Text>
            </View>
          ) : (
            <Text style={styles.statusText}>
              微调 {viaCount}/5 · 长按地图加点
            </Text>
          )}
        </View>
        <TouchableOpacity
          onPress={() => {
            if (isComputing) return;
            onSave();
          }}
          style={[styles.topBtn, styles.saveBtn]}
        >
          <Text style={[styles.topBtnText, styles.saveBtnText]}>保存</Text>
        </TouchableOpacity>
      </View>

      {/* Banners */}
      {(lastError || lastWarning) && (
        <View style={styles.bannerContainer} pointerEvents="auto">
          {lastError && (
            <TouchableOpacity
              style={[styles.banner, styles.errorBanner]}
              onPress={() => setLastError(null)}
              activeOpacity={0.85}
            >
              <Text style={styles.bannerText}>{lastError}</Text>
              <Text style={styles.bannerDismiss}>×</Text>
            </TouchableOpacity>
          )}
          {lastWarning && !lastError && (
            <View style={[styles.banner, styles.warningBanner]}>
              <Text style={styles.bannerText}>{lastWarning}</Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.bottomZone} pointerEvents="auto">
        <View style={styles.bottomActions}>
          <TouchableOpacity
            onPress={() => {
              Alert.alert(
                '重置编辑?',
                '会清除所有微调点和裁剪。',
                [
                  { text: '取消', style: 'cancel' },
                  { text: '重置', style: 'destructive', onPress: () => resetEdits() },
                ],
              );
            }}
            style={styles.resetBtn}
          >
            <Text style={styles.resetBtnText}>重置</Text>
          </TouchableOpacity>
        </View>
        <TrimSlider
          trimStartFrac={trimStartFrac}
          trimEndFrac={trimEndFrac}
          onTrimStartChange={setTrimStart}
          onTrimEndChange={setTrimEnd}
          totalLengthM={totalLengthM}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 50,
    paddingBottom: 10,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  topBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  topBtnText: {
    fontSize: 15,
    color: '#374151',
    fontWeight: '500',
  },
  saveBtn: {
    backgroundColor: '#3B82F6',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  topCenter: {
    flex: 1,
    alignItems: 'center',
  },
  computingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  computingText: {
    marginLeft: 8,
    fontSize: 13,
    color: '#6B7280',
  },
  statusText: {
    fontSize: 13,
    color: '#6B7280',
  },
  bannerContainer: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 10,
    marginBottom: 6,
  },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  warningBanner: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    color: '#1F2937',
  },
  bannerDismiss: {
    fontSize: 18,
    color: '#6B7280',
    paddingLeft: 8,
  },
  bottomZone: {
    backgroundColor: 'transparent',
  },
  bottomActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  resetBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  resetBtnText: {
    fontSize: 13,
    color: '#6B7280',
  },
});
