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
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import Svg, { Path } from 'react-native-svg';
import {
  useFriendStore, sendFriendRequest, fetchFriendRequests,
  acceptFriendRequestAPI, rejectFriendRequestAPI, blockUser, fetchFriendProfile,
  fetchOutboundRequests, cancelOutboundRequest,
  type OutboundRequest, type FriendProfile,
} from '../store/useFriendStore';
import { useMarkerStore } from '../store/useMarkerStore';
import { useAppearance } from '../hooks/useAppearance';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { Icon, type IconName } from '../components/Icon';
import { CairnIcon } from '../components/CairnIcon';

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
  '#476D5C', '#64756C', '#617A83', '#8A765F',
  '#6F8268', '#826F73', '#687078', '#78806B',
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

// ── Background: cream + optional footprints illustration ────────────────────
// The illustration asset is 1170x2532 (iPhone @3x). We render it as an <Image>
// with `resizeMode='cover'` filling the full screen so it does not squash or
// display at its natural pixel size.
// R21 (2026-08-17): Friends bg now has day + night variants driven by
// useAppearance. Auto mode follows local time; user-set Light/Dark overrides.
function Backdrop() {
  const { isDark } = useAppearance();
  const daySrc = require('../../assets/home/gate1/home-world-b-day-3x.jpg');
  const nightSrc = require('../../assets/home/gate1/home-world-b-night-3x.jpg');
  const srcModule = isDark ? nightSrc : daySrc;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? '#141C1F' : '#F1F2EA' }]}>
      <Image
        source={srcModule}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', opacity: isDark ? 0.78 : 0.78 }}
        resizeMode="cover"
      />
      <LinearGradient
        colors={isDark
          ? ['rgba(20,28,31,0.08)', 'rgba(20,28,31,0.24)', '#141C1F', '#141C1F']
          : ['rgba(24,46,42,0.06)', 'rgba(241,242,234,0.12)', '#F1F2EA', '#F1F2EA']}
        locations={[0, 0.19, 0.43, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

// ── Tabs: two independent pill buttons (concept F0/F1/F2 — the pills are
// separate, not joined inside a single container).
function TabsPill({ active, onChange }: { active: 'friends' | 'pending'; onChange: (t: 'friends' | 'pending') => void }) {
  const theme = useVisualTheme();
  const idleMaterial = theme.mode === 'night' ? 'rgba(27,36,40,0.58)' : 'rgba(246,248,243,0.58)';
  return (
    <View style={s.tabsRow}>
      <TouchableOpacity
        style={[s.tabPill, active === 'friends' ? { backgroundColor: theme.primary } : { backgroundColor: idleMaterial, borderWidth: 1, borderColor: theme.border }]}
        activeOpacity={0.85}
        onPress={() => onChange('friends')}
        accessibilityRole="button"
        accessibilityLabel="Friends tab"
      >
        <Text style={[s.tabLabel, { color: active === 'friends' ? theme.onPrimary : theme.foreground }]}>Friends</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[s.tabPill, active === 'pending' ? { backgroundColor: theme.primary } : { backgroundColor: idleMaterial, borderWidth: 1, borderColor: theme.border }]}
        activeOpacity={0.85}
        onPress={() => onChange('pending')}
        accessibilityRole="button"
        accessibilityLabel="Pending tab"
      >
        <Text style={[s.tabLabel, { color: active === 'pending' ? theme.onPrimary : theme.foreground }]}>Pending</Text>
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
  const theme = useVisualTheme();
  const meta = sharedFlags > 0
    ? `${sharedFlags} shared ${sharedFlags === 1 ? 'flag' : 'flags'}`
    : 'No shared flags yet';
  const rowSurface = theme.mode === 'night' ? 'rgba(29,38,42,0.76)' : 'rgba(250,251,247,0.80)';
  return (
    <TouchableOpacity
      style={[s.card, { backgroundColor: rowSurface, borderColor: theme.border }]}
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
        <Text style={[s.cardName, { color: theme.foreground }]} numberOfLines={1}>{name}</Text>
        <Text style={[s.cardMeta, { color: theme.foregroundSecondary }]} numberOfLines={1}>{meta}</Text>
      </View>
      <CairnIcon name="otherTrace" size={20} color={theme.iconInactive} accent={theme.iconActive} />
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
  const theme = useVisualTheme();
  return (
    <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID={`incoming-card-${id}`}>
      <View style={[s.avatar, { backgroundColor: avatarColorFor(id) }]}>
        <Text style={s.avatarText}>{initialsOf(fromName)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.cardName, { color: theme.foreground }]} numberOfLines={1}>{fromName}</Text>
        <Text style={[s.cardMeta, { color: theme.foregroundSecondary }]} numberOfLines={1}>{fromEmail}</Text>
      </View>
      <View style={s.actionRow}>
        <TouchableOpacity
          style={s.actionBtn}
          onPress={onAccept}
          disabled={busy}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 4 }}
          accessibilityLabel="Accept friend request"
        >
          {busy ? <ActivityIndicator size="small" color={theme.iconActive} /> : <Icon name="Check" size={DS.ic_sm} color={theme.iconActive} strokeWidth={2} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={s.actionBtn}
          onPress={onReject}
          disabled={busy}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 6 }}
          accessibilityLabel="Decline friend request"
        >
          <Icon name="X" size={DS.ic_sm} color={theme.destructive} strokeWidth={2} />
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
  const theme = useVisualTheme();
  return (
    <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID={`sent-card-${id}`}>
      <View style={[s.avatar, { backgroundColor: avatarColorFor(id) }]}>
        <Text style={s.avatarText}>{initialsOf(toName)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.cardName, { color: theme.foreground }]} numberOfLines={1}>{toName}</Text>
        <Text style={[s.cardMeta, { color: theme.foregroundSecondary }]} numberOfLines={1}>Waiting for response</Text>
      </View>
      <TouchableOpacity
        style={s.actionBtn}
        onPress={onCancel}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Cancel outbound request"
        testID={`btn-cancel-outbound-${id}`}
      >
        <Icon name="Timer" size={DS.ic_sm} color={theme.icon} strokeWidth={1.9} />
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
  const theme = useVisualTheme();
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
    ? require('../../assets/friends/hero/gate2/add-friend-world-a-night.jpg')
    : require('../../assets/friends/hero/gate2/add-friend-world-a-day.jpg');
  const birdWebUri =
    Platform.OS === 'web'
      ? (birdIsDark
          ? '/assets/?unstable_path=./assets/friends/hero/gate2/add-friend-world-a-night.jpg'
          : '/assets/?unstable_path=./assets/friends/hero/gate2/add-friend-world-a-day.jpg')
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
      <Animated.View style={[s.f6Sheet, { backgroundColor: birdIsDark ? '#182126' : theme.background, transform: [{ translateY: slide }] }]}>
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
              fill={birdIsDark ? '#182126' : theme.background}
            />
          </Svg>

          <View style={[s.f6ArchBody, { backgroundColor: birdIsDark ? '#182126' : theme.background }]}>
            {/* Mail badge — sits at arch peak (SVG dome crest) */}
            <View style={s.f6MailBadge}>
              <View style={[s.f6MailCircle, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
                <Icon name="Mail" size={DS.ic_md} color={theme.iconActive} strokeWidth={1.9} />
              </View>
            </View>

            <ScrollView
              contentContainerStyle={s.f6ScrollBody}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={[s.f6Title, { color: theme.foreground }]}>Add a Friend</Text>
              <Text style={[s.f6Body, { color: theme.foregroundSecondary }]}>
                {state === 'success'
                  ? `Request sent to ${successEmail.current}`
                  : 'Enter their email address to\nsend a friend request.'}
              </Text>

              {state !== 'success' && (
                <>
                  <Text style={[s.f6InputLabel, { color: theme.foregroundSecondary }]}>Email Address</Text>
                  <View style={[s.f6InputWrap, { backgroundColor: theme.surface, borderColor: err ? theme.destructive : theme.border }]}>
                    <TextInput
                      style={[s.f6Input, { color: theme.foreground }]}
                      placeholder="name@email.com"
                      placeholderTextColor={theme.muted}
                      value={email}
                      onChangeText={(t) => { setEmail(t); if (err) setErr(''); }}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      editable={state !== 'loading'}
                    />
                  </View>
                  {!!err && <Text style={s.f6Err}>{err}</Text>}

                  <TouchableOpacity
                    style={[s.f6Send, { backgroundColor: theme.primary }, (!email.trim() || state === 'loading') && { opacity: 0.55 }]}
                    onPress={submit}
                    disabled={!email.trim() || state === 'loading'}
                    activeOpacity={0.9}
                  >
                    {state === 'loading'
                      ? <ActivityIndicator size="small" color={theme.onPrimary} />
                      : (
                        <>
                          <Icon name="Send" size={DS.ic_sm} color={theme.onPrimary} strokeWidth={1.9} />
                          <Text style={[s.f6SendText, { color: theme.onPrimary }]}>Send Request</Text>
                        </>
                      )}
                  </TouchableOpacity>

                  <TouchableOpacity style={s.f6Cancel} onPress={close} activeOpacity={0.7}>
                    <Text style={[s.f6CancelText, { color: theme.foregroundSecondary }]}>Cancel</Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        </View>

        {/* Close X — top-left over hero */}
        <TouchableOpacity
          style={[s.f6Close, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
          onPress={close}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Close"
          accessibilityRole="button"
        >
          <Icon name="X" size={DS.ic_md} color={theme.icon} strokeWidth={1.9} />
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// ── Bottom navigation: same vector geometry and semantic colors as Home.
function BottomNav({ active, onNavigate }: { active: 'trails' | 'friends' | 'memory' | 'settings'; onNavigate: (dest: string) => void }) {
  const theme = useVisualTheme();
  const items = [
    { key: 'trails' as const, route: 'Routes', label: 'Trails', icon: 'Route' as IconName },
    { key: 'friends' as const, route: 'Friends', label: 'Friends', icon: 'Users' as IconName },
    { key: 'memory' as const, route: 'Memory', label: 'Memory', icon: 'Layers' as IconName },
    { key: 'settings' as const, route: 'Settings', label: 'Settings', icon: 'Cog' as IconName },
  ];
  return (
    <View style={[s.bottomNav, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {items.map((it) => (
        <TouchableOpacity
          key={it.key}
          style={s.bottomNavItem}
          activeOpacity={0.8}
          onPress={() => onNavigate(it.route)}
        >
          <Icon name={it.icon} size={22} color={it.key === active ? theme.iconActive : theme.iconInactive} strokeWidth={1.9} />
          <Text style={[s.bottomNavLabel, { color: it.key === active ? theme.iconActive : theme.iconInactive }]}>{it.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
export function FriendsScreen() {
  const theme = useVisualTheme();
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
      sharedFlags: (f as typeof f & { sharedFlags?: number }).sharedFlags ?? 0,
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
    <View style={[s.root, { backgroundColor: theme.background }]}>
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
          <Icon name="ChevronLeft" size={DS.ic_md} color={theme.onScenic} strokeWidth={1.9} />
        </TouchableOpacity>
        <View style={s.titleBlock}>
          <Text style={[s.hTitle, { color: theme.onScenic }]}>Friends</Text>
          <Text style={[s.hSubtitle, { color: theme.onScenicMuted }]}>Paths that cross yours</Text>
        </View>
        <TouchableOpacity
          style={s.hIcon}
          onPress={() => setShowAdd(true)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Add friend"
          accessibilityRole="button"
        >
          <Icon name="Plus" size={DS.ic_md} color={theme.onScenic} strokeWidth={1.9} />
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
            <View style={s.emptyTrace} pointerEvents="none">
              <View style={[s.emptyTraceLine, { backgroundColor: theme.border }]} />
              <View style={[s.emptyTraceNode, s.emptyTraceNodeLeft, { borderColor: theme.iconInactive }]} />
              <View style={[s.emptyTraceNode, s.emptyTraceNodeRight, { backgroundColor: theme.iconActive, borderColor: theme.iconActive }]} />
            </View>
            <View style={[s.emptyIconMark, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
              <CairnIcon name="friends" size={32} color={theme.iconActive} accent={theme.accent} active />
            </View>
            <View style={s.emptyTextGroup}>
              <Text style={[s.emptyEyebrow, { color: theme.foregroundSecondary }]}>QUIETLY CONNECTED</Text>
              <Text style={[s.emptyTitle, { color: theme.foreground }]}>No friends yet</Text>
              <Text style={[s.emptyBody, { color: theme.foregroundSecondary }]}>Add a friend by email to see where your paths cross.</Text>
            </View>
          </View>
        )}
        {tab === 'friends' && hasFriends && (
          <>
            <Text style={[s.sectionTitle, { color: theme.foregroundSecondary }]}>YOUR CIRCLE · {friends.length}</Text>
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
            <View style={[s.emptyIconRing, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Icon name="Mail" size={DS.ic_lg} color={theme.iconActive} strokeWidth={1.8} />
            </View>
            <View style={[s.emptyTextCard, { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1 }]}>
              <Text style={[s.emptyTitle, { color: theme.foreground }]}>No pending requests</Text>
              <Text style={[s.emptyBody, { color: theme.foregroundSecondary }]}>New requests and sent invites will appear here.</Text>
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
          style={[s.floatingAdd, { backgroundColor: theme.primary }]}
          onPress={() => setShowAdd(true)}
          activeOpacity={0.9}
          accessibilityLabel="Add a Friend"
          accessibilityRole="button"
        >
          <Icon name="Plus" size={DS.ic_sm} color={theme.onPrimary} strokeWidth={2} />
          <Text style={[s.floatingAddText, { color: theme.onPrimary }]}>Add a Friend</Text>
        </TouchableOpacity>
      )}

      {/* Empty-state large CTA */}
      {((tab === 'friends' && !hasFriends) || (tab === 'pending' && pendingEmpty)) && (
        <TouchableOpacity
          style={[s.floatingAdd, { backgroundColor: theme.primary }]}
          onPress={() => setShowAdd(true)}
          activeOpacity={0.9}
          accessibilityLabel="Add a Friend"
          accessibilityRole="button"
        >
          <Icon name="Plus" size={DS.ic_sm} color={theme.onPrimary} strokeWidth={2} />
          <Text style={[s.floatingAddText, { color: theme.onPrimary }]}>Add a Friend</Text>
        </TouchableOpacity>
      )}

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
    height: 54,
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
    color: '#fff',
    letterSpacing: -0.25,
  },
  titleBlock: { alignItems: 'center', gap: 2 },
  hSubtitle: { fontSize: 11, fontWeight: '500', letterSpacing: 0.45 },

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
    paddingBottom: 112,
    gap: DS.sp3,
  },

  sectionTitle: {
    fontSize: 10,
    fontWeight: DS.fw_semibold,
    color: T.forest,
    paddingHorizontal: DS.sp1,
    paddingBottom: DS.sp2,
    letterSpacing: 1.25,
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
    minHeight: 64,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.cardBorder,
    borderRadius: 16,
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
    paddingTop: 82,
    gap: DS.sp3,
  },
  // Retained for the Pending empty state; the Friends empty state uses the
  // quieter shared-trace composition below.
  emptyIconRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: DS.sp3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  emptyTrace: {
    width: 176,
    height: 28,
    justifyContent: 'center',
    marginBottom: -18,
  },
  emptyTraceLine: {
    height: 1,
    marginHorizontal: 18,
    transform: [{ rotate: '-5deg' }],
  },
  emptyTraceNode: {
    position: 'absolute',
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1,
  },
  emptyTraceNodeLeft: { left: 14, top: 14 },
  emptyTraceNodeRight: { right: 14, top: 6 },
  emptyIconMark: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 2,
  },
  emptyTextGroup: {
    alignItems: 'center',
    maxWidth: 272,
    paddingTop: DS.sp3,
  },
  emptyEyebrow: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: DS.fw_semibold,
    letterSpacing: 1.55,
    marginBottom: DS.sp2,
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
    bottom: 34,
    height: 48,
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
    borderWidth: 1,
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
