/**
 * MarkerDetailScreen — v300
 *
 * Detail page for a single cairn / marker. UI styled to match the
 * project's other detail screens (MapHistoryScreen, RoutesScreen):
 * top map hero + scrollable content panel + top-left BackButton.
 *
 * Two entry points (the user spec calls for one shared screen):
 *   1. Plant flow success: PlantScreen.commit replaces the route here
 *   2. RoutesScreen Flags tab: tap navigates here
 *
 * Behavior (v300 reversal of v299's read-only stance):
 *   - Owner sees Edit + Delete actions
 *   - Edit can modify title / body / type / permission (lat/lng locked)
 *   - Delete prompts confirm, then removes + nav.goBack
 *   - publicSnapshot: once a marker has been public, what others
 *     see is frozen. If the owner has edited away from the snapshot,
 *     a small banner shows "Others see: [snapshot.note], pinned as
 *     [snapshot.type]" so the owner is reminded of the divergence.
 *   - Toggling public off/on flips visibility but never re-snapshots.
 */
import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Dimensions, Platform, Alert,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useMarkerStore, type MarkerPermission } from '../store/useMarkerStore';
import { useAppStore } from '../store/useAppStore';
import { MARKER_TYPES, type MarkerType } from '../config/markerTypes';
import { splitTitleBody, encodeTitleBody } from '../features/plant/services/noteEncoding';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../components/tokens';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import { BackButton } from '../components/BackButton';
// R114 (2026-08-07): MemoryColors import removed — the last sepia
// residual (root bg) migrated to Colors.bg per design §12 for full
// Mark theme unification.
// R114 (2026-08-07): edit mode now uses the shared MarkForm — same
// component ContentStep uses at plant time, so create + edit are
// pixel-identical (design §6).
import { MarkForm } from '../features/marks/components/MarkForm';
// v381: use the v10 reliquary medallion pin in detail page too, not just
// on Memory map. Pre-fix the detail page rendered a v300 hollow pin which
// looked nothing like the v10 design users see on the Memory map — visual
// inconsistency between "where I saw it" and "where I tap to read it".
import { CairnPin, resolveTier } from '../features/memory/components/CairnPinsLayer';
import { getPrimaryMapStyle } from '../config/mapbox';
import { formatDate } from '../utils/geo';
import { log } from '../services/appLog';
import { ContentConfig, VisibilityConfig } from '../features/plant/config/plantConfig';
// v422 offline-first: 显示同步状态 badge (pending / syncing / synced / failed)
import { SyncBadge } from '../components/SyncBadge';
// v422 D 类: marker edit/delete 是"回家做"的动作, 无网禁用按钮 + 提示
import { useOnlineOnly } from '../hooks/useOnlineOnly';

let MapView: any = null;
let CameraComponent: any = null;
let PointAnnotation: any = null;
let MarkerView: any = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Mapbox = require('@rnmapbox/maps');
    MapView = Mapbox.MapView;
    CameraComponent = Mapbox.Camera;
    PointAnnotation = Mapbox.PointAnnotation;
    MarkerView = Mapbox.MarkerView;
  } catch {}
} else {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const adapter = require('../features/memory/services/mapboxAdapter.web');
    const m = adapter.makeWebMapboxAdapter();
    if (m && m.available) {
      MapView = m.MapView;
      CameraComponent = m.Camera;
      PointAnnotation = m.PointAnnotation;
      MarkerView = m.MarkerView;
    }
  } catch {}
}

const { height: H } = Dimensions.get('window');
const MAP_H = Math.max(280, H - 480);

type DetailRoute = RouteProp<RootStackParamList, 'MarkerDetail'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

const VISIBILITY_LABEL: Record<MarkerPermission, { label: string; iconName: IconName }> = {
  personal: { label: 'Just me', iconName: 'Lock' },
  group:    { label: 'Friends', iconName: 'Users' },
  public:   { label: 'Anyone',  iconName: 'Globe' },
};

export function MarkerDetailScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<DetailRoute>();
  const markerId = route.params?.markerId;
  const markers = useMarkerStore((s) => s.markers);
  const updateMarker = useMarkerStore((s) => s.updateMarker);
  const deleteMarker = useMarkerStore((s) => s.deleteMarker);
  const userId = useAppStore((s) => s.user?.id ?? '');

  const marker = useMemo(
    // v423 C1 fix: offline-first ack 后 marker.id 会从 localId 换成 server id.
    // Plant flow nav.replace 传的 markerId 是 localId, 若只按 m.id 匹配, ack
    // 一成功 find 立刻返回 undefined, 屏幕空白. 用 (id | localId) 双匹配保证
    // 用户在同一屏看到 pending → syncing → synced 完整生命周期.
    () => markers.find((m) => m.id === markerId || m.localId === markerId),
    [markers, markerId]
  );

  // Edit-mode local state. Initialized from marker only when entering edit.
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editType, setEditType] = useState<MarkerType>('cairn');
  const [editPermission, setEditPermission] = useState<MarkerPermission>('personal');
  const [saving, setSaving] = useState(false);

  // v422 D 类: edit/delete 无网禁用. reason="Needs internet" 用于 button hint.
  const { online } = useOnlineOnly();

  const enterEdit = useCallback(() => {
    if (!marker) return;
    const { title, body } = splitTitleBody(marker.note);
    setEditTitle(title);
    setEditBody(body);
    setEditType(marker.type);
    setEditPermission(marker.permission);
    setIsEditing(true);
    log('marker.edit_open', { id: marker.id });
  }, [marker]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!marker) return;
    setSaving(true);
    try {
      const newNote = encodeTitleBody(editTitle.trim(), editBody.trim());
      await updateMarker(marker.id, {
        type: editType,
        note: newNote,
        permission: editPermission,
      });
      log('marker.edit_save', { id: marker.id, type: editType, perm: editPermission });
      setIsEditing(false);
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? 'Please try again in a moment.');
    } finally {
      setSaving(false);
    }
  }, [marker, editTitle, editBody, editType, editPermission, updateMarker]);

  const handleDelete = useCallback(() => {
    if (!marker) return;
    Alert.alert(
      'Delete this cairn?',
      'It will be removed from your Memory and (if shared) from public view. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            log('marker.delete', { id: marker.id });
            await deleteMarker(marker.id);
            if (nav.canGoBack()) nav.goBack();
          },
        },
      ]
    );
  }, [marker, deleteMarker, nav]);

  if (!marker) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.backRowTop}>
          <BackButton variant="pill" />
        </View>
        <View style={styles.notFoundBox}>
          <Text style={styles.notFoundTitle}>Cairn not found</Text>
          <Text style={styles.notFoundSub}>
            This cairn may have been removed or hasn't synced yet.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const meta = MARKER_TYPES[marker.type] ?? MARKER_TYPES.cairn;
  const { title: privateTitle, body: privateBody } = splitTitleBody(marker.note);
  const vis = VISIBILITY_LABEL[marker.permission] ?? VISIBILITY_LABEL.personal;
  const dateStr = formatDate(marker.createdAt);
  // v416 fix (Bug D): 移除 authorId === 'server' 视为 owner. 后端 GET /api/markers
  // 之前未返回 user_id, fromBackend fallback 'server' 使**任何** marker 都被视为 owner,
  // 显示 Edit/Delete 按钮但 backend DELETE 会静默失败 (WHERE user_id 保护). optimistic
  // 移除本地 state 造成"删了但重启回来"的诡异体验. v414 backend fix 后 user_id 已回,
  // 只需信 authorId === userId. 'local' 保留 (未同步本地 marker, id 未生成 remote id).
  const isOwner = marker.authorId === userId || marker.authorId === 'local';

  // Public snapshot divergence: only relevant if a snapshot exists AND
  // its content differs from the current marker fields (or the marker
  // is currently not public — in which case "others see nothing right
  // now, but here's what they'd see if you re-share").
  const snap = marker.publicSnapshot;
  const snapDiffers = !!snap && (
    snap.type !== marker.type ||
    snap.note !== marker.note
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* ── Map hero ──────────────────────────────────────────── */}
      <View style={[styles.mapWrap, { height: MAP_H }]}>
        {MapView ? (
          <MapView
            style={styles.map}
            styleURL={getPrimaryMapStyle()}
            compassEnabled={false}
            scaleBarEnabled={false}
            attributionEnabled={false}
            logoEnabled={false}
          >
            <CameraComponent
              defaultSettings={{
                centerCoordinate: [marker.lng, marker.lat],
                zoomLevel: 16.5,
              }}
            />
            {MarkerView ? (
              <MarkerView coordinate={[marker.lng, marker.lat]} anchor={{ x: 0.5, y: 0.5 }} allowOverlap>
                {/* v393: MarkerView instead of PointAnnotation — viewAnnotations
                    native UIView, no offscreen rasterise → crest (react-native-svg)
                    renders correctly. */}
                <View>
                  <CairnPin
                    tier={resolveTier(marker as any, new Set(markers.map(m => m.id)))}
                    type={marker.type}
                    size="detail"
                  />
                </View>
              </MarkerView>
            ) : PointAnnotation && (
              <PointAnnotation id="marker-pin" coordinate={[marker.lng, marker.lat]}>
                {/* v381: replaced v300 hollow pin with v10 reliquary
                    medallion (Self gold crown / Friend green star /
                    Public silver footprints + 5 type cores). Detail page
                    tier resolution: if marker is in own store → self,
                    permission=public → public, else friend.
                    v383: use size="detail" (smaller core 32 vs memory's 44)
                    instead of transform:scale(0.75) hack — user reported
                    detail pin was too big at 0.75 scale. */}
                <CairnPin
                  tier={resolveTier(marker as any, new Set(markers.map(m => m.id)))}
                  type={marker.type}
                  size="detail"
                />
              </PointAnnotation>
            )}
          </MapView>
        ) : (
          <View style={styles.mapFallback}>
            <Text style={styles.mapFallbackText}>
              {marker.lat.toFixed(5)}, {marker.lng.toFixed(5)}
            </Text>
          </View>
        )}
        <View style={styles.backRowOverlay} pointerEvents="box-none">
          <BackButton variant="pill" />
        </View>
      </View>

      {/* ── Detail panel ──────────────────────────────────────── */}
      <ScrollView
        style={styles.panel}
        contentContainerStyle={styles.panelContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Type + meta row */}
        <View style={styles.headerRow}>
          <View style={[styles.typeBadge, { backgroundColor: meta.bg, borderColor: meta.color }]}>
            <Icon name={meta.icon as IconName} size={14} color={meta.color} strokeWidth={2} />
            <Text style={[styles.typeBadgeText, { color: meta.color }]}>{meta.label}</Text>
          </View>
          {/* v422: 离线同步状态 badge. synced 状态不显示 (hideWhenSynced=true).
              pending → 用户看到 "Waiting to sync" 知道已保存本地待上传. */}
          {marker.syncState && marker.syncState !== 'synced' ? (
            <SyncBadge state={marker.syncState} />
          ) : null}
          <View style={[styles.visBadge, { borderColor: Colors.border }]}>
            <Icon name={vis.iconName} size={12} color={Colors.textSecondary} strokeWidth={2} />
            <Text style={styles.visBadgeText}>{vis.label}</Text>
          </View>
        </View>

        {isEditing ? (
          /* ─── EDIT MODE ───
             R114 (2026-08-07): entire inline form (typeRow + title +
             body + permRow + lockedField) replaced by a single MarkForm
             mount. Cancel/Save actions kept below — MarkForm is body
             only, screen owns the action row. */
          <View>
            <MarkForm
              type={editType}
              title={editTitle}
              note={editBody}
              visibility={editPermission}
              onTypeChange={setEditType}
              onTitleChange={setEditTitle}
              onNoteChange={setEditBody}
              onVisibilityChange={setEditPermission}
              mode="edit"
              disableVisibilityPublic={!VisibilityConfig.enablePublicOption}
              showLocationLockedNotice
              autoFocus={null}
              titleMaxChars={ContentConfig.titleMaxChars}
              noteMaxChars={ContentConfig.textMaxChars}
            />

            {/* Save / Cancel actions */}
            <View style={styles.actionRow}>
              <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGhost]} onPress={cancelEdit} disabled={saving}>
                <Text style={styles.actionBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.actionBtnPrimary, saving && { opacity: 0.6 }]} onPress={saveEdit} disabled={saving}>
                <Text style={styles.actionBtnPrimaryText}>{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* ─── VIEW MODE ─── */
          <View>
            {privateTitle ? (
              <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">{privateTitle}</Text>
            ) : (
              <Text style={styles.titleEmpty}>Untitled cairn</Text>
            )}

            {privateBody ? <Text style={styles.body}>{privateBody}</Text> : null}

            <View style={styles.metaList}>
              <MetaRow iconName="Calendar" text={dateStr} />
              <MetaRow iconName="MapPin" text={`${marker.lat.toFixed(5)}, ${marker.lng.toFixed(5)}`} />
            </View>

            {/* Public snapshot divergence banner (owner only) */}
            {snap && snapDiffers && isOwner && (
              <View style={styles.snapshotBanner}>
                <View style={styles.snapshotHeaderRow}>
                  <Icon name="Globe" size={12} color={Colors.textSecondary} strokeWidth={2} />
                  <Text style={styles.snapshotHeader}>Public viewers see</Text>
                </View>
                <Text style={styles.snapshotBody}>
                  {(() => {
                    const sm = MARKER_TYPES[snap.type];
                    const sn = splitTitleBody(snap.note);
                    return `"${sn.title || sn.body || 'Untitled'}", pinned as ${sm?.label ?? snap.type}.`;
                  })()}
                </Text>
                <Text style={styles.snapshotFootnote}>
                  Public content is frozen at the moment you first shared.
                </Text>
              </View>
            )}

            {/* Owner-only actions.
                v422: edit/delete 是"回家做"的动作 (D 类), 无网禁用 + 显示提示. */}
            {isOwner && (
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnGhost, !online && { opacity: 0.4 }]}
                  onPress={handleDelete}
                  disabled={!online}
                >
                  <Icon name="Trash2" size={14} color={Colors.danger} strokeWidth={2} />
                  <Text style={[styles.actionBtnGhostText, { color: Colors.danger }]}>
                    {online ? 'Delete' : 'Delete · Needs internet'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnPrimary, !online && { opacity: 0.4 }]}
                  onPress={enterEdit}
                  disabled={!online}
                >
                  <Icon name="Pencil" size={14} color="#fff" strokeWidth={2} />
                  <Text style={styles.actionBtnPrimaryText}>
                    {online ? 'Edit' : 'Edit · Needs internet'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function MetaRow({ iconName, text }: { iconName: IconName; text: string }) {
  return (
    <View style={styles.metaItem}>
      <Icon name={iconName} size={13} color={Colors.textSecondary} strokeWidth={2} />
      <Text style={styles.metaText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // R114 (2026-08-07): root bg migrated from MemoryColors.cream to
  // Colors.bg (design §12) — completes the sepia purge across the Mark
  // feature.
  root: { flex: 1, backgroundColor: Colors.bg },
  mapWrap: {
    width: '100%',
    backgroundColor: Colors.mapBg,
    overflow: 'hidden',
  },
  map: { flex: 1 },
  mapFallback: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
  },
  mapFallbackText: {
    fontFamily: 'Courier', fontSize: FontSize.caption, color: Colors.textPrimary,
  },
  backRowOverlay: {
    position: 'absolute',
    top: Spacing.md, left: Spacing.md,
    zIndex: 10,
  },
  backRowTop: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  // O1 batch 37: pinHead removed — 0 JSX references.
  panel: { flex: 1 },
  panelContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  typeBadgeText: { fontSize: FontSize.small, fontWeight: '600' },
  visBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: '#fff',
  },
  visBadgeText: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500' },
  // R114 (2026-08-07): retokenized title/body/actionBtnPrimary from
  // MemoryColors.sepia* → Colors.* per design §12.
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  titleEmpty: {
    fontSize: 22,
    fontWeight: '500',
    color: Colors.textMuted,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    color: Colors.textPrimary,
    lineHeight: 20,
    marginBottom: 18,
  },
  metaList: {
    gap: 8,
    marginBottom: 18,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaText: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
  },
  snapshotBanner: {
    backgroundColor: '#fff',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    marginBottom: 18,
  },
  snapshotHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  snapshotHeader: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  snapshotBody: {
    fontSize: 12,
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  snapshotFootnote: {
    fontSize: 10,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: Radius.md,
  },
  actionBtnPrimary: {
    // R114 (2026-08-07): sepia → primary green per design §12.
    backgroundColor: Colors.primary,
  },
  actionBtnPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  actionBtnGhost: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionBtnGhostText: { color: Colors.textPrimary, fontSize: 14, fontWeight: '500' },
  notFoundBox: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg,
  },
  notFoundTitle: {
    fontSize: 18, fontWeight: '500', color: Colors.textPrimary, marginBottom: 8,
  },
  notFoundSub: {
    fontSize: 13, color: Colors.textSecondary, textAlign: 'center',
  },
});
