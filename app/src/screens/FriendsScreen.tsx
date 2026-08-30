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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../navigation/RootNavigator';
import Svg, { Path } from 'react-native-svg';
import {
  useFriendStore, sendFriendRequest, fetchFriendRequests,
  acceptFriendRequestAPI, rejectFriendRequestAPI, blockUser, fetchFriendProfile,
  fetchOutboundRequests, cancelOutboundRequest,
  type OutboundRequest, type FriendProfile,
} from '../store/useFriendStore';
import { useMarkerStore } from '../store/useMarkerStore';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { Icon, type IconName } from '../components/Icon';
import { CairnIcon } from '../components/CairnIcon';
import { SegmentedControl } from '../components/SegmentedControl';
import { Colors, FontSize, IconSize, Radius, Shadow, Spacing } from '../components/tokens';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// ── Design system: golden-ratio driven tokens for consistency ──────────────
// Type scale (1.25 modular): 12 / 14 / 16 / 20 / 26 / 32
// Spacing scale (4/8/12/16/20/24/32/40 — 4 base)
// Icon sizes (unified 16 / 20 / 24 / 44)
// Radius scale (8 / 13 / 21 — Fibonacci)
const DS = {
  // Shared system aliases kept local to limit the Friends-only diff.
  fs_caption: FontSize.small,
  fs_meta: FontSize.caption,
  fs_body: FontSize.body,
  fs_label: FontSize.caption,
  fs_cardName: FontSize.body,
  fs_headerTitle: FontSize.h2,
  fs_emptyTitle: FontSize.h2,
  fs_pageTitle: 24,
  fw_medium: '500' as const,
  fw_semibold: '600' as const,
  fw_bold: '700' as const,
  sp1: Spacing.xs,
  sp2: Spacing.sm,
  sp3: Spacing.md,
  sp4: Spacing.base,
  sp5: Spacing.lg,
  sp6: Spacing.xl,
  sp7: Spacing.xxl,
  sp8: 40,
  ic_sm: IconSize.sm,
  ic_md: IconSize.md,
  ic_lg: IconSize.lg,
  contentPad: Spacing.base,
};

// ── Spec tokens (colors) ────────────────────────────────────────────────────
const T = {
  paper: Colors.bg,
  forest: Colors.primaryDark,
  forestActive: Colors.primary,
  textPrimary: Colors.textPrimary,
  textSecondary: Colors.textSecondary,
  card: Colors.surface,
  cardBorder: Colors.border,
  scrim: 'rgba(20,30,25,0.40)',
  inputBg: Colors.surface,
  inputBorder: Colors.border,
  danger: Colors.danger,
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
// Sunset deliberately reuses the locked Day world with a warm mineral dusk
// treatment. This creates a true third state without inventing new scenery.
function Backdrop() {
  const theme = useVisualTheme();
  const daySrc = require('../../assets/friends/backgrounds/friends-bg-day-semantic-v2.jpg');
  const nightSrc = require('../../assets/friends/backgrounds/friends-bg-night-semantic-v2.jpg');
  const isNight = theme.mode === 'night';
  const srcModule = isNight ? nightSrc : daySrc;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }]}>
      <Image
        source={srcModule}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', opacity: theme.scenicImageOpacity }}
        resizeMode="cover"
      />
      <LinearGradient
        colors={theme.scenicBackdropOverlay}
        locations={[0, 0.24, 0.58, 1]}
        style={StyleSheet.absoluteFill}
      />
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
  return (
    <TouchableOpacity
      style={[s.card, { backgroundColor: theme.scenicSurface, borderColor: theme.borderSubtle }]}
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
    <View style={[s.card, { backgroundColor: theme.surfacePrimary, borderColor: theme.borderSubtle }]} testID={`incoming-card-${id}`}>
      <View style={[s.avatar, { backgroundColor: avatarColorFor(id) }]}>
        <Text style={s.avatarText}>{initialsOf(fromName)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.cardName, { color: theme.foreground }]} numberOfLines={1}>{fromName}</Text>
        <Text style={[s.cardMeta, { color: theme.foregroundSecondary }]} numberOfLines={1}>{fromEmail}</Text>
      </View>
      <View style={s.actionRow}>
        <TouchableOpacity
          style={[s.actionBtn, { backgroundColor: theme.surfaceSecondary, borderColor: theme.borderSubtle }]}
          onPress={onAccept}
          disabled={busy}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 4 }}
          accessibilityLabel="Accept friend request"
        >
          {busy ? <ActivityIndicator size="small" color={theme.iconActive} /> : <Icon name="Check" size={DS.ic_sm} color={theme.iconActive} strokeWidth={2} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.actionBtn, { backgroundColor: theme.surfaceSecondary, borderColor: theme.borderSubtle }]}
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
    <View style={[s.card, { backgroundColor: theme.surfacePrimary, borderColor: theme.borderSubtle }]} testID={`sent-card-${id}`}>
      <View style={[s.avatar, { backgroundColor: avatarColorFor(id) }]}>
        <Text style={s.avatarText}>{initialsOf(toName)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.cardName, { color: theme.foreground }]} numberOfLines={1}>{toName}</Text>
        <Text style={[s.cardMeta, { color: theme.foregroundSecondary }]} numberOfLines={1}>Waiting for response</Text>
      </View>
      <TouchableOpacity
        style={[s.actionBtn, { backgroundColor: theme.surfaceSecondary, borderColor: theme.borderSubtle }]}
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
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [state, setState] = useState<AddState>('idle');
  const successEmail = useRef('');

  // Slide + scrim animation. Sheet starts fully off-screen and glides up.
  const SHEET_TRAVEL = 760;
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

  // Preserve the accepted bird/arch identity. Sunset uses the same Day
  // artwork with a restrained warm overlay so scenery never jumps worlds.
  const birdIsNight = theme.mode === 'night';
  const birdModule = birdIsNight
    ? require('../../assets/friends/hero/add-friend-hero-night-semantic-v2.jpg')
    : require('../../assets/friends/hero/add-friend-hero-day-semantic-v2.jpg');
  const birdWebUri =
    Platform.OS === 'web'
      ? (birdIsNight
          ? '/assets/?unstable_path=./assets/friends/hero/add-friend-hero-night-semantic-v2.jpg'
          : '/assets/?unstable_path=./assets/friends/hero/add-friend-hero-day-semantic-v2.jpg')
      : null;

  return (
    <View style={s.f6Root} pointerEvents="box-none">
      {/* Scrim behind sheet — the small strip above the sheet is tappable */}
      <Animated.View style={[s.f6Scrim, {
        opacity: scrim,
        backgroundColor: theme.scrim,
      }]}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={close}
          accessibilityLabel="Close add friend sheet"
        />
      </Animated.View>

      {/* Rising sheet */}
      <Animated.View style={[s.f6Sheet, {
        backgroundColor: theme.sheetSurface,
        borderColor: theme.borderSubtle,
        paddingBottom: Math.max(insets.bottom, Spacing.lg),
        transform: [{ translateY: slide }],
      }]}>
        <KeyboardAvoidingView
          style={s.f6Keyboard}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
        {/* HERO — landscape asset fills the top of the sheet */}
        <View style={s.f6HeroBox} pointerEvents="none">
          <Image
            source={birdWebUri ? { uri: birdWebUri } : birdModule}
            style={s.f6HeroImg}
            resizeMode="cover"
          />
          <LinearGradient
            colors={theme.scenicHeroOverlay}
            style={StyleSheet.absoluteFill}
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
              fill={theme.sheetSurface}
            />
          </Svg>

          <View style={[s.f6ArchBody, { backgroundColor: theme.sheetSurface }]}>
            {/* Mail badge — sits at arch peak (SVG dome crest) */}
            <View style={s.f6MailBadge}>
              <View style={[s.f6MailCircle, { backgroundColor: theme.modalSurface, borderColor: theme.borderSubtle }]}>
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
                  <View style={[s.f6InputWrap, { backgroundColor: theme.inputSurface, borderColor: err ? theme.destructive : theme.borderSubtle }]}>
                  <TextInput
                    style={[s.f6Input, { color: theme.foreground }]}
                      placeholder="name@email.com"
                      placeholderTextColor={theme.muted}
                      value={email}
                      onChangeText={(t) => { setEmail(t); if (err) setErr(''); }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="send"
                    onSubmitEditing={submit}
                    editable={state !== 'loading'}
                  />
                </View>
                  {!!err && <Text style={[s.f6Err, { color: theme.destructive }]}>{err}</Text>}

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
          style={[s.f6Close, { backgroundColor: theme.modalSurface, borderColor: theme.borderSubtle }]}
          onPress={close}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Close"
          accessibilityRole="button"
        >
          <Icon name="X" size={DS.ic_md} color={theme.icon} strokeWidth={1.9} />
        </TouchableOpacity>
        </KeyboardAvoidingView>
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
  const insets = useSafeAreaInsets();
  const headerColor = theme.scenicText;
  const nav = useNavigation<Nav>();
  const [tab, setTab] = useState<'friends' | 'pending'>('friends');
  const [showAdd, setShowAdd] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

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
    let active = true;
    Promise.all([loadFriendsFromBackend(), loadRequests()]).finally(() => {
      if (active) setInitialLoading(false);
    });
    return () => { active = false; };
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
      <View style={[s.header, { paddingTop: Math.max(insets.top, Spacing.md) }]}>
        <TouchableOpacity
          style={s.hIcon}
          onPress={() => nav.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Back"
          accessibilityRole="button"
        >
          <Icon name="ChevronLeft" size={DS.ic_md} color={headerColor} strokeWidth={1.9} />
        </TouchableOpacity>
        <View style={s.titleBlock}>
          <Text style={[s.hTitle, { color: headerColor }]}>Friends</Text>
          <Text style={[s.hSubtitle, { color: theme.scenicTextMuted }]}>Paths that cross yours</Text>
        </View>
        <TouchableOpacity
          style={s.hIcon}
          onPress={() => setShowAdd(true)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Add friend"
          accessibilityRole="button"
        >
          <Icon name="Plus" size={DS.ic_md} color={headerColor} strokeWidth={1.9} />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <SegmentedControl
        value={tab}
        onChange={setTab}
        segments={[{ key: 'friends', label: 'Friends' }, { key: 'pending', label: 'Pending' }]}
        containerStyle={s.tabsRow}
        testID="friends-tabs"
      />

      {/* Content */}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {initialLoading && !hasFriends && !hasIncoming && !hasOutbound && (
          <View style={s.loadingBlock} accessibilityLabel="Loading friends">
            <ActivityIndicator size="small" color={theme.iconActive} />
            <Text style={[s.loadingText, { color: theme.foregroundSecondary }]}>Checking your circle…</Text>
          </View>
        )}
        {/* Friends tab */}
        {!initialLoading && tab === 'friends' && !hasFriends && (
          <View style={s.emptyBlock}>
            <View style={[s.emptyIconMark, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
              <CairnIcon name="friends" size={IconSize.lg} color={theme.iconActive} accent={theme.accent} active />
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
        {!initialLoading && tab === 'pending' && pendingEmpty && (
          <View style={s.emptyBlock}>
            <View style={[s.emptyIconMark, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
              <Icon name="Mail" size={DS.ic_lg} color={theme.iconActive} strokeWidth={1.8} />
            </View>
            <View style={s.emptyTextGroup}>
              <Text style={[s.emptyTitle, { color: theme.foreground }]}>No pending requests</Text>
              <Text style={[s.emptyBody, { color: theme.foregroundSecondary }]}>New requests and sent invites will appear here.</Text>
            </View>
          </View>
        )}
        {tab === 'pending' && (hasIncoming || hasOutbound) && (
          <>
            {hasIncoming && (
              <>
                <Text style={[s.sectionTitle, { color: theme.foregroundSecondary }]}>INCOMING · {incoming.length}</Text>
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
              <Text style={[s.mutedNote, { color: theme.foregroundSecondary }]}>No incoming requests</Text>
            )}
            {hasOutbound && (
              <>
                <Text style={[s.sectionTitle, { marginTop: 20, color: theme.foregroundSecondary }]}>SENT · {outbound.length}</Text>
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
              <Text style={[s.mutedNote, { marginTop: 20, color: theme.foregroundSecondary }]}>No sent requests yet</Text>
            )}
          </>
        )}
      </ScrollView>

      {/* One stable primary action position across list, empty and loading states. */}
      {!initialLoading && (
        <TouchableOpacity
          style={[s.floatingAdd, { backgroundColor: theme.primary, bottom: Math.max(insets.bottom, Spacing.xl) }]}
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
        <View style={[s.profileOverlay, { backgroundColor: theme.scrim }]}>
          <View style={[s.profileCard, { backgroundColor: theme.modalSurface, borderColor: theme.borderSubtle }]}>
            <View style={s.profileHeaderRow}>
              <View style={[s.avatar, { backgroundColor: avatarColorFor(profileFriend.id) }]}>
                <Text style={s.avatarText}>{initialsOf(profileFriend.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.profileName, { color: theme.foreground }]}>{profileFriend.name}</Text>
                <Text style={[s.cardMeta, { color: theme.foregroundSecondary }]}>{profileFriend.email}</Text>
              </View>
              <TouchableOpacity
                style={[s.profileDismiss, { borderColor: theme.border }]}
                onPress={() => { setProfileFriend(null); setProfileData(null); }}
                accessibilityRole="button"
                accessibilityLabel="Close profile"
              >
                <Icon name="X" size={IconSize.sm} color={theme.icon} strokeWidth={2} />
              </TouchableOpacity>
            </View>
            {profileLoading ? (
              <ActivityIndicator color={theme.primary} style={{ marginVertical: 20 }} />
            ) : profileData ? (
              <View style={{ paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={[s.profileStat, { color: theme.foreground }]}>{profileData.hikeCount}</Text>
                    <Text style={[s.profileStatLabel, { color: theme.foregroundSecondary }]}>hikes</Text>
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={[s.profileStat, { color: theme.foreground }]}>{profileData.friendCount}</Text>
                    <Text style={[s.profileStatLabel, { color: theme.foregroundSecondary }]}>friends</Text>
                  </View>
                </View>
                {profileData.memberSince && (
                  <Text style={[s.cardMeta, { textAlign: 'center', marginTop: 8, color: theme.foregroundSecondary }]}>
                    Member since {new Date(profileData.memberSince).toLocaleDateString()}
                  </Text>
                )}
              </View>
            ) : (
              <Text style={[s.cardMeta, { textAlign: 'center', marginVertical: 20, color: theme.foregroundSecondary }]}>Profile unavailable.</Text>
            )}
            <TouchableOpacity
              testID="btn-close-profile"
              style={[s.profileClose, { backgroundColor: theme.surface, borderColor: theme.border }]}
              onPress={() => { setProfileFriend(null); setProfileData(null); }}
            >
              <Text style={[s.profileCloseText, { color: theme.foreground }]}>Done</Text>
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
    minHeight: 72,
    paddingHorizontal: DS.contentPad,
    paddingBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hTitle: {
    fontSize: DS.fs_headerTitle,
    fontWeight: DS.fw_bold,
    textAlign: 'center',
    letterSpacing: -0.25,
  },
  titleBlock: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hSubtitle: { marginTop: 2, fontSize: FontSize.small, fontWeight: DS.fw_medium, letterSpacing: 0.15 },

  // ── Tabs (centered, equal width, φ-related dimensions) ───────────────────
  tabsRow: {
    height: 44,
    width: 276,
    alignSelf: 'center',
    marginTop: Spacing.xs,
  },

  // ── Scroll body ──────────────────────────────────────────────────────────
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: DS.contentPad,
    paddingTop: Spacing.base,
    paddingBottom: 104,
    gap: DS.sp3,
  },

  loadingBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingTop: 96,
  },
  loadingText: { fontSize: FontSize.caption, fontWeight: '500' },

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
    borderRadius: Radius.card,
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
    paddingTop: 72,
    gap: DS.sp3,
  },
  emptyIconMark: {
    width: 56,
    height: 56,
    borderRadius: Radius.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.card,
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
    left: Spacing.lg,
    right: Spacing.lg,
    height: 48,
    backgroundColor: T.forestActive,
    borderRadius: Radius.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: DS.sp2,
    ...Shadow.elevated,
  },
  floatingAddText: {
    color: '#fff',
    fontSize: DS.fs_body,
    fontWeight: DS.fw_bold,
    letterSpacing: 0.2,
  },

  // ── Add-friend rising sheet ───────────────────────────────────────────────
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
    // Human review asked for a softer invitation surface, not a near-full
    // page takeover. The shorter detent keeps Friends visibly present.
    height: '74%',
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    borderWidth: 1,
    borderBottomWidth: 0,
    overflow: 'hidden',
    backgroundColor: T.paper,
    ...Shadow.sheet,
  },
  f6Keyboard: { flex: 1 },
  f6HeroBox: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 148,
    overflow: 'hidden',
    backgroundColor: '#E8E4D6',
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
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
    top: 94,
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
    top: 62,
    bottom: 0,
    backgroundColor: T.paper,
    paddingTop: Spacing.lg,
  },
  f6Close: {
    position: 'absolute',
    top: Spacing.base,
    left: Spacing.base,
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
    top: -14,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 3,
  },
  f6MailCircle: {
    width: 48,
    height: 48,
    borderRadius: Radius.card,
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
    paddingTop: 42,
    paddingHorizontal: DS.sp6,
    paddingBottom: DS.sp8,
    alignItems: 'stretch',
  },
  f6Title: {
    fontSize: DS.fs_pageTitle,
    fontWeight: DS.fw_semibold,
    color: T.forest,
    textAlign: 'center',
    letterSpacing: -0.25,
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
    fontWeight: DS.fw_semibold,
    color: T.forest,
    marginTop: DS.sp6,
    marginBottom: DS.sp2,
    letterSpacing: 0.3,
  },
  f6InputWrap: {
    height: 52,
    borderRadius: Radius.button,
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
    height: 52,
    borderRadius: Radius.button,
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
    borderRadius: Radius.card,
    borderWidth: 1,
    padding: DS.sp5,
    width: '100%',
    maxWidth: 340,
    ...Shadow.modal,
  },
  profileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.base,
  },
  profileName: {
    fontSize: FontSize.h3,
    fontWeight: '600',
  },
  profileDismiss: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    height: 48,
    borderWidth: 1,
    borderRadius: Radius.button,
    marginTop: DS.sp3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCloseText: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: DS.fw_semibold,
    fontSize: DS.fs_body,
  },
});
