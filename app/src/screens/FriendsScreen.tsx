/**
 * FriendsScreen — R114/O25 visual redesign.
 *
 * 100% aligned to Cairn_Friends_FINAL concept (spec.json, 375x812 baseline):
 * - Paper-cream background with footprint / clean illustration layer
 * - Header: back / Friends title / add-icon
 * - Friends / Pending pill tabs (mutually exclusive)
 * - F0 Friends empty | F1 Friends list | F2 Pending both | F3 Pending incoming only |
 *   F4 Pending sent only | F5 Pending empty | F6 Add-friend sheet
 * - Bottom nav bar reused visually (Trails / Friends / Memory / Settings)
 * - Store logic (useFriendStore + requests) preserved intact from previous version.
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  TextInput, Animated, Easing, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import {
  useFriendStore, sendFriendRequest, fetchFriendRequests,
  acceptFriendRequestAPI, rejectFriendRequestAPI, blockUser, fetchFriendProfile,
  fetchOutboundRequests, cancelOutboundRequest,
  type OutboundRequest, type FriendProfile,
} from '../store/useFriendStore';
import { useMarkerStore } from '../store/useMarkerStore';
import { useAppearance } from '../hooks/useAppearance';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// ── Design system: golden-ratio driven tokens for consistency ──────────────
// Type scale (1.25 modular): 12 / 14 / 16 / 20 / 26 / 32
// Spacing scale (4/8/12/16/20/24/32/40 — 4 base)
// Icon sizes (unified 16 / 20 / 24 / 44)
// Radius scale (8 / 13 / 21 — Fibonacci)
const DS = {
  // Type
  fs_caption: 12,
  fs_meta: 12,
  fs_body: 15,
  fs_label: 14,
  fs_cardName: 16,
  fs_sectionTitle: 14,
  fs_headerTitle: 20,
  fs_emptyTitle: 22,
  fs_pageTitle: 26,
  // Weight
  fw_regular: '400' as const,
  fw_medium: '500' as const,
  fw_semibold: '600' as const,
  fw_bold: '700' as const,
  // Spacing
  sp1: 4,
  sp2: 8,
  sp3: 12,
  sp4: 16,
  sp5: 20,
  sp6: 24,
  sp7: 32,
  sp8: 40,
  // Icon
  ic_xs: 16,
  ic_sm: 20,
  ic_md: 24,
  ic_lg: 44,
  // Radius
  rad_sm: 8,
  rad_md: 13,
  rad_lg: 21,
  rad_pill: 999,
  // Content margins (golden-inspired)
  contentPad: 20,     // 375 * 0.053, breathes without being tight
};

// ── Spec tokens (colors) ────────────────────────────────────────────────────
const T = {
  paper: '#F9F7EF',
  forest: '#1F4A3F',       // slightly lighter than #143D35 to match concept
  forestActive: '#175A44', // active pill / CTA — softer than #0F5D45
  textPrimary: '#2A3630',
  textSecondary: '#7C8580',
  card: 'rgba(255,255,255,0.75)',
  cardBorder: 'rgba(210,205,195,0.75)',
  tabBg: 'rgba(255,255,255,0.72)',   // idle pill background
  tabBgActive: '#175A44',            // active pill background
  navSurface: '#F4EFE6',             // home tab bar color
  scrim: 'rgba(20,30,25,0.45)',
  inputBg: 'rgba(255,255,255,0.9)',
  inputBorder: 'rgba(210,205,195,0.9)',
  danger: '#c53d2e',
};

// Avatar palette (concept F1/F2 shows colored circles with initials)
const AVATAR_PALETTE = [
  '#0F5D45', '#7B4EA8', '#3B7DB6', '#C57438',
  '#4A8C4A', '#B84B7C', '#6B7280', '#8B5CF6',
];
function avatarColorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}
function initialsOf(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ── Inline SVG icons — default size = DS.ic_md (24). Line weight tuned per
// icon so at their intended size they read balanced. Pass explicit `size`
// to override.
const Ico = {
  Back: ({ size = 24, color = T.forest }: { size?: number; color?: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <Path d="m15 18-6-6 6-6" />
    </Svg>
  ),
  Add: ({ size = 24, color = T.forest }: { size?: number; color?: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  Check: ({ size = 20, color = T.forest }: { size?: number; color?: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="m5 12 4 4L19 6" />
    </Svg>
  ),
  X: ({ size = 20, color = T.danger }: { size?: number; color?: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  ),
  Clock: ({ size = 20, color = T.forest }: { size?: number; color?: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 7v5l3 2" />
    </Svg>
  ),
  Mail: ({ size = 24, color = T.forest }: { size?: number; color?: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="3" y="5" width="18" height="14" rx="2" />
      <Path d="m3 7 9 6 9-6" />
    </Svg>
  ),
  People: ({ size = 24, color = T.forest }: { size?: number; color?: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="9" cy="8" r="3" />
      <Path d="M3 20v-2a6 6 0 0 1 12 0v2" />
      <Path d="M16 6a3 3 0 0 1 0 6M18 20v-2a5 5 0 0 0-3-4.58" />
    </Svg>
  ),
  ChevronR: ({ size = 20, color = T.textSecondary }: { size?: number; color?: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="m9 6 6 6-6 6" />
    </Svg>
  ),
  Send: ({ size = 20, color = '#fff' }: { size?: number; color?: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M22 2 11 13" />
      <Path d="m22 2-7 20-4-9-9-4 20-7Z" />
    </Svg>
  ),
};

// ── Background: cream + optional footprints illustration ────────────────────
// The illustration asset is 1170x2532 (iPhone @3x). We render it as an <Image>
// with `resizeMode='cover'` filling the full screen so it does not squash or
// display at its natural pixel size.
// R21 (2026-08-17): Friends bg now has day + night variants driven by
// useAppearance. Auto mode follows local time; user-set Light/Dark overrides.
function Backdrop() {
  const { isDark } = useAppearance();
  const daySrc = require('../../assets/friends/backgrounds/friends-bg-day.png');
  const nightSrc = require('../../assets/friends/backgrounds/friends-bg-night.png');
  const srcModule = isDark ? nightSrc : daySrc;
  const webUri =
    Platform.OS === 'web'
      ? (isDark
          ? '/assets/?unstable_path=./assets/friends/backgrounds/friends-bg-night.png'
          : '/assets/?unstable_path=./assets/friends/backgrounds/friends-bg-day.png')
      : null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? '#0A1220' : T.paper }]}>
      <Image
        source={webUri ? { uri: webUri } : srcModule}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', opacity: isDark ? 0.95 : 0.85 }}
        resizeMode="cover"
      />
    </View>
  );
}

// ── Tabs: two independent pill buttons (concept F0/F1/F2 — the pills are
// separate, not joined inside a single container).
function TabsPill({ active, onChange }: { active: 'friends' | 'pending'; onChange: (t: 'friends' | 'pending') => void }) {
  return (
    <View style={s.tabsRow}>
      <TouchableOpacity
        style={[s.tabPill, active === 'friends' ? s.tabPillActive : s.tabPillIdle]}
        activeOpacity={0.85}
        onPress={() => onChange('friends')}
        accessibilityRole="button"
        accessibilityLabel="Friends tab"
      >
        <Text style={[s.tabLabel, active === 'friends' && s.tabLabelActive]}>Friends</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[s.tabPill, active === 'pending' ? s.tabPillActive : s.tabPillIdle]}
        activeOpacity={0.85}
        onPress={() => onChange('pending')}
        accessibilityRole="button"
        accessibilityLabel="Pending tab"
      >
        <Text style={[s.tabLabel, active === 'pending' && s.tabLabelActive]}>Pending</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Friend row (F1) ─────────────────────────────────────────────────────────
function FriendRow({
  id, name, sharedFlags, onPress, onLongPress,
}: {
  id: string; name: string; sharedFlags: number;
  onPress?: () => void; onLongPress?: () => void;
}) {
  const meta = sharedFlags > 0
    ? `${sharedFlags} shared ${sharedFlags === 1 ? 'flag' : 'flags'}`
    : 'No shared flags yet';
  return (
    <TouchableOpacity
      style={s.card}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={500}
      activeOpacity={0.85}
      testID={`friend-card-${id}`}
    >
      <View style={[s.avatar, { backgroundColor: avatarColorFor(id) }]}>
        <Text style={s.avatarText}>{initialsOf(name)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.cardName} numberOfLines={1}>{name}</Text>
        <Text style={s.cardMeta} numberOfLines={1}>{meta}</Text>
      </View>
      <Ico.ChevronR />
    </TouchableOpacity>
  );
}

// ── Incoming request row (F2/F3) ────────────────────────────────────────────
function IncomingRow({
  id, fromName, fromEmail, busy, onAccept, onReject,
}: {
  id: string; fromName: string; fromEmail: string;
  busy: boolean; onAccept: () => void; onReject: () => void;
}) {
  return (
    <View style={s.card} testID={`incoming-card-${id}`}>
      <View style={[s.avatar, { backgroundColor: avatarColorFor(id) }]}>
        <Text style={s.avatarText}>{initialsOf(fromName)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.cardName} numberOfLines={1}>{fromName}</Text>
        <Text style={s.cardMeta} numberOfLines={1}>{fromEmail}</Text>
      </View>
      <View style={s.actionRow}>
        <TouchableOpacity
          style={s.actionBtn}
          onPress={onAccept}
          disabled={busy}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 4 }}
          accessibilityLabel="Accept friend request"
        >
          {busy ? <ActivityIndicator size="small" color={T.forestActive} /> : <Ico.Check size={DS.ic_sm} color={T.forestActive} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={s.actionBtn}
          onPress={onReject}
          disabled={busy}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 6 }}
          accessibilityLabel="Decline friend request"
        >
          <Ico.X size={DS.ic_sm} color={T.danger} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Sent (outbound) request row (F2/F4) ─────────────────────────────────────
function SentRow({
  id, toName, onCancel,
}: {
  id: string; toName: string; onCancel: () => void;
}) {
  return (
    <View style={s.card} testID={`sent-card-${id}`}>
      <View style={[s.avatar, { backgroundColor: avatarColorFor(id) }]}>
        <Text style={s.avatarText}>{initialsOf(toName)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.cardName} numberOfLines={1}>{toName}</Text>
        <Text style={s.cardMeta} numberOfLines={1}>Waiting for response</Text>
      </View>
      <TouchableOpacity
        style={s.actionBtn}
        onPress={onCancel}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Cancel outbound request"
        testID={`btn-cancel-outbound-${id}`}
      >
        <Ico.Clock size={DS.ic_sm} color={T.forest} />
      </TouchableOpacity>
    </View>
  );
}

// ── Add-friend rising sheet (F6, per concept) ───────────────────────────────
// Concept: NOT a full-screen page. A tall arched sheet that rises from the
// bottom, covers ~80% of the screen but leaves a strip of the underlying
// footprint background visible on top. Tap the visible strip to dismiss.
// Bird hero sits ONLY in the top-right of the sheet — it does not fill the
// whole hero area; the rest of the sheet's top curve remains soft paper.
type AddState = 'idle' | 'loading' | 'success' | 'error';

function AddFriendPage({ onDismiss }: { onDismiss: () => void }) {
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [state, setState] = useState<AddState>('idle');
  const successEmail = useRef('');

  // Slide + scrim animation. Sheet starts fully off-screen and glides up.
  const SHEET_TRAVEL = 700;
  const slide = useRef(new Animated.Value(SHEET_TRAVEL)).current;
  const scrim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slide, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(scrim, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();
  }, []);

  const close = () => {
    Animated.parallel([
      Animated.timing(slide, { toValue: SHEET_TRAVEL, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(scrim, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => onDismiss());
  };

  const submit = async () => {
    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) { setErr('Enter a valid email'); return; }
    setErr('');
    setState('loading');
    successEmail.current = trimmed;
    const r = await sendFriendRequest(trimmed);
    if (r.success) {
      setState('success');
      setTimeout(() => { setEmail(''); setState('idle'); close(); }, 1600);
    } else {
      const raw = (r.error || '').toLowerCase();
      let msg: string;
      if (raw.includes('not found') || raw.includes('no user') || raw.includes('does not exist')) {
        msg = 'No one at Cairn uses that email yet. Ask them to sign up first.';
      } else if (raw.includes('already') && (raw.includes('friend') || raw.includes('request'))) {
        msg = 'You already sent a request or are friends with this person.';
      } else if (raw.includes('yourself') || raw.includes('self')) {
        msg = "You can't friend yourself.";
      } else {
        msg = r.error || "Couldn't send. Check your connection and try again.";
      }
      setErr(msg);
      setState('idle');
    }
  };

  // Bird corner asset (small image top-right of sheet).
  // R21 (2026-08-17): day/night variants driven by useAppearance.
  const { isDark: birdIsDark } = useAppearance();
  const birdModule = birdIsDark
    ? require('../../assets/friends/hero/add-friend-hero-night.png')
    : require('../../assets/friends/hero/add-friend-hero-day.png');
  const birdWebUri =
    Platform.OS === 'web'
      ? (birdIsDark
          ? '/assets/?unstable_path=./assets/friends/hero/add-friend-hero-night.png'
          : '/assets/?unstable_path=./assets/friends/hero/add-friend-hero-day.png')
      : null;

  return (
    <View style={s.f6Root} pointerEvents="box-none">
      {/* Scrim behind sheet — the small strip above the sheet is tappable */}
      <Animated.View style={[s.f6Scrim, { opacity: scrim }]}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={close}
          accessibilityLabel="Close add friend sheet"
        />
      </Animated.View>

      {/* Rising sheet */}
      <Animated.View style={[s.f6Sheet, { transform: [{ translateY: slide }] }]}>
        {/* HERO — landscape asset fills the top of the sheet */}
        <View style={s.f6HeroBox} pointerEvents="none">
          <Image
            source={birdWebUri ? { uri: birdWebUri } : birdModule}
            style={s.f6HeroImg}
            resizeMode="cover"
          />
        </View>

        {/* Arched paper — SVG dome cutout on top edge so it reads as a true
            semi-circular dome (concave curve), not just rounded corners. */}
        <View style={s.f6Arch} pointerEvents="box-none">
          <Svg
            width="100%"
            height={90}
            viewBox="0 0 390 90"
            preserveAspectRatio="none"
            style={s.f6ArchSvg}
          >
            {/* Wide shallow dome — matches concept where the arc is broad
                rather than tall. Peak dips ~50px into hero, sides start
                flush with sheet edges. */}
            <Path
              d="M 0,90 C 100,-10 290,-10 390,90 L 390,90 L 0,90 Z"
              fill={T.paper}
            />
          </Svg>

          <View style={s.f6ArchBody}>
            {/* Mail badge — sits at arch peak (SVG dome crest) */}
            <View style={s.f6MailBadge}>
              <View style={s.f6MailCircle}>
                <Ico.Mail size={DS.ic_md} color={T.forestActive} />
              </View>
            </View>

            <ScrollView
              contentContainerStyle={s.f6ScrollBody}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={s.f6Title}>Add a Friend</Text>
              <Text style={s.f6Body}>
                {state === 'success'
                  ? `Request sent to ${successEmail.current}`
                  : 'Enter their email address to\nsend a friend request.'}
              </Text>

              {state !== 'success' && (
                <>
                  <Text style={s.f6InputLabel}>Email Address</Text>
                  <View style={[s.f6InputWrap, err ? { borderColor: T.danger } : null]}>
                    <TextInput
                      style={s.f6Input}
                      placeholder="name@email.com"
                      placeholderTextColor={T.textSecondary}
                      value={email}
                      onChangeText={(t) => { setEmail(t); if (err) setErr(''); }}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      editable={state !== 'loading'}
                    />
                  </View>
                  {!!err && <Text style={s.f6Err}>{err}</Text>}

                  <TouchableOpacity
                    style={[s.f6Send, (!email.trim() || state === 'loading') && { opacity: 0.75 }]}
                    onPress={submit}
                    disabled={!email.trim() || state === 'loading'}
                    activeOpacity={0.9}
                  >
                    {state === 'loading'
                      ? <ActivityIndicator size="small" color="#fff" />
                      : (
                        <>
                          <Ico.Send size={DS.ic_sm} color="#fff" />
                          <Text style={s.f6SendText}>Send Request</Text>
                        </>
                      )}
                  </TouchableOpacity>

                  <TouchableOpacity style={s.f6Cancel} onPress={close} activeOpacity={0.7}>
                    <Text style={s.f6CancelText}>Cancel</Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        </View>

        {/* Close X — top-left over hero */}
        <TouchableOpacity
          style={s.f6Close}
          onPress={close}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Close"
          accessibilityRole="button"
        >
          <Ico.X size={DS.ic_md} color={T.forest} />
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// ── Bottom navigation (reused from Home — same PNG icons, same colors, same
// layout tokens so Home ↔ Friends visual continuity is preserved).
function BottomNav({ active, onNavigate }: { active: 'trails' | 'friends' | 'memory' | 'settings'; onNavigate: (dest: string) => void }) {
  const items = [
    { key: 'trails' as const,   route: 'Routes',   label: 'Trails',   img: require('../../assets/home/tab-trails.png') },
    { key: 'friends' as const,  route: 'Friends',  label: 'Friends',  img: require('../../assets/home/tab-friends.png') },
    { key: 'memory' as const,   route: 'Memory',   label: 'Memory',   img: require('../../assets/home/tab-memory.png') },
    { key: 'settings' as const, route: 'Settings', label: 'Settings', img: require('../../assets/home/tab-settings.png') },
  ];
  return (
    <View style={s.bottomNav}>
      {items.map((it) => (
        <TouchableOpacity
          key={it.key}
          style={s.bottomNavItem}
          activeOpacity={0.8}
          onPress={() => onNavigate(it.route)}
        >
          <Image source={it.img} style={s.bottomNavIcon} resizeMode="contain" />
          <Text style={[s.bottomNavLabel, it.key === active && s.bottomNavLabelActive]}>{it.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
export function FriendsScreen() {
  const nav = useNavigation<Nav>();
  const [tab, setTab] = useState<'friends' | 'pending'>('friends');
  const [showAdd, setShowAdd] = useState(false);

  const storeFriends = useFriendStore((st) => st.friends);
  const loadFriendsFromBackend = useFriendStore((st) => st.loadFriendsFromBackend);
  const loadCircleMarkers = useMarkerStore((st) => st.loadCircleMarkers);

  type IncomingRequest = {
    id: string | number;
    from_name: string;
    from_email: string;
    sent_at: string | number;
  };
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [outbound, setOutbound] = useState<OutboundRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [profileFriend, setProfileFriend] = useState<{ id: string; name: string; email: string } | null>(null);
  const [profileData, setProfileData] = useState<FriendProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const loadRequests = async () => {
    try {
      const reqs = await fetchFriendRequests();
      setIncoming(
        (reqs as unknown as IncomingRequest[]).map((r) => ({
          id: r.id, from_name: r.from_name, from_email: r.from_email, sent_at: r.sent_at,
        })),
      );
    } catch { /* silent */ }
    try {
      const out = await fetchOutboundRequests();
      setOutbound(out);
    } catch { /* silent */ }
  };

  useEffect(() => {
    loadFriendsFromBackend();
    loadRequests();
  }, []);

  const friends = useMemo(
    () => storeFriends.map((f) => ({
      id: f.id, name: f.name, email: f.email,
      sharedFlags: 0, // Backend hasn't returned real value yet — keep 0 (row copy adapts).
    })),
    [storeFriends],
  );

  const handleAccept = async (id: string | number) => {
    setBusyId(String(id));
    const ok = await acceptFriendRequestAPI(String(id));
    setBusyId(null);
    if (ok) {
      await Promise.all([loadFriendsFromBackend(), loadRequests()]);
      void loadCircleMarkers();
    }
  };

  const handleReject = async (id: string | number) => {
    setBusyId(String(id));
    const ok = await rejectFriendRequestAPI(String(id));
    setBusyId(null);
    if (ok) await loadRequests();
  };

  const handleCancelOutbound = (req: OutboundRequest) => {
    Alert.alert(
      `Cancel request to ${req.toName}?`,
      '',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel request',
          style: 'destructive',
          onPress: async () => {
            const ok = await cancelOutboundRequest(req.id);
            if (ok) setOutbound((prev) => prev.filter((r) => r.id !== req.id));
          },
        },
      ],
    );
  };

  const handleFriendLongPress = (friend: { id: string; name: string; email: string }) => {
    Alert.alert(
      friend.name,
      friend.email,
      [
        {
          text: 'View profile',
          onPress: async () => {
            setProfileFriend(friend);
            setProfileData(null);
            setProfileLoading(true);
            const p = await fetchFriendProfile(friend.id);
            setProfileData(p);
            setProfileLoading(false);
          },
        },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              `Block ${friend.name}?`,
              'They will no longer see your public cairns, and this friendship will be removed. You can unblock later in Settings.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Block',
                  style: 'destructive',
                  onPress: async () => {
                    const r = await blockUser(friend.id);
                    if (r.error) { Alert.alert('Block failed', r.error, [{ text: 'OK' }]); return; }
                    await loadFriendsFromBackend();
                    void loadCircleMarkers();
                  },
                },
              ],
            );
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const hasFriends = friends.length > 0;
  const hasIncoming = incoming.length > 0;
  const hasOutbound = outbound.length > 0;
  const pendingEmpty = !hasIncoming && !hasOutbound;

  // State derivation follows spec F0..F5 (F6 handled via showAdd overlay):
  //   Friends tab + no friends              → F0 (clean bg + empty illustration)
  //   Friends tab + has friends             → F1 (footprints bg + list)
  //   Pending tab + incoming AND sent       → F2
  //   Pending tab + incoming only           → F3
  //   Pending tab + sent only               → F4
  //   Pending tab + neither                 → F5 (clean bg)
  // Concept: both Friends and Pending tabs share the footprints backdrop.
  return (
    <View style={s.root}>
      <Backdrop />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          style={s.hIcon}
          onPress={() => nav.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Back"
          accessibilityRole="button"
        >
          <Ico.Back size={DS.ic_md} color={T.forest} />
        </TouchableOpacity>
        <Text style={s.hTitle}>Friends</Text>
        <TouchableOpacity
          style={s.hIcon}
          onPress={() => setShowAdd(true)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Add friend"
          accessibilityRole="button"
        >
          <Ico.Add size={DS.ic_md} color={T.forest} />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <TabsPill active={tab} onChange={setTab} />

      {/* Content */}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Friends tab */}
        {tab === 'friends' && !hasFriends && (
          <View style={s.emptyBlock}>
            <View style={s.emptyIconRing}>
              <Ico.People size={DS.ic_lg} color={T.forest} />
            </View>
            <View style={s.emptyTextCard}>
              <Text style={s.emptyTitle}>No friends yet</Text>
              <Text style={s.emptyBody}>Add a friend by email to see where your paths cross.</Text>
            </View>
          </View>
        )}
        {tab === 'friends' && hasFriends && (
          <>
            <Text style={s.sectionTitle}>Friends ({friends.length})</Text>
            {friends.map((f) => (
              <FriendRow
                key={f.id}
                id={f.id}
                name={f.name}
                sharedFlags={f.sharedFlags}
                onLongPress={() => handleFriendLongPress({ id: f.id, name: f.name, email: f.email })}
              />
            ))}
          </>
        )}

        {/* Pending tab */}
        {tab === 'pending' && pendingEmpty && (
          <View style={s.emptyBlock}>
            <View style={s.emptyIconRing}>
              <Ico.Mail size={DS.ic_lg} color={T.forest} />
            </View>
            <View style={s.emptyTextCard}>
              <Text style={s.emptyTitle}>No pending requests</Text>
              <Text style={s.emptyBody}>New requests and sent invites will appear here.</Text>
            </View>
          </View>
        )}
        {tab === 'pending' && (hasIncoming || hasOutbound) && (
          <>
            {hasIncoming && (
              <>
                <Text style={s.sectionTitle}>Incoming Requests ({incoming.length})</Text>
                {incoming.map((r) => (
                  <IncomingRow
                    key={r.id}
                    id={String(r.id)}
                    fromName={r.from_name}
                    fromEmail={r.from_email}
                    busy={busyId === String(r.id)}
                    onAccept={() => handleAccept(r.id)}
                    onReject={() => handleReject(r.id)}
                  />
                ))}
              </>
            )}
            {!hasIncoming && (
              <Text style={s.mutedNote}>No incoming requests</Text>
            )}
            {hasOutbound && (
              <>
                <Text style={[s.sectionTitle, { marginTop: 20 }]}>Sent Requests ({outbound.length})</Text>
                {outbound.map((r) => (
                  <SentRow
                    key={r.id}
                    id={String(r.id)}
                    toName={r.toName}
                    onCancel={() => handleCancelOutbound(r)}
                  />
                ))}
              </>
            )}
            {!hasOutbound && hasIncoming && (
              <Text style={[s.mutedNote, { marginTop: 20 }]}>No sent requests yet</Text>
            )}
          </>
        )}
      </ScrollView>

      {/* Floating Add Friend button (concept: shown when list has content) */}
      {((tab === 'friends' && hasFriends) || (tab === 'pending' && (hasIncoming || hasOutbound))) && (
        <TouchableOpacity
          style={s.floatingAdd}
          onPress={() => setShowAdd(true)}
          activeOpacity={0.9}
          accessibilityLabel="Add a Friend"
          accessibilityRole="button"
        >
          <Ico.Add size={DS.ic_sm} color="#fff" />
          <Text style={s.floatingAddText}>Add a Friend</Text>
        </TouchableOpacity>
      )}

      {/* Empty-state large CTA */}
      {((tab === 'friends' && !hasFriends) || (tab === 'pending' && pendingEmpty)) && (
        <TouchableOpacity
          style={s.floatingAdd}
          onPress={() => setShowAdd(true)}
          activeOpacity={0.9}
          accessibilityLabel="Add a Friend"
          accessibilityRole="button"
        >
          <Ico.Add size={DS.ic_sm} color="#fff" />
          <Text style={s.floatingAddText}>Add a Friend</Text>
        </TouchableOpacity>
      )}

      {/* Bottom navigation (reused from Home) */}
      <BottomNav
        active="friends"
        onNavigate={(dest) => {
          if (dest === 'Friends') return; // already here
          nav.navigate(dest as never);
        }}
      />

      {/* Add-friend full-screen page */}
      {showAdd && <AddFriendPage onDismiss={() => setShowAdd(false)} />}

      {/* Profile modal (unchanged UX from previous version, minimal card) */}
      {profileFriend && (
        <View style={s.profileOverlay}>
          <View style={s.profileCard}>
            <View style={{ alignItems: 'center', marginBottom: 12 }}>
              <View style={[s.avatar, { width: 64, height: 64, borderRadius: 32, backgroundColor: avatarColorFor(profileFriend.id) }]}>
                <Text style={[s.avatarText, { fontSize: 24 }]}>{initialsOf(profileFriend.name)}</Text>
              </View>
              <Text style={[s.cardName, { fontSize: 18, marginTop: 10 }]}>{profileFriend.name}</Text>
              <Text style={s.cardMeta}>{profileFriend.email}</Text>
            </View>
            {profileLoading ? (
              <ActivityIndicator color={T.forestActive} style={{ marginVertical: 20 }} />
            ) : profileData ? (
              <View style={{ paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: T.cardBorder }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={s.profileStat}>{profileData.hikeCount}</Text>
                    <Text style={s.profileStatLabel}>hikes</Text>
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={s.profileStat}>{profileData.friendCount}</Text>
                    <Text style={s.profileStatLabel}>friends</Text>
                  </View>
                </View>
                {profileData.memberSince && (
                  <Text style={[s.cardMeta, { textAlign: 'center', marginTop: 8 }]}>
                    Member since {new Date(profileData.memberSince).toLocaleDateString()}
                  </Text>
                )}
              </View>
            ) : (
              <Text style={[s.cardMeta, { textAlign: 'center', marginVertical: 20 }]}>Profile unavailable.</Text>
            )}
            <TouchableOpacity
              testID="btn-close-profile"
              style={s.profileClose}
              onPress={() => { setProfileFriend(null); setProfileData(null); }}
            >
              <Text style={s.profileCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
// Baseline is spec.json 375x812; all other viewports scale from these values.
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paper },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    height: 48,
    marginTop: 44,
    paddingHorizontal: DS.contentPad,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hIcon: {
    width: DS.ic_md + 8,
    height: DS.ic_md + 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hTitle: {
    fontSize: DS.fs_headerTitle,
    fontWeight: DS.fw_bold,
    color: T.forest,
    letterSpacing: 0.2,
  },

  // ── Tabs (centered, equal width, φ-related dimensions) ───────────────────
  tabsRow: {
    marginTop: DS.sp4,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: DS.sp3,
  },
  tabPill: {
    width: 132,     // ≈ 375 * 0.35 (close to φ⁻² * width/1.5)
    height: 40,     // 132 / φ² ≈ 40 for pleasing tab proportion
    borderRadius: DS.rad_pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabPillIdle: {
    backgroundColor: T.tabBg,
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  tabPillActive: {
    backgroundColor: T.tabBgActive,
  },
  tabLabel: {
    fontSize: DS.fs_label,
    fontWeight: DS.fw_bold,
    color: T.forest,
    letterSpacing: 0.2,
  },
  tabLabelActive: {
    color: '#fff',
  },

  // ── Scroll body ──────────────────────────────────────────────────────────
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: DS.contentPad,
    paddingTop: DS.sp5,
    paddingBottom: 220,   // floating Add Friend + bottom nav clearance
    gap: DS.sp3,
  },

  sectionTitle: {
    fontSize: DS.fs_sectionTitle,
    fontWeight: DS.fw_bold,
    color: T.forest,
    paddingHorizontal: DS.sp1,
    paddingBottom: DS.sp2,
    letterSpacing: 0.3,
  },
  mutedNote: {
    fontSize: DS.fs_meta,
    color: T.textSecondary,
    paddingHorizontal: DS.sp1,
    paddingTop: DS.sp2,
    fontStyle: 'italic',
  },

  // ── Cards (friend / incoming / sent) ─────────────────────────────────────
  card: {
    minHeight: 68,        // 42px avatar + padding
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.cardBorder,
    borderRadius: DS.rad_lg,
    paddingHorizontal: DS.sp4,
    paddingVertical: DS.sp3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DS.sp3,
  },
  avatar: {
    width: 42,            // 68 / φ ≈ 42
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: DS.fs_label,
    fontWeight: DS.fw_bold,
  },
  cardName: {
    fontSize: DS.fs_cardName,
    fontWeight: DS.fw_semibold,
    color: T.textPrimary,
  },
  cardMeta: {
    fontSize: DS.fs_meta,
    color: T.textSecondary,
    marginTop: 2,
  },

  actionRow: {
    flexDirection: 'row',
    gap: DS.sp2,
    alignItems: 'center',
  },
  actionBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderWidth: 1,
    borderColor: T.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Empty states (F0 friends-empty, F5 pending-empty) ────────────────────
  // Golden-ratio anchored: paddingTop places icon block at ~0.382 (φ⁻¹)
  // of usable height for pleasing vertical composition.
  emptyBlock: {
    alignItems: 'center',
    paddingTop: 96,
    gap: DS.sp5,
  },
  emptyIconRing: {
    width: 112,           // 68 * φ ≈ 110, rounded to 112
    height: 112,
    borderRadius: 56,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderWidth: 1,
    borderColor: T.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: DS.sp4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  emptyTextCard: {
    backgroundColor: 'rgba(249,247,239,0.9)',
    borderRadius: DS.rad_lg,
    paddingHorizontal: DS.sp6,
    paddingVertical: DS.sp5,
    alignSelf: 'stretch',
    marginHorizontal: DS.sp5,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: DS.fs_emptyTitle,
    fontWeight: DS.fw_bold,
    color: T.forest,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  emptyBody: {
    fontSize: DS.fs_body,
    color: T.textSecondary,
    textAlign: 'center',
    paddingHorizontal: DS.sp5,
    lineHeight: 22,
    marginTop: DS.sp2,
  },

  // ── Floating "Add Friend" CTA ─────────────────────────────────────────────
  // Positioned at 0.618 point above bottom nav for eye-natural landing.
  floatingAdd: {
    position: 'absolute',
    left: 68,
    right: 68,
    bottom: 112,
    height: 52,           // matches input/CTA scale on F6
    backgroundColor: T.forestActive,
    borderRadius: DS.rad_pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: DS.sp2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  floatingAddText: {
    color: '#fff',
    fontSize: DS.fs_body,
    fontWeight: DS.fw_bold,
    letterSpacing: 0.2,
  },

  // ── F6 Add-friend rising sheet ────────────────────────────────────────────
  f6Root: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 200,
  },
  f6Scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: T.scrim,
  },
  f6Sheet: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    height: '94%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
    backgroundColor: T.paper,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 20,
  },
  f6HeroBox: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 220,          // full sheet height * 0.29 — golden vertical
    overflow: 'hidden',
    backgroundColor: '#E8E4D6',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  f6HeroImg: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  f6Arch: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 160,
    bottom: 0,
  },
  f6ArchSvg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  f6ArchBody: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 60,
    bottom: 0,
    backgroundColor: T.paper,
    paddingTop: DS.sp6,
  },
  f6Close: {
    position: 'absolute',
    top: DS.sp5,
    left: DS.sp5,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  f6MailBadge: {
    position: 'absolute',
    top: -22,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 3,
  },
  f6MailCircle: {
    width: 68,            // 42 * φ = 68 for balanced hierarchy
    height: 68,
    borderRadius: 34,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: T.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  f6ScrollBody: {
    paddingTop: 48,
    paddingHorizontal: DS.sp7,
    paddingBottom: DS.sp8,
    alignItems: 'stretch',
  },
  f6Title: {
    fontSize: DS.fs_pageTitle,
    fontWeight: DS.fw_bold,
    color: T.forest,
    textAlign: 'center',
    fontStyle: 'italic',
    letterSpacing: 0.3,
  },
  f6Body: {
    fontSize: DS.fs_body,
    color: T.textSecondary,
    textAlign: 'center',
    marginTop: DS.sp3,
    lineHeight: 22,
    paddingHorizontal: DS.sp5,
  },
  f6InputLabel: {
    fontSize: DS.fs_label,
    fontWeight: DS.fw_bold,
    color: T.forest,
    marginTop: DS.sp7,
    marginBottom: DS.sp2,
    letterSpacing: 0.3,
  },
  f6InputWrap: {
    height: 52,
    borderRadius: DS.rad_pill,
    backgroundColor: T.inputBg,
    borderWidth: 1,
    borderColor: T.inputBorder,
    paddingHorizontal: DS.sp5,
    justifyContent: 'center',
  },
  f6Input: {
    fontSize: DS.fs_body,
    color: T.textPrimary,
    paddingVertical: 0,
  },
  f6Err: {
    fontSize: DS.fs_meta,
    color: T.danger,
    marginTop: DS.sp2,
    marginLeft: DS.sp3,
  },
  f6Send: {
    height: 56,
    borderRadius: DS.rad_pill,
    backgroundColor: T.forestActive,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: DS.sp2,
    marginTop: DS.sp6,
  },
  f6SendText: {
    color: '#fff',
    fontSize: DS.fs_cardName,
    fontWeight: DS.fw_bold,
    letterSpacing: 0.2,
  },
  f6Cancel: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: DS.sp2,
  },
  f6CancelText: {
    color: T.forest,
    fontSize: DS.fs_body,
    fontWeight: DS.fw_semibold,
  },

  // ── Bottom nav (matches Home) ─────────────────────────────────────────────
  bottomNav: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    height: 85,
    paddingBottom: DS.sp5,
    backgroundColor: '#F4EFE6',
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 50,
  },
  bottomNavItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: DS.sp1,
  },
  bottomNavIcon: {
    width: 24,
    height: 24,
  },
  bottomNavLabel: {
    fontSize: DS.fs_caption,
    fontWeight: DS.fw_medium,
    color: '#143D35',
    marginTop: DS.sp1,
    letterSpacing: 0.2,
  },
  bottomNavLabelActive: {
    fontWeight: DS.fw_bold,
  },

  // ── Profile modal ─────────────────────────────────────────────────────────
  profileOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: DS.sp6,
    zIndex: 100,
  },
  profileCard: {
    backgroundColor: T.paper,
    borderRadius: DS.rad_lg,
    padding: DS.sp5,
    width: '100%',
    maxWidth: 340,
  },
  profileStat: {
    fontSize: DS.fs_headerTitle,
    fontWeight: DS.fw_bold,
    color: T.textPrimary,
  },
  profileStatLabel: {
    fontSize: DS.fs_meta,
    color: T.textSecondary,
  },
  profileClose: {
    backgroundColor: T.forestActive,
    paddingVertical: DS.sp3,
    borderRadius: DS.rad_pill,
    marginTop: DS.sp3,
  },
  profileCloseText: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: DS.fw_semibold,
    fontSize: DS.fs_body,
  },
});
