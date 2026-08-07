/**
 * MapScreen — Sprint 42: Real Mapbox + Glass Panel
 *
 * Phase 1: Real Mapbox rendering replaces SVG placeholder.
 * - STORY-00137: Real Mapbox MapView with NZ outdoor tiles
 * - STORY-00138: Markers rendered at real GPS coordinates
 * - Visual quality: GlassPanel bottom panel, elevation shadows
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Dimensions,
  TextInput, Animated, Easing, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { haptic } from '../services/hapticService';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
// O12 Round-3: useAppStore import removed — MapScreen no longer reads any
// AppState field after the mock activity/tracking system was deleted.
import { useMarkerStore, type Marker, type MarkerPermission } from '../store/useMarkerStore';
import { useFriendStore } from '../store/useFriendStore';
import { useTrackingStore } from '../store/useTrackingStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useDistance } from '../utils/distanceFormat';
import { haversineM } from '../utils/geo';
import { Colors, Spacing, Radius, FontSize, Shadow, IconSize } from '../components/tokens';
import { PressBtn } from '../components/PressBtn';
import { Icon } from '../components/Icon';
import { getMarkerTierVisuals } from '../features/marks/utils/markTier';
import { MarkDetailSheet } from '../features/marks/components/MarkDetailSheet';
import { useMarkLikeStore } from '../features/marks/store/useMarkLikeStore';
import { useMemoryStore } from '../features/memory/store/useMemoryStore';
import { useMemorySubscriptionsStore } from '../features/memory/store/useMemorySubscriptionsStore';
import type { IconName } from '../components/Icon';
import { Elevation } from '../components/GlassPanel';
import { MapBottomPanel, type PanelMarkerItem } from '../components/MapBottomPanel';
import { OfflineMapSheet } from '../components/OfflineMapSheet';
import { MARKER_META, MarkerType } from '../data/mockData';
import { FLAG_TYPES } from '../data/flagTypes';
import { getCurrentRegion } from '../config/regions';
import { getMapStyleForLayer, getPrimaryMapStyle } from '../config/mapbox';
import { likeMarker, reportMarker, MarkerInteractionError } from '../services/markerInteractionService';

// Mapbox — conditional import (native only; web uses fallback)
let MapboxGL: any = null;
let MapView: any = null;
let Camera: any = null;
let PointAnnotation: any = null;
let UserLocation: any = null;
if (Platform.OS !== 'web') {
  try {
    const Mapbox = require('@rnmapbox/maps');
    MapboxGL = Mapbox.default || Mapbox;
    MapView = Mapbox.MapView;
    Camera = Mapbox.Camera;
    PointAnnotation = Mapbox.PointAnnotation;
    UserLocation = Mapbox.UserLocation;
  } catch {
    // Mapbox native not available
  }
}

const { width: W, height: H } = Dimensions.get('window');

// ── Pressable map marker with scale feedback ─────────────────────────────────
function PressableMarker({ x, y, borderColor, bg, iconColor, iconName, onPress }: {
  x: number; y: number; borderColor: string; bg: string;
  iconColor: string; iconName: IconName; onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={[styles.mapMarker, { left: x, top: y, borderColor, backgroundColor: bg, transform: [{ scale }] }]}>
      <TouchableOpacity
        activeOpacity={1}
        onPress={onPress}
        onPressIn={() => Animated.spring(scale, { toValue: 0.88, useNativeDriver: true, tension: 300, friction: 10 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 8 }).start()}
        style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name={iconName} size={14} color={iconColor} strokeWidth={2.5} />
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Map Component (Real Mapbox or Fallback) ─────────────────────────────────
function RealMap({
  markers, onMarkerPress, viewerId, friendIds,
}: {
  markers: Marker[];
  onMarkerPress: (m: Marker) => void;
  /** Sprint 68 STORY-00531: viewer perspective for tier-aware visual treatment. */
  viewerId: string | null;
  friendIds: ReadonlyArray<string | number>;
}) {
  const region = getCurrentRegion();
  // O18 MAP-01: react to user's saved map layer preference.
  const mapLayer = useSettingsStore((s) => s.mapLayer);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const styleURL = React.useMemo(() => getMapStyleForLayer(mapLayer), [mapLayer]);

  // If Mapbox not available (Expo Go), show upgrade prompt
  if (!MapView) {
    return (
      <View style={styles.mapContainer}>
        <View style={[styles.mapFallback]}>
          <Icon name="Map" size={48} color={Colors.primaryMuted} />
          <Text style={styles.mapFallbackTitle}>Real Map Available</Text>
          <Text style={styles.mapFallbackText}>
            Build with EAS to enable Mapbox{'\n'}outdoor maps with offline support
          </Text>
        </View>
        {/* Show markers in approximate positions for dev/testing */}
        {markers.map((m, idx) => {
          const meta = MARKER_META[m.type as keyof typeof MARKER_META] ?? MARKER_META.free;
          const flagType = FLAG_TYPES.find(f => f.id === m.type);
          // Spread markers across the screen in a grid-ish pattern
          const col = idx % 3;
          const row = Math.floor(idx / 3);
          const xFrac = 0.2 + col * 0.3;
          const yFrac = 0.3 + row * 0.2;
          return (
            <PressableMarker
              key={m.id}
              x={xFrac * W - 16}
              y={yFrac * (H * 0.65) - 16}
              borderColor={meta.color}
              bg={meta.bg}
              iconColor={meta.color}
              iconName={(flagType?.icon ?? meta.iconName) as IconName}
              onPress={() => onMarkerPress(m)}
            />
          );
        })}
      </View>
    );
  }

  // Real Mapbox rendering
  return (
    <View style={styles.mapContainer}>
      <MapView
        style={StyleSheet.absoluteFillObject}
        styleURL={styleURL}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={true}
        scaleBarEnabled={false}
      >
        <Camera
          defaultSettings={{
            centerCoordinate: [region.centerLng, region.centerLat],
            zoomLevel: region.defaultZoom,
          }}
          minZoomLevel={4}
          maxZoomLevel={18}
        />
        <UserLocation visible={true} renderMode="native" />
        {markers.map((m) => {
          const meta = MARKER_META[m.type as keyof typeof MARKER_META] ?? MARKER_META.free;
          const flagType = FLAG_TYPES.find(f => f.id === m.type);
          // Sprint 68 STORY-00531: tier-aware visual treatment.
          //   self     → existing inline pin (no ring, full opacity)
          //   friend   → +2px colored ring (color stable per friend user_id)
          //   stranger → opacity 0.6 (desaturated feel without filter chain)
          // Pure function — caller passes viewer/friendIds via props.
          const { tier, ringColor, opacity } = getMarkerTierVisuals({
            viewerId,
            markUserId: m.authorId,
            permission: m.permission,
            friendIds,
          });
          return (
            <PointAnnotation
              key={m.id}
              id={m.id}
              coordinate={[m.lng, m.lat]}
              onSelected={() => onMarkerPress(m)}
            >
              <View style={{ opacity }}>
                {tier === 'friend' && ringColor ? (
                  <View style={[styles.markerFriendRing, { borderColor: ringColor }]} />
                ) : null}
                <View style={[styles.markerPin, { borderColor: meta.color, backgroundColor: 'rgba(255,255,255,0.85)' }]}>
                  <Icon name={(flagType?.icon ?? meta.iconName) as IconName} size={14} color={meta.color} strokeWidth={2.5} />
                </View>
              </View>
            </PointAnnotation>
          );
        })}
      </MapView>
      {/* O18 MAP-01: floating layer toggle (outdoors ↔ satellite).
          Tap flips the setting; the setting is persisted globally so
          MapHistoryScreen / HikingMap pick up the same choice next time. */}
      <TouchableOpacity
        style={styles.layerToggle}
        onPress={() => updateSetting('mapLayer', mapLayer === 'outdoors' ? 'satellite' : 'outdoors')}
        accessibilityRole="button"
        accessibilityLabel={mapLayer === 'outdoors' ? 'Switch to satellite view' : 'Switch to outdoor map'}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Icon
          name={mapLayer === 'satellite' ? 'Map' : 'Globe'}
          size={18}
          color={Colors.primary}
          strokeWidth={2}
        />
      </TouchableOpacity>
    </View>
  );
}

// ── CreateMarkerSheet (STORY-00096) ───────────────────────────────────────────
function CreateMarkerSheet({
  visible, onClose, onConfirm,
}: {
  visible: boolean; onClose: () => void;
  onConfirm: (type: MarkerType, text: string) => void;
}) {
  const [selectedType, setSelectedType] = useState<MarkerType | null>(null);
  const [text, setText] = useState('');
  const [textFocused, setTextFocused] = useState(false);
  const [permission, setPermission] = useState<'personal' | 'group' | 'public'>('personal');
  const slideAnim = useRef(new Animated.Value(400)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 400, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const charCount = text.length;
  const canSave = selectedType !== null;

  const permIconNames: Record<'personal' | 'group' | 'public', IconName> = {
    personal: 'Lock', group: 'Users', public: 'Globe',
  };
  const permLabels = { personal: 'Just me', group: 'Friends', public: 'Public' };

  if (!visible) return null;

  return (
    <Animated.View style={[styles.sheetOverlay, { opacity: opacityAnim }]}>
      <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={onClose} activeOpacity={1} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.sheetHandle} />
          {/* Header */}
          <View style={styles.sheetHeaderRow}>
            <Text style={styles.sheetTitle}>Plant a Cairn</Text>
            <TouchableOpacity style={styles.sheetCloseBtn} onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Icon name="X" size={IconSize.sm} color={Colors.textSecondary} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>

          {/* 4-card flag type grid (STORY-00096) */}
          <View style={styles.typeGrid}>
            {FLAG_TYPES.map((flag) => {
              const isSelected = selectedType === flag.id;
              return (
                <TouchableOpacity
                  key={flag.id}
                  style={[styles.typeCard, isSelected && styles.typeCardSelected]}
                  onPress={() => { setSelectedType(flag.id); haptic.impact('light'); }}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={[flag.bg, flag.bg.replace(')', ', 0.9)').replace('rgb', 'rgba')]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={[styles.typeIconBadge, { borderColor: flag.color + '40' }]}
                  >
                    <Icon name={flag.icon} size={IconSize.md} color={flag.color} strokeWidth={2} />
                  </LinearGradient>
                  <Text style={[styles.typeCardLabel, { color: isSelected ? Colors.primary : Colors.textSecondary }]}>
                    {flag.label}
                  </Text>
                  {/* CircleCheck selection indicator */}
                  {isSelected && (
                    <View style={styles.typeCardCheck}>
                      <Icon name="CircleCheck" size={14} color={Colors.primary} strokeWidth={2.5} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Note input with 3-tier char counter */}
          <View style={styles.noteWrap}>
            <TextInput
              style={[styles.noteInput, textFocused && styles.noteInputFocused, charCount >= 50 && styles.noteInputError]}
              placeholder="Describe this spot… (optional)"
              placeholderTextColor={Colors.textMuted}
              value={text}
              onChangeText={(t) => setText(t.slice(0, 50))}
              multiline
              numberOfLines={2}
              onFocus={() => setTextFocused(true)}
              onBlur={() => setTextFocused(false)}
            />
            <View style={styles.noteFooterRow}>
              <Text style={styles.noteMaxLabel}>Max 50 characters</Text>
              {(textFocused || charCount > 0) && (
                <Text style={[
                  styles.charCount,
                  charCount >= 50 ? { color: Colors.danger } : charCount >= 40 ? { color: Colors.severityCaution } : null,
                ]}>{charCount}/50</Text>
              )}
            </View>
          </View>

          {/* Permission selector — outlined pill style */}
          <View style={styles.permRow}>
            {(['personal', 'group', 'public'] as const).map((p) => {
              const active = permission === p;
              return (
                <TouchableOpacity
                  key={p}
                  style={[styles.permPill, active && styles.permPillActive]}
                  onPress={() => setPermission(p)}
                >
                  <Icon name={permIconNames[p]} size={14} color={active ? Colors.primary : Colors.textSecondary} strokeWidth={1.8} />
                  <Text style={[styles.permPillLabel, active && styles.permPillLabelActive]}>{permLabels[p]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Save button — disabled until type selected */}
          <PressBtn
            style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
            onPress={() => {
              if (!canSave) return;
              onConfirm(selectedType!, text);
              onClose();
              setText('');
              setSelectedType(null);
            }}
            scaleTo={0.96}
            disabled={!canSave}
          >
            <Icon name="Flag" size={IconSize.sm} color={canSave ? '#fff' : Colors.textMuted} strokeWidth={2} />
            <Text style={[styles.saveBtnText, !canSave && { color: Colors.textMuted }]}>Plant Flag</Text>
          </PressBtn>
        </Animated.View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

// ── EditMarkerSheet ──────────────────────────────────────────────────────────
function EditMarkerSheet({
  marker, onClose, onSave, onDelete, showMapBtn,
}: {
  marker: Marker | null;
  onClose: () => void;
  onSave: (id: string, type: MarkerType, note: string, permission: MarkerPermission) => void;
  onDelete?: (id: string) => void;
  showMapBtn?: boolean;
}) {
  const [selectedType, setSelectedType] = useState<MarkerType | null>(null);
  const [text, setText] = useState('');
  const [permission, setPermission] = useState<MarkerPermission>('personal');
  const [textFocused, setTextFocused] = useState(false);
  const slideAnim = useRef(new Animated.Value(400)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  const visible = marker !== null;

  // Populate fields when marker changes
  useEffect(() => {
    if (marker) {
      setSelectedType(marker.type as MarkerType);
      setText(marker.note ?? '');
      setPermission(marker.permission as MarkerPermission);
    }
  }, [marker?.id]);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 400, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const permIconNames: Record<MarkerPermission, IconName> = {
    personal: 'Lock', group: 'Users', public: 'Globe',
  };
  const permLabels: Record<MarkerPermission, string> = { personal: 'Just me', group: 'Friends', public: 'Public' };

  if (!visible || !marker) return null;

  return (
    <Animated.View style={[styles.sheetOverlay, { opacity: opacityAnim }]}>
      <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={onClose} activeOpacity={1} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeaderRow}>
            <Text style={styles.sheetTitle}>Edit Flag</Text>
            <TouchableOpacity style={styles.sheetCloseBtn} onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Icon name="X" size={IconSize.sm} color={Colors.textSecondary} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>

          {/* Type selector */}
          <View style={styles.typeGrid}>
            {FLAG_TYPES.map((flag) => {
              const isSelected = selectedType === flag.id;
              return (
                <TouchableOpacity
                  key={flag.id}
                  style={[styles.typeCard, isSelected && styles.typeCardSelected]}
                  onPress={() => { setSelectedType(flag.id); haptic.impact('light'); }}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={[flag.bg, flag.bg.replace(')', ', 0.9)').replace('rgb', 'rgba')]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={[styles.typeIconBadge, { borderColor: flag.color + '40' }]}
                  >
                    <Icon name={flag.icon} size={IconSize.md} color={flag.color} strokeWidth={2} />
                  </LinearGradient>
                  <Text style={[styles.typeCardLabel, { color: isSelected ? Colors.primary : Colors.textSecondary }]}>
                    {flag.label}
                  </Text>
                  {isSelected && (
                    <View style={styles.typeCardCheck}>
                      <Icon name="CircleCheck" size={14} color={Colors.primary} strokeWidth={2.5} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Note input */}
          <View style={styles.noteWrap}>
            <TextInput
              style={[styles.noteInput, textFocused && styles.noteInputFocused, text.length >= 50 && styles.noteInputError]}
              placeholder="Describe this spot… (optional)"
              placeholderTextColor={Colors.textMuted}
              value={text}
              onChangeText={(t) => setText(t.slice(0, 50))}
              multiline
              numberOfLines={2}
              onFocus={() => setTextFocused(true)}
              onBlur={() => setTextFocused(false)}
            />
            <View style={styles.noteFooterRow}>
              <Text style={styles.noteMaxLabel}>Max 50 characters</Text>
              {(textFocused || text.length > 0) && (
                <Text style={[
                  styles.charCount,
                  text.length >= 50 ? { color: Colors.danger } : text.length >= 40 ? { color: Colors.severityCaution } : null,
                ]}>{text.length}/50</Text>
              )}
            </View>
          </View>

          {/* Permission selector */}
          <View style={styles.permRow}>
            {(['personal', 'group', 'public'] as const).map((p) => {
              const active = permission === p;
              return (
                <TouchableOpacity
                  key={p}
                  style={[styles.permPill, active && styles.permPillActive]}
                  onPress={() => setPermission(p)}
                >
                  <Icon name={permIconNames[p]} size={14} color={active ? Colors.primary : Colors.textSecondary} strokeWidth={1.8} />
                  <Text style={[styles.permPillLabel, active && styles.permPillLabelActive]}>{permLabels[p]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Save button */}
          {onDelete ? (
            <View style={styles.editSheetActions}>
              <PressBtn
                style={styles.editSheetDeleteBtn}
                onPress={() => {
                  Alert.alert(
                    'Delete cairn',
                    `Delete "${marker.note || 'this cairn'}"? This cannot be undone.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => { onDelete(marker.id); onClose(); } },
                    ]
                  );
                }}
                scaleTo={0.96}
              >
                <Icon name="Trash2" size={14} color={Colors.danger} strokeWidth={2} />
                <Text style={styles.editSheetDeleteText}>Delete</Text>
              </PressBtn>
              <View style={styles.editSheetSaveFlex}>
                <PressBtn
                  style={styles.saveBtn}
                  onPress={() => {
                    if (!selectedType) return;
                    onSave(marker.id, selectedType, text, permission);
                    onClose();
                  }}
                  scaleTo={0.96}
                >
                  <Icon name="Check" size={IconSize.sm} color="#fff" strokeWidth={2} />
                  <Text style={styles.saveBtnText}>Save Changes</Text>
                </PressBtn>
              </View>
            </View>
          ) : (
            <PressBtn
              style={styles.saveBtn}
              onPress={() => {
                if (!selectedType) return;
                onSave(marker.id, selectedType, text, permission);
                onClose();
              }}
              scaleTo={0.96}
            >
              <Icon name="Check" size={IconSize.sm} color="#fff" strokeWidth={2} />
              <Text style={styles.saveBtnText}>Save Changes</Text>
            </PressBtn>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

// ── Main Map Screen ───────────────────────────────────────────────────────────
export function MapScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<any>();
  const focusMarkerId: string | undefined = route.params?.focusMarkerId;
  const viewOnly = !!focusMarkerId; // "view flag location" mode — hides activity controls

  // O12 Round-3: useAppStore mock fields (activityMode/setActivityMode,
  // trackingState/setTrackingState, trackingDistance/trackingDuration/
  // incrementTracking) all removed — the tracking bar + start-tracking
  // button + activity-mode chip that consumed them were dead UI (real
  // tracking runs in HikingScreen/RunningScreen via useTrackingStore).
  // O12 Round-3 R3-C1 + R3-M5: settings-aware distance for MapBottomPanel.
  const dist = useDistance();

  // Real marker store
  const storeMarkers = useMarkerStore(s => s.markers);
  const addMarker = useMarkerStore(s => s.addMarker);
  const deleteMarker = useMarkerStore(s => s.deleteMarker);
  const updateMarker = useMarkerStore(s => s.updateMarker);
  // Sprint 68 STORY-00534: hide-from-me action (POST /api/hide + cache wipe).
  const hideMark = useMarkerStore(s => s.hideMark);
  // BUG-002 fix (Sprint 71 post-review): MapScreen now consumes circle
  // markers + memory subscriptions so friend-tier marks render on the
  // map (forms B/C in tap-to-detail flow). Previously these slices were
  // only consumed by Trails Friends tab; the headline map surface was
  // permanently 'self tier only' — contradicting Sprint 68 Story-532 ACs.
  const circleMarkers = useMarkerStore(s => s.circleMarkers);
  const loadCircleMarkers = useMarkerStore(s => s.loadCircleMarkers);
  const loadingCircle = useMarkerStore(s => s.loadingCircle);
  const subscriptions = useMemorySubscriptionsStore(s => s.subscriptions);
  const loadSubscriptions = useMemorySubscriptionsStore(s => s.load);
  const loadingSubs = useMemorySubscriptionsStore(s => s.loading);
  // Sprint 68 STORY-00531: viewer perspective for tier-aware marker visuals.
  // viewerId comes from useMarkerStore (set by hydrate after login).
  // friendIds from useFriendStore (already loaded by Friends tab / auth flow).
  const viewerId = useMarkerStore(s => s.userId);
  const friends = useFriendStore(s => s.friends);
  const friendIds = React.useMemo(() => friends.map(f => f.id), [friends]);
  // BUG-002 fix: real subscribed friend ids from the Sprint 70 store
  // (was hardcoded []). Drives form C visibility on Map.
  const subscribedFriendIds = React.useMemo<ReadonlyArray<string | number>>(
    () => subscriptions.map(s => s.friend_id),
    [subscriptions]
  );
  // Iron law 1 / form-B-vs-C check: viewer's own fog membership.
  const isExploredFn = useMemoryStore(s => s.isExplored);
  // Sprint 68 STORY-00533: session-only Like state.
  const likeToggle = useMarkLikeStore(s => s.toggle);
  // Subscribe to `liked` array so the sheet re-renders when toggle fires.
  // Use a closure isLiked over the subscribed array; identity changes on
  // every toggle, forcing React.useCallback's dep array to recompute and
  // the consumer prop to update.
  const likedSet = useMarkLikeStore(s => s.liked);
  const isMarkLiked = React.useCallback(
    (id: string) => likedSet.includes(id),
    [likedSet]
  );

  // BUG-002 fix: load circle markers + subscriptions when the user enters
  // Map. Cached after first fetch; cheap to keep current. Triggered once
  // per mount; FlagsTab Friends sub-tab (Sprint 69) ALSO triggers via its
  // own effect — both calls hit the same slice and the second one is a
  // no-op if data already loaded.
  //
  // BUG-007 fix (Sprint 71 post-review round 2): added length+loading
  // guard matching the FlagsTab pattern. Without the guard, every Map
  // mount unconditionally refetches and races with in-flight POST /api/hide
  // (Story-534): user hides a friend mark in Trails, switches to Map,
  // refetch overwrites the BUG-005 client-wipe with the still-present
  // server row, ghost-resurrects the mark. Guard means refetch only runs
  // when slice is empty and not already loading.
  React.useEffect(() => {
    if (!viewerId) return;
    if (circleMarkers.length === 0 && !loadingCircle) void loadCircleMarkers();
    if (subscriptions.length === 0 && !loadingSubs) void loadSubscriptions();
    // BUG-011 fix: ESLint exhaustive-deps would want all of the conditions
    // above in the deps array — but adding them would fire the effect on
    // every change and defeat the BUG-007 single-flight pattern. The store
    // getter functions are stable Zustand references, so reading them
    // through the closure on a stable [viewerId] dep is safe. Intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId]);

  // BUG-002 fix: merged marker list passed to RealMap. Own marks render
  // with full opacity + no ring; friend marks render with colored ring;
  // stranger marks render at 0.6 opacity. Tier function decides.
  const mapMarkers = React.useMemo(() => {
    // Deduplicate: prefer the own-store entry over circle (the latter is a
    // server snapshot; the former carries optimistic local mutations).
    const ownIds = new Set(storeMarkers.map(m => m.id));
    const additional = circleMarkers.filter(m => !ownIds.has(m.id));
    return [...storeMarkers, ...additional];
  }, [storeMarkers, circleMarkers]);
  const lastCoord = useTrackingStore(s => s.lastCoordinate);
  const region = getCurrentRegion();

  const doReport = async (m: Marker, reason: 'fake_ad' | 'info_mismatch' | 'dislike') => {
    if (!lastCoord) { Alert.alert('Location unavailable', 'Turn on location to report this cairn.'); return; }
    try {
      await reportMarker(m.id, reason, lastCoord.lat, lastCoord.lng, lastCoord.accuracy);
      Alert.alert('Report sent', "Thanks — we'll look into it.");
    } catch (err) {
      if (err instanceof MarkerInteractionError) {
        if (err.code === 'TOO_FAR') Alert.alert('Too far', 'Move closer to report this mark.');
        else Alert.alert('Error', 'Could not report this mark.');
      }
    }
  };

  const [editMarker, setEditMarker] = useState<Marker | null>(null);
  // Sprint 68 STORY-00532: tap-to-detail surface. Tap → opens MarkDetailSheet
  // (forms A/B/C); Edit button inside form A then opens EditMarkerSheet.
  // Form D never reaches here because RealMap only renders visible marks.
  const [detailMarker, setDetailMarker] = useState<Marker | null>(null);
  const [createVisible, setCreateVisible] = useState(false);
  // O12 Round-3: showModeModal state removed — modal was dead UI.
  const [offlineVisible, setOfflineVisible] = useState(false);

  // Auto-select the focused marker on mount
  useEffect(() => {
    if (focusMarkerId) {
      const m = storeMarkers.find(m => m.id === focusMarkerId);
      if (m) {
        // In viewOnly mode, go straight to edit sheet (no intermediate detail sheet)
        setEditMarker(m);
      }
    }
  }, [focusMarkerId]);

  // Spring scales for buttons
  const fabScale = useRef(new Animated.Value(1)).current;
  const springIn = (val: Animated.Value) =>
    Animated.spring(val, { toValue: 0.95, useNativeDriver: true, tension: 300, friction: 10 }).start();
  const springOut = (val: Animated.Value) =>
    Animated.spring(val, { toValue: 1, useNativeDriver: true, tension: 300, friction: 8 }).start();

  // O12 Round-3: Mock tracking timer removed. useAppStore.trackingState /
  // trackingDistance / trackingDuration / incrementTracking were mock data
  // sources — real tracking runs in HikingScreen/RunningScreen via
  // useTrackingStore. MapScreen tracking bar has been removed too.
  // O12 Round-3: formatDuration helper removed — was only used by the
  // dead tracking bar.

  const handleAddMarker = async (type: MarkerType, note: string) => {
    const lat = lastCoord?.lat ?? region.centerLat;
    const lng = lastCoord?.lng ?? region.centerLng;
    await addMarker({
      type,
      regionCode: region.code,
      lat,
      lng,
      note,
      authorId: 'local',
      permission: 'personal',
    });
  };

  // O12 Round-3: `const isTracking = trackingState === 'tracking'` removed —
  // trackingState was a mock field, and all UI that read isTracking has been
  // deleted.

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* Map — full bleed topo placeholder */}
      <RealMap markers={mapMarkers} onMarkerPress={(m) => setDetailMarker(m)} viewerId={viewerId} friendIds={friendIds} />

      {/* Top bar — STORY-00099: rgba(255,255,255,0.95) overlay chips */}
      <SafeAreaView style={styles.topBar} edges={['top']} pointerEvents="box-none">
        {/* Left: back + GPS */}
        <View style={styles.topLeft}>
          <TouchableOpacity style={styles.backChip} onPress={() => nav.goBack()}>
            <Icon name="ChevronLeft" size={16} color={Colors.primary} strokeWidth={2.5} />
            <Text style={styles.backChipText}>Back</Text>
          </TouchableOpacity>
          <View style={styles.gpsChip}>
            <View style={[styles.gpsDot, { backgroundColor: Colors.severityWarning }]} />
            <Text style={[styles.chipText, styles.chipTextAmber]}>Enable GPS</Text>
          </View>
        </View>

        {/*
         * O12 Round-3: Activity-mode chip removed. `useAppStore.activityMode`
         * was mock-only — real tracking activity mode is picked in
         * HikingScreen/RunningScreen entry (not here). This chip only wrote
         * to the mock field and never influenced anything real.
         */}
      </SafeAreaView>

      {/*
       * O12 Round-3: Tracking bar + Start-tracking button removed. They ran
       * on useAppStore.trackingState mock state fed by a 3s incrementTracking
       * timer — the whole system was fake data. Real tracking lives in
       * HikingScreen/RunningScreen. MapScreen is now view-only (markers +
       * flag creation FAB).
       */}

      {/* Bottom controls — hidden in viewOnly mode */}
      {!viewOnly && (
      <SafeAreaView style={styles.bottomOverlay} edges={['bottom']} pointerEvents="box-none">
        <View style={styles.bottomRow}>
          <View style={{ flex: 1 }} />

          {/* FAB — STORY-00098: red badge showing flag count */}
          <Animated.View style={{ transform: [{ scale: fabScale }] }}>
            <TouchableOpacity
              style={styles.fab}
              onPress={() => setCreateVisible(true)}
              activeOpacity={1}
              onPressIn={() => springIn(fabScale)}
              onPressOut={() => springOut(fabScale)}
            >
              <Icon name="MapPin" size={22} color="#fff" strokeWidth={2} />
              {storeMarkers.length > 0 && (
                <View style={styles.fabBadge}>
                  <Text style={styles.fabBadgeText}>{storeMarkers.length}</Text>
                </View>
              )}
            </TouchableOpacity>
          </Animated.View>
        </View>
      </SafeAreaView>
      )}

      {/* Sheets */}
      <CreateMarkerSheet
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onConfirm={handleAddMarker}
      />
      <EditMarkerSheet
        marker={editMarker}
        onClose={() => setEditMarker(null)}
        onSave={(id, type, note, permission) => updateMarker(id, { type, note, permission })}
        onDelete={(id) => deleteMarker(id)}
      />
      {/* Sprint 68 STORY-00532: 4-form Detail Sheet. Mounted alongside the
          legacy EditMarkerSheet — tap on a map marker first opens this;
          form A's Edit button then opens EditMarkerSheet for the actual
          edit UI. Story-533 will wire Like/Report fake handlers; Story-534
          will wire the Hide-from-view cache wipe. */}
      <MarkDetailSheet
        marker={detailMarker}
        viewerId={viewerId}
        subscribedFriendIds={subscribedFriendIds}
        friendIds={friendIds}
        inMyFog={isExploredFn}
        isLiked={isMarkLiked}
        onClose={() => setDetailMarker(null)}
        onEdit={(m) => { setDetailMarker(null); setEditMarker(m); }}
        onLike={async (m) => {
          if (!lastCoord) { Alert.alert('Location unavailable', 'Turn on location to like this cairn.'); return; }
          // Optimistic: toggle immediately for instant UI feedback on spotty networks.
          // Revert only on hard business-rule errors (TOO_FAR / RATE_LIMITED).
          // 409 already-liked is treated as success (no revert) — the server agrees the like exists.
          likeToggle(m.id);
          try {
            await likeMarker(m.id, lastCoord.lat, lastCoord.lng, lastCoord.accuracy);
          } catch (err) {
            if (err instanceof MarkerInteractionError) {
              if (err.code === 'TOO_FAR') {
                likeToggle(m.id); // revert
                Alert.alert('Too far', 'Move closer to like this mark.');
              } else if (err.code === 'RATE_LIMITED') {
                likeToggle(m.id); // revert
                Alert.alert('Slow down', 'You\'ve liked too many marks recently.');
              }
              // Other errors (network): keep optimistic state — over-record beats data-loss on trails
            }
          }
        }}
        onReport={(m) => {
          Alert.alert('Report this cairn', 'What is wrong with it?', [
            { text: 'Spam or ad', onPress: () => doReport(m, 'fake_ad') },
            { text: 'Wrong info', onPress: () => doReport(m, 'info_mismatch') },
            { text: "Don't like it", onPress: () => doReport(m, 'dislike') },
            { text: 'Cancel', style: 'cancel' },
          ]);
        }}
        onDelete={(m, semantic) => {
          if (semantic === 'own') {
            Alert.alert(
              'Delete this cairn?',
              'This cannot be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => {
                  deleteMarker(m.id);
                  setDetailMarker(null);
                }},
              ],
            );
          } else {
            // Sprint 68 STORY-00534: real Hide-from-me. POST /api/hide +
            // cache wipe.
            // UX-Med-4 fix (post-review UX round 2): tone aligned with the
            // soft button label "Hide from my map" — pre-fix copy
            // "Hide this mark permanently?" was scary "bait-and-switch"
            // (button soft, modal hard). New copy explains the
            // consequence factually without scare-word "permanently".
            Alert.alert(
              'Hide this mark?',
              "You won't see it on your map again. Other users still see it.",
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Hide', style: 'destructive', onPress: () => {
                  hideMark(m.id);
                  setDetailMarker(null);
                }},
              ],
            );
          }
        }}
      />

      {/* Bottom Panel — hidden when viewing a specific marker */}
      {!viewOnly && (
        <MapBottomPanel
          markers={storeMarkers.map(m => {
            const dm = lastCoord
              ? haversineM({ lat: lastCoord.lat, lng: lastCoord.lng }, { lat: m.lat, lng: m.lng })
              : null;
            return {
              id: m.id,
              type: m.type,
              title: m.note || MARKER_META[m.type as keyof typeof MARKER_META]?.label || 'Marker',
              distance: dm != null ? dist.formatShort(dm) : '',
              timeAgo: new Date(m.createdAt).toLocaleDateString(),
            };
          })}
          onMarkerPress={(id) => {
            const m = storeMarkers.find(mk => mk.id === id);
            if (m) setEditMarker(m);
          }}
          onOfflinePress={() => setOfflineVisible(true)}
        />
      )}

      {/* Offline Map Download Sheet */}
      <OfflineMapSheet
        visible={offlineVisible}
        onClose={() => setOfflineVisible(false)}
      />

      {/*
       * O12 Round-3: Activity-mode modal removed. useAppStore.activityMode /
       * setActivityMode were mock — real mode is chosen when entering
       * HikingScreen/RunningScreen. No entry point remained after the mode
       * chip was removed above.
       */}
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Map (Sprint 42 — Real Mapbox + Fallback) ────────────────────────────────
  mapContainer: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    // R114 (2026-08-07): map placeholder color changed from Colors.primaryBg
    // (near-white pale green) to a neutral map-gray so tile-load in poor
    // network doesn't read as "the app is broken / earth is white".
    backgroundColor: '#dcd8d1',
    overflow: 'hidden',
  },
  // O18 MAP-01: floating layer toggle overlay.
  layerToggle: {
    position: 'absolute',
    top: 100, right: 12,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  mapFallback: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md,
  },
  mapFallbackTitle: {
    fontSize: FontSize.h3, fontWeight: '600', color: Colors.textPrimary,
  },
  mapFallbackText: {
    fontSize: FontSize.body, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22,
  },
  markerPin: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, ...Elevation[2],
  },
  // Sprint 68 STORY-00531: friend-tier ring. 2px solid ring offset 2px
  // outside the 32px pin → total visual width 36px. Color is set inline
  // per-marker by colorFromUserId(). Positioned absolutely so it
  // doesn't push the icon when the marker is selected/scaled.
  markerFriendRing: {
    position: 'absolute',
    width: 36, height: 36, borderRadius: 18,
    top: -2, left: -2,
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
  // O1 batch 33: removed SVG-placeholder styles (topoRing, trailLine, trailLine2,
  // trailLine3, locationDot, locationDotInner, locationPulse, mapLabelWrap, mapLabel,
  // mapSubLabel, downloadBtn, downloadBtnText) — 0 references in JSX.
  mapMarker: {
    position: 'absolute', width: 32, height: 32, borderRadius: 16,
    borderWidth: 2.5, alignItems: 'center', justifyContent: 'center',
    ...Shadow.card,
  },

  // ── Top bar (STORY-00099) ────────────────────────────────────────────────────
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.base, paddingTop: Spacing.lg,
  },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  backChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,255,255,0.82)', borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  backChipText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.primary },
  gpsChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.82)', borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  chipTextAmber: { color: Colors.severityWarning },
  gpsDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success },
  // O12 Round-3: modeChip / trackingBar / trackingStatItem / trackingValueLg /
  // trackingValue / trackingUnit / statDivider / stopBtn / stopBtnText /
  // startTrackingBtn / startTrackingText / gpsChipAmber styles removed —
  // all referenced only by the deleted mock tracking bar / start-tracking /
  // activity-mode chip UI.
  chipText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.textPrimary },

  // ── Bottom controls ──────────────────────────────────────────────────────────
  bottomOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, pointerEvents: 'box-none' },
  bottomRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.lg, gap: Spacing.sm,
  },
  fab: {
    backgroundColor: Colors.primary, borderRadius: Radius.circle,
    width: 60, height: 60, alignItems: 'center', justifyContent: 'center',
    ...Shadow.fab,
  },
  fabBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: Colors.danger, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4, borderWidth: 2, borderColor: '#fff',
  },
  fabBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },

  // ── Sheets ───────────────────────────────────────────────────────────────────
  sheetOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', zIndex: 100, backgroundColor: Colors.overlayDark },
  sheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet, padding: Spacing.xl,
    paddingBottom: 48, gap: Spacing.md, ...Shadow.overlay,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border,
    alignSelf: 'center', marginBottom: Spacing.xs,
  },
  sheetHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { fontSize: FontSize.h3, fontWeight: '700', color: Colors.textPrimary },
  sheetCloseBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center',
  },

  // 4-card grid (STORY-00096)
  typeGrid: { flexDirection: 'row', gap: Spacing.sm },
  typeCard: {
    flex: 1, alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.sm,
    borderRadius: Radius.card, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.surface, ...Shadow.card,
  },
  typeCardSelected: {
    borderColor: Colors.primary, backgroundColor: Colors.primaryBg,
  },
  typeIconBadge: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  typeCardLabel: { fontSize: FontSize.small, fontWeight: '700' },
  typeCardCheck: {
    position: 'absolute', top: 6, right: 6,
  },

  // Note input
  noteWrap: { position: 'relative' },
  noteInput: {
    backgroundColor: Colors.bg, borderRadius: Radius.button,
    padding: Spacing.md, fontSize: FontSize.body, color: Colors.textPrimary,
    borderWidth: 1.5, borderColor: Colors.border, minHeight: 70,
    textAlignVertical: 'top',
  },
  noteInputFocused: { borderColor: Colors.primary },
  noteInputError: { borderColor: Colors.danger },
  noteFooterRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 4, paddingHorizontal: 2,
  },
  noteMaxLabel: {
    fontSize: FontSize.tiny, color: Colors.textMuted,
  },
  charCount: {
    fontSize: FontSize.tiny, color: Colors.textMuted,
  },

  // Permission pills
  permRow: { flexDirection: 'row', gap: Spacing.sm },
  permPill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.pill,
    paddingVertical: Spacing.xs, paddingHorizontal: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  permPillActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryBg },
  permPillLabel: { fontSize: FontSize.small, fontWeight: '600', color: Colors.textSecondary },
  permPillLabelActive: { color: Colors.primary },

  // Save button
  saveBtn: {
    borderRadius: Radius.button, paddingVertical: Spacing.md,
    alignItems: 'center', backgroundColor: Colors.primary,
    flexDirection: 'row', gap: Spacing.xs, justifyContent: 'center',
  },
  saveBtnDisabled: { backgroundColor: Colors.border },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: FontSize.body },

  editSheetActions: {
    flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm,
  },
  editSheetDeleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.xs, borderRadius: Radius.button, paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1.5, borderColor: Colors.danger + '50',
    backgroundColor: Colors.dangerBg,
  },
  editSheetDeleteText: { color: Colors.danger, fontWeight: '600', fontSize: FontSize.body },
  editSheetSaveFlex: { flex: 1 },

  // O12 Round-3: modalOverlay + modeModal* styles removed — activity mode
  // modal was dead UI referencing removed mock fields.
});
