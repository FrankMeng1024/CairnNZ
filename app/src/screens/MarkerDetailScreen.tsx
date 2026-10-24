/**
 * MarkerDetailScreen — v300
 *
 * Detail page for a single cairn / marker. UI styled to match the
 * project's other detail screens (MapHistoryScreen, RoutesScreen):
 * top map hero + scrollable content panel + top-left BackButton.
 *
 * One authoritative owned-Cairn surface reached by Plant/Quick Cairn,
 * Activity linkage, Memory pins, and the personal All Cairns library.
 *
 * Behavior (v300 reversal of v299's read-only stance):
 *   - Owner sees Edit + Delete actions
 *   - Edit changes supported words only; identity/place/provenance stay locked
 *   - Delete commits the existing tombstone contract before leaving Detail
 *   - publicSnapshot: once a marker has been public, what others
 *     see is frozen. If the owner has edited away from the snapshot,
 *     a small banner shows "Others see: [snapshot.note], pinned as
 *     [snapshot.type]" so the owner is reminded of the divergence.
 * Cairn visibility is an owner control independent from Memory sharing.
 */
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Dimensions, Platform, Alert,
  Animated, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useMarkerStore, type Marker, type MarkerPermission } from '../store/useMarkerStore';
import { useAppStore } from '../store/useAppStore';
import { useSessionStore } from '../store/useSessionStore';
import { MARKER_TYPES, type MarkerType } from '../config/markerTypes';
import { cairnDisplayTitle, splitTitleBody, encodeTitleBody } from '../features/plant/services/noteEncoding';
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
import { getPrimaryMapStyle, getMapStyleForTheme, themeToStandardPreset, buildStandardConfig } from '../config/mapbox';
import { MAP_ORNAMENTS_EDGE } from '../config/mapOrnaments';
import { formatDate } from '../utils/geo';
import { log } from '../services/appLog';
import { ContentConfig } from '../features/plant/config/plantConfig';
// v422 offline-first: 显示同步状态 badge (pending / syncing / synced / failed)
import { SyncBadge } from '../components/SyncBadge';
// Connectivity explains the synced-edit boundary; local pending edits remain durable.
import { useOnlineOnly } from '../hooks/useOnlineOnly';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { useMapTheme } from '../hooks/useMapTheme';
import { cairnMatchesIdentity } from '../features/cairns/cairnIdentity';
import { activityMatchesTarget } from '../features/activity/activityDetailPresentation';
import { ContentSurface } from '../components/ContentSurface';
import {
  BottomSheetContent,
  BottomSheetFrame,
  BottomSheetHeader,
} from '../components/BottomSheetFrame';
import { ModalCard, ModalCardHeader } from '../components/ModalCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { usePublicCairnStore } from '../features/public/services/publicCairns';
import { MapLoadOverlay, type MapLoadState } from '../components/MapLoadOverlay';
import { CairnIdentityLine } from '../features/cairns/CairnIdentityLine';
import { markersForVisibleWorkspace } from '../features/cairns/cairnWorkspace';
import { useSettingsStore } from '../store/useSettingsStore';
import { CairnDeleteDialog } from '../features/cairns/CairnDeleteDialog';
import {
  CairnPaper,
  CairnStoneMark,
  useCairnPaperExit,
} from '../features/cairns/components/CairnPaper';
import { cairnPublicationTruth } from '../features/cairns/cairnExperience';
import { cairnText } from '../i18n/runtime';

let MapView: any = null;
let CameraComponent: any = null;
let PointAnnotation: any = null;
let MarkerView: any = null;
let StyleImport: any = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Mapbox = require('@rnmapbox/maps');
    MapView = Mapbox.MapView;
    CameraComponent = Mapbox.Camera;
    PointAnnotation = Mapbox.PointAnnotation;
    MarkerView = Mapbox.MarkerView;
    StyleImport = Mapbox.StyleImport;
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
      StyleImport = m.StyleImport;
    }
  } catch {}
}

const { height: H } = Dimensions.get('window');
const MAP_H = Math.min(300, Math.max(220, Math.round(H * 0.32)));

type DetailRoute = RouteProp<RootStackParamList, 'MarkerDetail'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

const VISIBILITY_LABEL: Record<MarkerPermission, { label: string; iconName: IconName }> = {
  personal: { get label() { return cairnText('marker-detail-screen.only-me'); }, iconName: 'Lock' },
  group:    { get label() { return cairnText('marker-detail-screen.friends-can-discover'); }, iconName: 'Users' },
  public:   { get label() { return cairnText('marker-detail-screen.public'); },  iconName: 'Globe' },
};

export function MarkerDetailScreen() {
  const visualTheme = useVisualTheme();
  const markerMapTheme = useMapTheme();
  const markerResolvedMapStyle = getMapStyleForTheme('outdoors', markerMapTheme);
  const markerLightPreset = themeToStandardPreset(markerMapTheme);
  const nav = useNavigation<Nav>();
  const route = useRoute<DetailRoute>();
  const markerId = route.params?.markerId;
  const storedMarkers = useMarkerStore((s) => s.markers);
  const debugMode = useSettingsStore((s) => s.debugMode);
  const markers = useMemo(() => markersForVisibleWorkspace(storedMarkers, debugMode), [debugMode, storedMarkers]);
  const markerStoreOwnerId = useMarkerStore((s) => s.userId);
  const updateMarker = useMarkerStore((s) => s.updateMarker);
  const retryMarkerSync = useMarkerStore((s) => s.retryMarkerSync);
  const deleteMarker = useMarkerStore((s) => s.deleteMarker);
  const userId = useAppStore((s) => s.user?.id ?? '');
  const sessions = useSessionStore((s) => s.sessions);
  const publicEnabled = usePublicCairnStore((state) => state.enabled);

  const liveMarker = useMemo(
    // v423 C1 fix: offline-first ack 后 marker.id 会从 localId 换成 server id.
    // Plant flow nav.replace 传的 markerId 是 localId, 若只按 m.id 匹配, ack
    // 一成功 find 立刻返回 undefined, 屏幕空白. 用 (id | localId) 双匹配保证
    // 用户在同一屏看到 pending → syncing → synced 完整生命周期.
    () => String(markerStoreOwnerId ?? '') === String(userId)
      ? markers.find((candidate) => cairnMatchesIdentity(candidate, markerId))
      : undefined,
    [markerId, markerStoreOwnerId, markers, userId]
  );

  // Edit-mode local state. Initialized from marker only when entering edit.
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editType, setEditType] = useState<MarkerType>('cairn');
  const [editPermission, setEditPermission] = useState<MarkerPermission>('personal');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [discardEditOpen, setDiscardEditOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletionSnapshot, setDeletionSnapshot] = useState<{ ownerId: string; marker: Marker } | null>(null);
  const { style: paperExitStyle, run: runPaperExit, reset: resetPaperExit } = useCairnPaperExit();
  const [mapReady, setMapReady] = useState(false);
  const [mapLoadState, setMapLoadState] = useState<MapLoadState>('loading');
  const [mapEpoch, setMapEpoch] = useState(0);
  // Durable tombstoning removes the live projection before the network await.
  // Keep the exact initiating owner's record visible until deleteMarker tells
  // us whether the operation was accepted or queued; never show it to a new
  // account after an auth switch.
  const marker = liveMarker ?? (
    deleting && deletionSnapshot?.ownerId === String(userId) ? deletionSnapshot.marker : undefined
  );

  useEffect(() => {
    if (mapReady || !MapView) return undefined;
    const timeout = setTimeout(() => setMapLoadState('slow'), 8000);
    return () => clearTimeout(timeout);
  }, [mapEpoch, mapReady]);

  const { online } = useOnlineOnly();

  const enterEdit = useCallback(() => {
    if (!marker) return;
    const { title, body } = splitTitleBody(marker.note);
    setEditTitle(title);
    setEditBody(body);
    setEditType(marker.type);
    setEditPermission(marker.permission);
    setSaveError(null);
    setIsEditing(true);
    log('marker.edit_open', { id: marker.id });
  }, [marker]);

  const closeEdit = useCallback(() => {
    setSaveError(null);
    setIsEditing(false);
  }, []);

  const editDirty = Boolean(marker) && (
    encodeTitleBody(editTitle, editBody) !== marker?.note
    || editPermission !== marker?.permission
  );

  const requestCloseEdit = useCallback(() => {
    if (saving) return;
    if (!editDirty) {
      closeEdit();
      return;
    }
    setDiscardEditOpen(true);
  }, [closeEdit, editDirty, saving]);

  const saveEdit = useCallback(async () => {
    if (!marker) return;
    setSaveError(null);
    setSaving(true);
    try {
      const newNote = encodeTitleBody(editTitle, editBody);
      await updateMarker(marker.id, {
        note: newNote,
        permission: editPermission,
      });
      log('marker.edit_save', { id: marker.id });
      setIsEditing(false);
    } catch (e: any) {
      const reason = e?.code === 'PUBLIC_SUSPENDED_EDIT_BLOCKED'
        ? cairnText('marker-detail-screen.this-public-version-is-paused-by-review')
        : e?.code === 'CAIRN_SOURCE_FROZEN'
          ? cairnText('marker-detail-screen.this-cairn-is-under-review-and-cannot')
          : cairnText('marker-detail-screen.changes-were-not-saved-your-draft-is');
      setSaveError(reason);
    } finally {
      setSaving(false);
    }
  }, [marker, editTitle, editBody, editPermission, updateMarker]);

  const handleDelete = useCallback(async () => {
    if (!marker || deleting) return;
    const initiatingOwnerId = String(userId);
    setDeletionSnapshot({ ownerId: initiatingOwnerId, marker });
    setDeleting(true);
    let accepted = false;
    try {
      log('marker.delete', { id: marker.id });
      const result = await deleteMarker(marker.id);
      accepted = true;
      setDeleteConfirmOpen(false);
      runPaperExit(() => {
        if (nav.canGoBack()) nav.goBack();
        else nav.replace('AllCairns');
        if (result.remoteState === 'queued') {
          Alert.alert(
            cairnText('marker-detail-screen.delete-queued'),
            cairnText('marker-detail-screen.this-cairn-is-removed-from-this-iphone'),
          );
        }
      });
    } catch {
      resetPaperExit();
      setDeletionSnapshot(null);
      Alert.alert(cairnText('marker-detail-screen.could-not-delete'), cairnText('marker-detail-screen.this-cairn-is-still-here-check-your'));
    } finally {
      // A successful durable delete is terminal for this screen. Keeping the
      // busy snapshot through the navigation transition prevents a one-frame
      // "Cairn not found" ghost after the store projection is removed.
      if (!accepted) setDeleting(false);
    }
  }, [deleteMarker, deleting, marker, nav, resetPaperExit, runPaperExit, userId]);

  if (!marker) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: visualTheme.background }]} edges={['top', 'bottom']}>
        <View style={styles.backRowTop}>
          <BackButton variant="inline" />
        </View>
        <View style={styles.notFoundBox}>
          <Text style={[styles.notFoundTitle, { color: visualTheme.foreground }]}>{cairnText('marker-detail-screen.cairn-not-found')}</Text>
          <Text style={[styles.notFoundSub, { color: visualTheme.foregroundSecondary }]}>{cairnText('marker-detail-screen.this-cairn-may-have-been-removed-or')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const meta = MARKER_TYPES[marker.type] ?? MARKER_TYPES.cairn;
  const { title: privateTitle, body: privateBody } = splitTitleBody(marker.note);
  const displayTitle = cairnDisplayTitle(privateTitle, privateBody, marker.createdAt);
  const publicationTruth = cairnPublicationTruth(marker);
  const publicStateLabel = publicationTruth?.label ?? null;
  const vis = marker.permission === 'public'
    ? { label: publicStateLabel ?? cairnText('marker-detail-screen.public'), iconName: 'Globe' as IconName }
    : VISIBILITY_LABEL[marker.permission] ?? VISIBILITY_LABEL.personal;
  const localOnlyCairn = !marker.synced && Boolean(marker.clientCairnId ?? marker.localId);
  const dateStr = formatDate(marker.createdAt);
  const updatedDateStr = marker.updatedAt && marker.updatedAt > marker.createdAt
    ? formatDate(marker.updatedAt)
    : null;
  // v416 fix (Bug D): 移除 authorId === 'server' 视为 owner. 后端 GET /api/markers
  // 之前未返回 user_id, fromBackend fallback 'server' 使**任何** marker 都被视为 owner,
  // 显示 Edit/Delete 按钮但 backend DELETE 会静默失败 (WHERE user_id 保护). optimistic
  // 移除本地 state 造成"删了但重启回来"的诡异体验. v414 backend fix 后 user_id 已回,
  // 只需信 authorId === userId. 'local' 保留 (未同步本地 marker, id 未生成 remote id).
  const isOwner = String(markerStoreOwnerId ?? '') === String(userId);
  const sourceActivity = marker.originActivityClientId
    ? sessions.find(session => activityMatchesTarget(session, marker.originActivityClientId!))
    : null;
  const editHasUsefulText = editTitle.trim().length > 0 || editBody.trim().length > 0;
  const editChangesWords = encodeTitleBody(editTitle, editBody) !== marker.note;
  const publicEditBlock = editPermission !== 'public'
    ? null
    : !publicEnabled
      ? cairnText('marker-detail-screen.public-is-not-available-for-this-account')
      : !marker.originActivityClientId
        ? cairnText('marker-detail-screen.this-cairn-has-no-activity-source-so')
        : !editHasUsefulText
          ? cairnText('marker-detail-screen.add-useful-words-before-saving-a-public')
          : marker.publicState === 'suspended' && editChangesWords
            ? cairnText('marker-detail-screen.this-public-version-is-paused-by-review')
            : null;
  const publicEditTruth = sourceActivity
    ? cairnText('marker-detail-screen.saving-creates-a-new-version-it-can')
    : marker.originActivityClientId
      ? cairnText('marker-detail-screen.saving-keeps-public-intent-but-the-linked')
      : cairnText('marker-detail-screen.this-cairn-cannot-become-public-because-it');

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: visualTheme.background }]} edges={['top', 'bottom']}>
      {/* ── Map hero ──────────────────────────────────────────── */}
      <View style={[styles.mapWrap, { height: MAP_H }]}>
        {MapView ? (
          <MapView
            key={`cairn-detail-map-${mapEpoch}`}
            style={styles.map}
            {...(markerResolvedMapStyle.kind === 'url'
              ? { styleURL: markerResolvedMapStyle.url }
              : { styleJSON: markerResolvedMapStyle.json })}
            compassEnabled={false}
            scaleBarEnabled={false}
            attributionEnabled
            logoEnabled
            logoPosition={MAP_ORNAMENTS_EDGE.logoPosition}
            attributionPosition={MAP_ORNAMENTS_EDGE.attributionPosition}
            onDidFinishLoadingMap={() => { setMapReady(true); setMapLoadState('loading'); }}
            onDidFinishRenderingMapFully={() => { setMapReady(true); setMapLoadState('loading'); }}
            onMapLoadingError={() => setMapLoadState('error')}
          >
            {/* R21-v3 v2 (2026-08-30): Standard style lightPreset. */}
            {StyleImport ? (
              <StyleImport
                key={markerLightPreset}
                id="basemap"
                existing
                config={buildStandardConfig(markerMapTheme) as any}
              />
            ) : null}
            <CameraComponent
              defaultSettings={{
                centerCoordinate: [marker.lng, marker.lat],
                // R114/O24 (2026-08-12): zoom 16.5 → 15 so the user sees
                // more surrounding streets / place names for context.
                // Previous zoom was too tight — cairn floated in a blank
                // green area with no landmarks.
                zoomLevel: 15,
                pitch: 0,
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
            <Icon name="Map" size={24} color={visualTheme.iconInactive} strokeWidth={1.8} />
            <Text style={[styles.mapFallbackTitle, { color: visualTheme.foreground }]}>{cairnText('marker-detail-screen.map-unavailable')}</Text>
            <Text style={[styles.mapFallbackText, { color: visualTheme.foregroundSecondary }]}>{cairnText('marker-detail-screen.your-cairn-is-still-available')}</Text>
          </View>
        )}
        {MapView && !mapReady ? (
          <MapLoadOverlay
            state={mapLoadState}
            onRetry={() => {
              setMapReady(false);
              setMapLoadState('loading');
              setMapEpoch((epoch) => epoch + 1);
            }}
            testID="cairn-detail-map-load-overlay"
          />
        ) : null}
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
        <Animated.View style={paperExitStyle}>
        <CairnPaper
          motionKey={`owned-cairn-paper:${marker.contentRevision ?? 1}:${marker.note}`}
          style={styles.notePaper}
          testID="owned-cairn-paper"
        >
          <View style={styles.notePaperHeader}>
            <CairnStoneMark size={36} tone={marker.permission === 'group' ? 'friends' : marker.permission === 'public' ? 'public' : 'owner'} />
            <Text style={[styles.notePaperEyebrow, { color: visualTheme.foregroundSecondary }]}>{cairnText('marker-detail-screen.your-cairn-left-here')}</Text>
          </View>
          <Text
            style={[styles.title, !privateTitle && !privateBody && styles.titleEmpty, { color: privateTitle || privateBody ? visualTheme.foreground : visualTheme.muted }]}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {displayTitle}
          </Text>
          {privateBody ? <Text style={[styles.body, { color: visualTheme.foregroundSecondary }]}>{privateBody}</Text> : null}
          <CairnIdentityLine
            isOwner={isOwner}
            permission={marker.permission}
            authorName={marker.authorName}
            qa={marker.qaProvenance === 'simulator_test'}
          />
        </CairnPaper>
        </Animated.View>

        {isOwner && Number(marker.thanksCount ?? 0) > 0 ? (
          <View
            style={[styles.thanksAcknowledgement, { backgroundColor: visualTheme.surface, borderColor: visualTheme.border }]}
            testID="cairn-owner-thanks-acknowledgement"
          >
            <Icon name="Heart" size={14} color={visualTheme.primary} strokeWidth={2} />
            <Text style={[styles.thanksAcknowledgementText, { color: visualTheme.foregroundSecondary }]}>
              {Number(marker.thanksCount) === 1 ? cairnText('marker-detail-screen.1-thanks-received') : cairnText('marker-detail-screen.value-thanks-received', { value1: Number(marker.thanksCount) })}
            </Text>
          </View>
        ) : null}

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
            <SyncBadge
              state={marker.syncState}
              onPress={marker.syncState === 'failed'
                ? () => { void retryMarkerSync(marker.id).catch(() => {
                    Alert.alert(cairnText('marker-detail-screen.still-saved-locally'), cairnText('marker-detail-screen.cairn-will-remain-on-this-device-try'));
                  }); }
                : undefined}
            />
          ) : null}
        </View>

        {/* 4. Divider */}
        <View style={[styles.metaDivider, { backgroundColor: visualTheme.border }]} />

        {/* 5. Date / location — with clear labels */}
        <View style={styles.metaList}>
          <MetaRow iconName="Calendar" label={cairnText('marker-detail-screen.planted')} text={dateStr} />
          {updatedDateStr ? <MetaRow iconName="Pencil" label={cairnText('marker-detail-screen.updated')} text={updatedDateStr} /> : null}
          {marker.approximate ? (
            <MetaRow iconName="MapPin" label={cairnText('marker-detail-screen.accuracy')} text={cairnText('marker-detail-screen.approximate-gps-location')} />
          ) : null}
        </View>

        {sourceActivity ? (
          <ContentSurface
            level="record"
            onPress={() => nav.navigate('MapHistory', {
              sessionId: sourceActivity.id,
              activityBackContext: 'previous',
            })}
            style={styles.activityContext}
            testID="cairn-source-activity"
          >
            <View style={styles.activityContextRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.activityContextLabel, { color: visualTheme.foregroundSecondary }]}>{cairnText('marker-detail-screen.from-activity')}</Text>
                <Text style={[styles.activityContextTitle, { color: visualTheme.foreground }]} numberOfLines={1}>
                  {sourceActivity.name || (sourceActivity.activityMode === 'running' ? cairnText('marker-detail-screen.run') : cairnText('marker-detail-screen.hike'))}
                </Text>
              </View>
              <Icon name="ChevronRight" size={16} color={visualTheme.iconInactive} strokeWidth={2} />
            </View>
          </ContentSurface>
        ) : marker.originActivityClientId ? (
          <ContentSurface level="record" style={styles.activityContext} testID="cairn-source-activity-unavailable">
            <View style={styles.activityContextRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.activityContextLabel, { color: visualTheme.foregroundSecondary }]}>{cairnText('marker-detail-screen.source')}</Text>
                <Text style={[styles.activityContextTitle, { color: visualTheme.foreground }]}>{cairnText('marker-detail-screen.activity-link-unavailable')}</Text>
              </View>
              <Icon name="Route" size={16} color={visualTheme.iconInactive} strokeWidth={2} />
            </View>
          </ContentSurface>
        ) : (
          <ContentSurface level="record" style={styles.activityContext} testID="cairn-left-here-context">
            <View style={styles.activityContextRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.activityContextLabel, { color: visualTheme.foregroundSecondary }]}>{cairnText('marker-detail-screen.location-record')}</Text>
                <Text style={[styles.activityContextTitle, { color: visualTheme.foreground }]}>{cairnText('marker-detail-screen.left-here-value', { dateStr: dateStr })}</Text>
              </View>
              <Icon name="MapPin" size={16} color={visualTheme.iconInactive} strokeWidth={2} />
            </View>
          </ContentSurface>
        )}

        {marker.permission === 'public' && isOwner ? (
          <View style={[styles.snapshotBanner, { backgroundColor: visualTheme.surface, borderColor: visualTheme.border }]}>
            <View style={styles.snapshotHeaderRow}>
              <Icon name="Globe" size={12} color={visualTheme.iconInactive} strokeWidth={2} />
              <Text style={[styles.snapshotHeader, { color: visualTheme.foregroundSecondary }]}>{publicStateLabel}</Text>
            </View>
            <Text style={[styles.snapshotBody, { color: visualTheme.foreground }]}>
              {publicationTruth?.explanation ?? cairnText('marker-detail-screen.public-status-is-not-available-yet')}
            </Text>
            <Text style={[styles.snapshotFootnote, { color: visualTheme.muted }]}>{cairnText('marker-detail-screen.a-material-edit-or-changing-audience-removes')}</Text>
          </View>
        ) : null}
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
            testID="cairn-delete-open"
            style={[styles.deleteIconBtn, { backgroundColor: visualTheme.surface, borderColor: visualTheme.border }, deleting && { opacity: 0.4 }]}
            onPress={() => setDeleteConfirmOpen(true)}
            disabled={deleting}
            accessibilityRole="button"
            accessibilityLabel={cairnText('marker-detail-screen.delete-cairn')}
          >
            <Icon name="Trash2" size={18} color={visualTheme.iconInactive} strokeWidth={2} />
          </TouchableOpacity>
          <TouchableOpacity
            testID="cairn-edit-open"
            style={[styles.actionBtn, styles.actionBtnPrimary, { backgroundColor: visualTheme.primary }, styles.editPrimaryBtn]}
            onPress={enterEdit}
          >
            <Icon name="Pencil" size={14} color={visualTheme.onPrimary} strokeWidth={2} />
            <Text style={[styles.actionBtnPrimaryText, { color: visualTheme.onPrimary }]}>
              {privateTitle || privateBody ? cairnText('marker-detail-screen.edit-cairn') : cairnText('marker-detail-screen.add-a-note')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <BottomSheetFrame
        visible={isEditing}
        onDismiss={requestCloseEdit}
        dismissible={!saving}
        testID="cairn-edit-sheet"
      >
        <BottomSheetHeader
          title={privateTitle || privateBody ? cairnText('marker-detail-screen.edit-cairn') : cairnText('marker-detail-screen.add-words-to-this-cairn')}
          subtitle={cairnText('marker-detail-screen.its-original-place-time-and-activity-stay')}
          onClose={requestCloseEdit}
        />
        <BottomSheetContent
          scrollable
          contentContainerStyle={styles.editBody}
          testID="cairn-edit-content"
        >
          <Text style={[styles.editVersionTruth, { color: visualTheme.foregroundSecondary }]}>
            {editPermission === 'personal'
              ? cairnText('marker-detail-screen.saving-changes-updates-your-private-cairn-its')
              : editPermission === 'group'
                ? cairnText('marker-detail-screen.saving-creates-a-new-friends-version-friends')
                : publicEditTruth}
          </Text>
          {publicEditBlock ? (
            <Text
              testID="cairn-edit-public-block"
              accessibilityLiveRegion="polite"
              style={[styles.editBoundaryCopy, { color: visualTheme.destructive }]}
            >
              {publicEditBlock}
            </Text>
          ) : null}
          {saveError ? (
            <ContentSurface level="record" style={styles.editError} testID="cairn-edit-error">
              <Text
                accessibilityLiveRegion="assertive"
                style={[styles.editErrorText, { color: visualTheme.destructive }]}
              >
                {saveError}
              </Text>
            </ContentSurface>
          ) : null}
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
            showTypePicker={false}
            showVisibilityPicker
            disableVisibilityPublic={(!publicEnabled || !marker.originActivityClientId) && marker.permission !== 'public'}
            showLocationLockedNotice
            autoFocus={null}
            titleMaxChars={ContentConfig.titleMaxChars}
            noteMaxChars={ContentConfig.textMaxChars}
          />
          {!online && !localOnlyCairn ? (
            <Text style={[styles.editBoundaryCopy, { color: visualTheme.foregroundSecondary }]}>{cairnText('marker-detail-screen.this-synced-cairn-needs-a-connection-to')}</Text>
          ) : null}
        </BottomSheetContent>
        <View style={[styles.editFooter, { backgroundColor: visualTheme.sheetSurface, borderTopColor: visualTheme.borderSubtle }]}>
          <PrimaryButton
            label={editPermission === 'public' ? cairnText('marker-detail-screen.save-public-version') : editPermission === 'personal' ? cairnText('marker-detail-screen.save-changes') : cairnText('marker-detail-screen.save-friends-version')}
            onPress={() => { void saveEdit(); }}
            loading={saving}
            disabled={!editDirty || Boolean(publicEditBlock)}
            testID="cairn-edit-save"
          />
        </View>
      </BottomSheetFrame>

      <ModalCard
        visible={discardEditOpen}
        onDismiss={() => setDiscardEditOpen(false)}
        testID="cairn-discard-edit-confirmation"
      >
        <ModalCardHeader title={cairnText('marker-detail-screen.discard-changes')} body={cairnText('marker-detail-screen.your-unsaved-cairn-draft-will-be-removed')} />
        <View style={styles.deleteActions}>
          <PrimaryButton label={cairnText('marker-detail-screen.keep-editing')} variant="secondary" onPress={() => setDiscardEditOpen(false)} style={styles.deleteAction} />
          <PrimaryButton
            label={cairnText('marker-detail-screen.discard-changes-01ee2b4')}
            variant="destructive"
            onPress={() => { setDiscardEditOpen(false); closeEdit(); }}
            style={styles.deleteAction}
            testID="cairn-discard-edit-confirm"
          />
        </View>
      </ModalCard>

      <CairnDeleteDialog
        visible={deleteConfirmOpen}
        busy={deleting}
        onDismiss={() => setDeleteConfirmOpen(false)}
        onConfirm={() => { void handleDelete(); }}
      />
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
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    paddingHorizontal: Spacing.xl,
  },
  mapFallbackTitle: {
    fontSize: FontSize.body,
    fontWeight: '700',
  },
  mapFallbackText: {
    fontSize: FontSize.caption, color: Colors.textPrimary, textAlign: 'center',
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
  notePaper: { marginBottom: Spacing.md },
  notePaperHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
    paddingRight: 22,
  },
  notePaperEyebrow: { flex: 1, fontSize: 10, lineHeight: 14, fontWeight: '700', letterSpacing: 1 },
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
  editVersionTruth: { fontSize: FontSize.caption, lineHeight: 18, marginBottom: Spacing.sm },
  thanksAcknowledgement: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  thanksAcknowledgementText: {
    fontSize: FontSize.small,
    fontWeight: '500',
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
  activityContext: { marginBottom: Spacing.lg },
  activityContextRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  activityContextLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.7 },
  activityContextTitle: { fontSize: FontSize.caption, fontWeight: '700', marginTop: 3 },
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
  editBoundaryCopy: {
    fontSize: FontSize.small,
    lineHeight: 18,
    marginTop: Spacing.md,
  },
  editError: { marginTop: Spacing.md },
  editErrorText: { fontSize: FontSize.small, lineHeight: 18, fontWeight: '600' },
  editFooter: {
    paddingHorizontal: Spacing.lg,
    paddingTop: 12,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  deleteActions: { gap: Spacing.sm },
  deleteAction: { minHeight: 50 },
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
