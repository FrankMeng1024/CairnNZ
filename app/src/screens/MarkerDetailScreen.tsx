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
  TouchableOpacity, Modal, KeyboardAvoidingView, Pressable,
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
import { useVisualTheme } from '../hooks/useVisualTheme';

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
  const visualTheme = useVisualTheme();
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
      Alert.alert('Could not save', e?.message ?? 'Please try again in a moment.', [{ text: 'OK' }]);
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
      <SafeAreaView style={[styles.root, { backgroundColor: visualTheme.background }]} edges={['top', 'bottom']}>
        <View style={styles.backRowTop}>
          <BackButton variant="inline" />
        </View>
        <View style={styles.notFoundBox}>
          <Text style={[styles.notFoundTitle, { color: visualTheme.foreground }]}>Cairn not found</Text>
          <Text style={[styles.notFoundSub, { color: visualTheme.foregroundSecondary }]}>
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
    <SafeAreaView style={[styles.root, { backgroundColor: visualTheme.background }]} edges={['top', 'bottom']}>
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
                // R114/O24 (2026-08-12): zoom 16.5 → 15 so the user sees
                // more surrounding streets / place names for context.
                // Previous zoom was too tight — cairn floated in a blank
                // green area with no landmarks.
                zoomLevel: 15,
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
          <View style={[styles.mapFallback, { backgroundColor: visualTheme.background }]}>
            <Text style={[styles.mapFallbackText, { color: visualTheme.foregroundSecondary }]}>
              {marker.lat.toFixed(5)}, {marker.lng.toFixed(5)}
            </Text>
          </View>
        )}
        <View style={styles.backRowOverlay} pointerEvents="box-none">
          <BackButton variant="inline" />
        </View>
      </View>

      {/* ── Detail panel ──────────────────────────────────────── */}
      {/* R114/O24 (2026-08-12): rebuilt information hierarchy per user
          feedback ("Danger Retry Just me test 123 lat/lng 都不知道是什么").
          New order (top → bottom):
            1. Title (large, primary weight) — anchors the page
            2. Note body (secondary, comfortable line-height)
            3. Meta pills row (type + visibility + sync) — small, tinted,
               reads as "attributes" not primary content
            4. Divider — separates content from metadata
            5. Date / location — quiet grey meta rows
            6. Public snapshot banner (owner only, only if diverges)
            7. Sticky bottom Edit / Delete row (owner only) — outside
               ScrollView so keyboard doesn't hide it in edit modal.
          Edit is now a Modal (see below) rather than inline replacement —
          user reported the inline edit form got hidden by the keyboard. */}
      <ScrollView
        style={[styles.panel, { backgroundColor: visualTheme.surfaceElevated }]}
        contentContainerStyle={styles.panelContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* 1. Title */}
        {privateTitle ? (
          <Text style={[styles.title, { color: visualTheme.foreground }]} numberOfLines={2} ellipsizeMode="tail">{privateTitle}</Text>
        ) : (
          <Text style={[styles.titleEmpty, { color: visualTheme.muted }]}>Untitled cairn</Text>
        )}

        {/* 2. Body */}
        {privateBody ? <Text style={[styles.body, { color: visualTheme.foregroundSecondary }]}>{privateBody}</Text> : null}

        {/* 3. Meta pills row: type, visibility, sync state */}
        <View style={styles.headerRow}>
          <View style={[styles.typeBadge, { backgroundColor: meta.bg, borderColor: meta.color }]}>
            <Icon name={meta.icon as IconName} size={14} color={meta.color} strokeWidth={2} />
            <Text style={[styles.typeBadgeText, { color: meta.color }]}>{meta.label}</Text>
          </View>
          <View style={[styles.visBadge, { borderColor: visualTheme.border, backgroundColor: visualTheme.surface }]}>
            <Icon name={vis.iconName} size={12} color={visualTheme.iconInactive} strokeWidth={2} />
            <Text style={[styles.visBadgeText, { color: visualTheme.foregroundSecondary }]}>{vis.label}</Text>
          </View>
          {marker.syncState && marker.syncState !== 'synced' ? (
            <SyncBadge state={marker.syncState} />
          ) : null}
        </View>

        {/* 4. Divider */}
        <View style={[styles.metaDivider, { backgroundColor: visualTheme.border }]} />

        {/* 5. Date / location — with clear labels */}
        <View style={styles.metaList}>
          <MetaRow iconName="Calendar" label="Planted" text={dateStr} />
          <MetaRow
            iconName="MapPin"
            label="Location"
            text={`${marker.lat.toFixed(5)}, ${marker.lng.toFixed(5)}`}
          />
        </View>

        {/* 6. Public snapshot divergence banner (owner only) */}
        {snap && snapDiffers && isOwner && (
          <View style={[styles.snapshotBanner, { backgroundColor: visualTheme.surface, borderColor: visualTheme.border }]}>
            <View style={styles.snapshotHeaderRow}>
              <Icon name="Globe" size={12} color={visualTheme.iconInactive} strokeWidth={2} />
              <Text style={[styles.snapshotHeader, { color: visualTheme.foregroundSecondary }]}>Public viewers see</Text>
            </View>
            <Text style={[styles.snapshotBody, { color: visualTheme.foreground }]}>
              {(() => {
                const sm = MARKER_TYPES[snap.type];
                const sn = splitTitleBody(snap.note);
                return `"${sn.title || sn.body || 'Untitled'}", pinned as ${sm?.label ?? snap.type}.`;
              })()}
            </Text>
            <Text style={[styles.snapshotFootnote, { color: visualTheme.muted }]}>
              Public content is frozen at the moment you first shared.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* 7. Sticky bottom action row (owner only). Outside ScrollView so
          Edit modal keyboard never covers it.
          4-eyes review: Delete + Edit were both flex:1 with equal visual
          weight — dangerous action co-equal with primary action = misfire
          risk. Fix: Delete becomes icon-only ghost, small (fixed 48pt
          square), Edit becomes the wide primary. */}
      {isOwner && (
        <View style={[styles.stickyActionRow, { backgroundColor: visualTheme.surfaceElevated, borderTopColor: visualTheme.border }]}>
          <TouchableOpacity
            style={[styles.deleteIconBtn, { backgroundColor: visualTheme.surface, borderColor: visualTheme.border }, !online && { opacity: 0.4 }]}
            onPress={handleDelete}
            disabled={!online}
            accessibilityRole="button"
            accessibilityLabel={online ? 'Delete cairn' : 'Delete cairn (needs internet)'}
          >
            <Icon name="Trash2" size={18} color={visualTheme.destructive} strokeWidth={2} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnPrimary, { backgroundColor: visualTheme.primary }, styles.editPrimaryBtn, !online && { opacity: 0.4 }]}
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

      {/* ── Edit Modal ────────────────────────────────────────────
          R114/O24 (2026-08-12): edit UI moved from inline replacement
          to a bottom-sheet Modal. User reported keyboard hid the Save
          button and dismissing keyboard was annoying. Modal has its
          own SafeAreaView + KeyboardAvoidingView + full-height card
          so the Save button always sits above the keyboard. */}
      <Modal
        visible={isEditing}
        transparent
        animationType="slide"
        onRequestClose={() => (saving ? null : cancelEdit())}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.editBackdrop, { backgroundColor: visualTheme.readabilityScrim }]}>
            <View style={[styles.editSheet, { backgroundColor: visualTheme.surfaceElevated }]}>
              {/* Sheet header — grabber + title + close */}
              <View style={[styles.editHeader, { borderBottomColor: visualTheme.border }]}>
                <View style={[styles.editGrabber, { backgroundColor: visualTheme.border }]} />
                <View style={styles.editHeaderRow}>
                  <Text style={[styles.editHeaderTitle, { color: visualTheme.foreground }]}>Edit cairn</Text>
                  <TouchableOpacity
                    onPress={cancelEdit}
                    disabled={saving}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    accessibilityLabel="Close edit"
                  >
                    <Icon name="X" size={22} color={visualTheme.iconInactive} strokeWidth={2} />
                  </TouchableOpacity>
                </View>
              </View>

              <ScrollView
                contentContainerStyle={styles.editBody}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
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
              </ScrollView>

              {/* Save button — sits above the keyboard, always visible */}
              <View style={[styles.editFooter, { backgroundColor: visualTheme.surfaceElevated, borderTopColor: visualTheme.border }]}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnPrimary, { backgroundColor: visualTheme.primary }, saving && { opacity: 0.6 }]}
                  onPress={saveEdit}
                  disabled={saving}
                >
                  <Text style={styles.actionBtnPrimaryText}>{saving ? 'Saving…' : 'Save changes'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function MetaRow({ iconName, label, text }: { iconName: IconName; label: string; text: string }) {
  const theme = useVisualTheme();
  return (
    <View style={styles.metaItem}>
      <Icon name={iconName} size={13} color={theme.iconInactive} strokeWidth={2} />
      <Text style={[styles.metaLabel, { color: theme.foregroundSecondary }]}>{label}</Text>
      <Text style={[styles.metaText, { color: theme.foreground }]}>{text}</Text>
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
    gap: 10,
    marginBottom: 18,
  },
  metaDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginTop: 4,
    marginBottom: 16,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // R114/O24 (2026-08-12): meta rows now have a small quiet label so the
  // user knows what the value means (was: bare "2025-08-01 · 40.71,-74.01").
  metaLabel: {
    fontSize: FontSize.small,
    color: Colors.textMuted,
    fontWeight: '500',
    minWidth: 62,
  },
  metaText: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
    flex: 1,
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
  // R114/O24 (2026-08-12): sticky bottom action row — sits outside the
  // ScrollView so Edit/Delete are always reachable without scrolling.
  stickyActionRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: Spacing.lg,
    paddingTop: 12,
    paddingBottom: Spacing.md,
    backgroundColor: Colors.bg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  // R114/O24 (2026-08-12): edit modal — bottom sheet card with rounded
  // top corners. Sits above the keyboard via KeyboardAvoidingView.
  editBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  editSheet: {
    backgroundColor: Colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    // R114/O24 4-eyes: removed minHeight so sheet grows with content
    // (iOS medium-detent style). maxHeight caps at 88% so backdrop stays
    // visible above the sheet, preserving "this is a sheet, map is still
    // there" mental model rather than "this took over the screen".
    maxHeight: '88%',
  },
  editHeader: {
    paddingTop: 10,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom: 12,
  },
  editGrabber: {
    alignSelf: 'center',
    width: 40, height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    marginBottom: 12,
  },
  editHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editHeaderTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  editBody: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  editFooter: {
    paddingHorizontal: Spacing.lg,
    paddingTop: 12,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.bg,
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
  // R114/O24 4-eyes: Delete demoted to a small square icon-only ghost so
  // it's clearly a secondary/destructive action, not co-equal with Edit.
  // Reduces misfire risk while keeping delete reachable in one tap.
  deleteIconBtn: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editPrimaryBtn: {
    flex: 1,
  },
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
