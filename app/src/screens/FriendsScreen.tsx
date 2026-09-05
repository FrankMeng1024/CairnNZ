/**
 * FriendsScreen — R114/O25 visual redesign.
 *
 * 100% aligned to Cairn_Friends_FINAL concept (spec.json, 375x812 baseline):
 * - Paper-cream background with footprint / clean illustration layer
 * - Compact header with one persistent Add friend action
 * - Friends / Requests primary navigation
 * - F0 Friends empty | F1 Friends list | F2 Requests both | F3 Received only |
 *   F4 Sent only | F5 Requests empty | F6 Add-friend sheet
 * - Bottom nav bar reused visually (Trails / Friends / Memory / Settings)
 * - Store logic (useFriendStore + requests) preserved intact from previous version.
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  Animated, Easing, ActivityIndicator,
  Keyboard, KeyboardAvoidingView, Platform, TouchableWithoutFeedback,
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
  fetchOutboundRequests, cancelOutboundRequest, removeFriendAPI,
  type OutboundRequest, type FriendProfile,
} from '../store/useFriendStore';
import { useMarkerStore } from '../store/useMarkerStore';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { Icon, type IconName } from '../components/Icon';
import { CairnIcon } from '../components/CairnIcon';
import { SegmentedControl } from '../components/SegmentedControl';
import { PrimaryButton } from '../components/PrimaryButton';
import { StateSurface } from '../components/StateSurface';
import { TextField } from '../components/TextField';
import { ContentSurface } from '../components/ContentSurface';
import { DismissButton } from '../components/DismissButton';
import { ModalCard, ModalCardHeader } from '../components/ModalCard';
import { Colors, FontSize, IconSize, Radius, Shadow, Spacing } from '../components/tokens';
import { deriveFriendsRequestContentState } from '../utils/friendsRequestState';

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
  textPrimary: Colors.textPrimary,
  textSecondary: Colors.textSecondary,
  card: Colors.surface,
  cardBorder: Colors.border,
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
function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
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
  id, name, email, onPress, onLongPress,
}: {
  id: string; name: string; email: string;
  onPress?: () => void; onLongPress?: () => void;
}) {
  const theme = useVisualTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={500}
      activeOpacity={0.85}
      testID={`friend-card-${id}`}
    >
      <ContentSurface style={s.card}>
        <View style={[s.avatar, { backgroundColor: avatarColorFor(id) }]}>
          <Text style={s.avatarText}>{initialsOf(name)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.cardName, { color: theme.foreground }]} numberOfLines={1}>{name}</Text>
          <Text style={[s.cardMeta, { color: theme.foregroundSecondary }]} numberOfLines={1}>{email}</Text>
        </View>
        <Icon name="ChevronRight" size={IconSize.sm} color={theme.iconInactive} strokeWidth={1.8} />
      </ContentSurface>
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
    <ContentSurface style={s.card} testID={`incoming-card-${id}`}>
      <View style={[s.avatar, { backgroundColor: avatarColorFor(id) }]}>
        <Text style={s.avatarText}>{initialsOf(fromName)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.cardName, { color: theme.foreground }]} numberOfLines={1}>{fromName}</Text>
        <Text style={[s.cardMeta, { color: theme.foregroundSecondary }]} numberOfLines={1}>{fromEmail}</Text>
      </View>
      <View style={s.actionRow}>
        <TouchableOpacity
          style={[s.actionBtn, { backgroundColor: theme.recordSelected, borderColor: theme.borderSubtle }]}
          onPress={onAccept}
          disabled={busy}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 4 }}
          accessibilityLabel="Accept friend request"
        >
          {busy ? <ActivityIndicator size="small" color={theme.iconActive} /> : <Icon name="Check" size={DS.ic_sm} color={theme.iconActive} strokeWidth={2} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.actionBtn, { backgroundColor: theme.secondaryAction, borderColor: theme.borderSubtle }]}
          onPress={onReject}
          disabled={busy}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 6 }}
          accessibilityLabel="Decline friend request"
        >
          <Icon name="X" size={DS.ic_sm} color={theme.icon} strokeWidth={2} />
        </TouchableOpacity>
      </View>
    </ContentSurface>
  );
}

// ── Sent (outbound) request row (F2/F4) ─────────────────────────────────────
function SentRow({
  id, toName, toEmail, onCancel,
}: {
  id: string; toName: string; toEmail: string; onCancel: () => void;
}) {
  const theme = useVisualTheme();
  return (
    <ContentSurface style={s.card} testID={`sent-card-${id}`}>
      <View style={[s.avatar, { backgroundColor: avatarColorFor(id) }]}>
        <Text style={s.avatarText}>{initialsOf(toName)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.cardName, { color: theme.foreground }]} numberOfLines={1}>{toName}</Text>
        <Text style={[s.cardMeta, { color: theme.foregroundSecondary }]} numberOfLines={1}>{toEmail}</Text>
      </View>
      <TouchableOpacity
        style={[s.sentCancel, { backgroundColor: theme.secondaryAction, borderColor: theme.borderSubtle }]}
        onPress={onCancel}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Cancel outbound request"
        testID={`btn-cancel-outbound-${id}`}
      >
        <Text style={[s.sentCancelText, { color: theme.foregroundSecondary }]}>Cancel request</Text>
      </TouchableOpacity>
    </ContentSurface>
  );
}

// ── Add-friend rising sheet (F6, per concept) ───────────────────────────────
// Concept: NOT a full-screen page. A tall arched sheet that rises from the
// bottom, covers ~80% of the screen but leaves a strip of the underlying
// footprint background visible on top. Tap the visible strip to dismiss.
// Bird hero sits ONLY in the top-right of the sheet — it does not fill the
// whole hero area; the rest of the sheet's top curve remains soft paper.
type AddState = 'idle' | 'loading' | 'error';

function AddFriendPage({ onDismiss, onRequestSent }: { onDismiss: () => void; onRequestSent: () => void }) {
  const theme = useVisualTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [state, setState] = useState<AddState>('idle');
  const keyboardActive = useRef(false);
  const closing = useRef(false);

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

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, () => { keyboardActive.current = true; });
    const hideSubscription = Keyboard.addListener(hideEvent, () => { keyboardActive.current = false; });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const dismissKeyboard = () => {
    Keyboard.dismiss();
    keyboardActive.current = false;
  };

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    dismissKeyboard();
    Animated.parallel([
      Animated.timing(slide, { toValue: SHEET_TRAVEL, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(scrim, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => onDismiss());
  };

  const handleBackdropPress = () => {
    if (keyboardActive.current) {
      dismissKeyboard();
      return;
    }
    close();
  };

  const submit = async () => {
    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) { setErr('Enter a valid email address.'); return; }
    dismissKeyboard();
    setErr('');
    setState('loading');
    const r = await sendFriendRequest(trimmed);
    if (r.success) {
      onRequestSent();
      close();
    } else {
      const raw = (r.error || '').toLowerCase();
      let msg: string;
      if (raw.includes('not found') || raw.includes('no user') || raw.includes('does not exist')) {
        msg = 'No CairnNZ account uses that email yet.';
      } else if (raw.includes('already') && (raw.includes('friend') || raw.includes('request'))) {
        msg = 'You already sent a request or are friends with this person.';
      } else if (raw.includes('yourself') || raw.includes('self')) {
        msg = 'You can’t send a request to your own account.';
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
        backgroundColor: theme.readabilityScrim,
      }]}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={handleBackdropPress}
          accessibilityLabel="Dismiss keyboard or close add friend sheet"
        />
      </Animated.View>

      {/* Rising sheet */}
      <Animated.View style={[s.f6Sheet, {
        backgroundColor: theme.sheetSurface,
        borderColor: theme.borderStrong,
        paddingBottom: Math.max(insets.bottom, Spacing.lg),
        transform: [{ translateY: slide }],
      }]} testID="add-friend-sheet">
        <TouchableWithoutFeedback onPress={dismissKeyboard} accessible={false}>
          <KeyboardAvoidingView
            style={s.f6Keyboard}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={0}
          >
        {/* HERO — landscape asset fills the top of the sheet */}
          <View
            style={[s.f6HeroBox, { backgroundColor: theme.backgroundElevated }]}
            pointerEvents="none"
            testID="add-friend-artwork"
          >
          <Image
            source={birdWebUri ? { uri: birdWebUri } : birdModule}
            style={s.f6HeroImg}
            resizeMode="cover"
          />
          {birdIsNight ? (
            <LinearGradient
              colors={theme.scenicHeroOverlay}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
        </View>

        {/* Arched paper — SVG dome cutout on top edge so it reads as a true
            semi-circular dome (concave curve), not just rounded corners. */}
        <View style={s.f6Arch} pointerEvents="box-none">
          <Svg
            width="100%"
            height={64}
            viewBox="0 0 390 64"
            preserveAspectRatio="none"
            style={s.f6ArchSvg}
            testID="add-friend-arch-shape"
          >
            {/* Low, broad dome keeps the scenic artwork present without
                turning the foreground transition into a dominant arch. */}
            <Path
              d="M 0,64 C 105,8 285,8 390,64 L 390,64 L 0,64 Z"
              fill={theme.sheetSurface}
            />
          </Svg>

          <View style={[s.f6ArchBody, { backgroundColor: theme.sheetSurface }]}>
            {/* Mail badge — sits at arch peak (SVG dome crest) */}
            <View style={s.f6MailBadge}>
              <View style={[s.f6MailCircle, {
                backgroundColor: theme.modalSurface,
                borderColor: theme.borderSubtle,
                shadowColor: theme.shadow,
              }]}>
                <Icon name="Mail" size={DS.ic_md} color={theme.icon} strokeWidth={1.9} />
              </View>
            </View>

            <ScrollView
              contentContainerStyle={s.f6ScrollBody}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            >
              <Text style={[s.f6Title, { color: theme.foreground }]}>Add friend</Text>
              <Text style={[s.f6Body, { color: theme.foregroundSecondary }]}>
                Enter their email address to{`\n`}send a friend request.
              </Text>

              <TextField
                    label="Email address"
                    error={err}
                    placeholder="name@email.com"
                    value={email}
                    onChangeText={(text) => { setEmail(text); if (err) setErr(''); }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="send"
                    onSubmitEditing={submit}
                    onFocus={() => { keyboardActive.current = true; }}
                    disabled={state === 'loading'}
                    containerStyle={s.f6Field}
                    inputStyle={s.f6Input}
                    testID="add-friend-email"
              />
              <PrimaryButton
                    label="Send request"
                    onPress={submit}
                    disabled={!email.trim()}
                    loading={state === 'loading'}
                    variant="primary"
                    // Night expresses hierarchy through tonal elevation,
                    // not a full green block. The cool selected-control
                    // material carries the surface; pearl content stays
                    // primary, while PrimaryButton's semantic border keeps
                    // a restrained natural cue. Day and Sunset are unchanged.
                    tint={theme.mode === 'night' ? theme.controlSelected : undefined}
                    textColor={theme.mode === 'night' ? theme.textPrimary : undefined}
                    renderIcon={(color) => <Icon name="Send" size={DS.ic_sm} color={color} strokeWidth={2} />}
                    style={s.f6Send}
              />
            </ScrollView>
          </View>
        </View>

        {/* Shared dismiss convention: sheets close from the top-right. */}
        <DismissButton
          style={s.f6Close}
          onPress={close}
          label="Close add friend"
          contained
          testID="add-friend-close"
        />
          </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
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
  const [removeConfirming, setRemoveConfirming] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [cancelRequestTarget, setCancelRequestTarget] = useState<OutboundRequest | null>(null);
  const [cancelRequestBusy, setCancelRequestBusy] = useState(false);
  const [cancelRequestError, setCancelRequestError] = useState('');
  const [friendActionTarget, setFriendActionTarget] = useState<{ id: string; name: string; email: string } | null>(null);
  const [blockConfirming, setBlockConfirming] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [blockError, setBlockError] = useState('');

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
    setCancelRequestError('');
    setCancelRequestTarget(req);
  };

  const confirmCancelOutbound = async () => {
    if (!cancelRequestTarget || cancelRequestBusy) return;
    setCancelRequestBusy(true);
    setCancelRequestError('');
    const ok = await cancelOutboundRequest(cancelRequestTarget.id);
    setCancelRequestBusy(false);
    if (!ok) {
      setCancelRequestError('Could not cancel this request. Try again.');
      return;
    }
    setOutbound((prev) => prev.filter((r) => r.id !== cancelRequestTarget.id));
    setCancelRequestTarget(null);
  };

  // Bug-4: tap → open profile detail sheet
  const handleFriendTap = async (friend: { id: string; name: string; email: string }) => {
    setRemoveConfirming(false);
    setRemoveBusy(false);
    setRemoveError('');
    setProfileFriend(friend);
    setProfileData(null);
    setProfileLoading(true);
    const p = await fetchFriendProfile(friend.id);
    setProfileData(p);
    setProfileLoading(false);
  };

  const handleFriendLongPress = (friend: { id: string; name: string; email: string }) => {
    setBlockConfirming(false);
    setBlockBusy(false);
    setBlockError('');
    setFriendActionTarget(friend);
  };

  const confirmBlockFriend = async () => {
    if (!friendActionTarget || blockBusy) return;
    setBlockBusy(true);
    setBlockError('');
    const result = await blockUser(friendActionTarget.id);
    setBlockBusy(false);
    if (result.error) {
      setBlockError(result.error);
      return;
    }
    setFriendActionTarget(null);
    setBlockConfirming(false);
    await loadFriendsFromBackend();
    void loadCircleMarkers();
  };

  const hasFriends = friends.length > 0;
  const hasIncoming = incoming.length > 0;
  const hasOutbound = outbound.length > 0;
  const requestContentState = deriveFriendsRequestContentState(incoming.length, outbound.length);
  const pendingEmpty = requestContentState === 'empty';
  const showReceived = requestContentState === 'received' || requestContentState === 'both';
  const showSent = requestContentState === 'sent' || requestContentState === 'both';

  const closeProfile = () => {
    if (removeBusy) return;
    setProfileFriend(null);
    setProfileData(null);
    setRemoveConfirming(false);
    setRemoveError('');
  };

  const confirmRemoveFriend = async () => {
    if (!profileFriend || removeBusy) return;
    setRemoveBusy(true);
    setRemoveError('');
    const result = await removeFriendAPI(profileFriend.id);
    setRemoveBusy(false);
    if (!result.success) {
      setRemoveError(result.error || 'Could not remove friend. Try again.');
      return;
    }
    setProfileFriend(null);
    setProfileData(null);
    setRemoveConfirming(false);
    setRemoveError('');
  };

  // State derivation follows spec F0..F5 (F6 handled via showAdd overlay):
  //   Friends tab + no friends              → F0 (clean bg + empty illustration)
  //   Friends tab + has friends             → F1 (footprints bg + list)
  //   Requests tab + received AND sent      → F2
  //   Requests tab + received only          → F3
  //   Requests tab + sent only              → F4
  //   Requests tab + neither                → F5 (clean bg)
  // Both primary tabs retain the scenic Friends backdrop.
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
        </View>
        <View style={s.hIcon} accessible={false} />
      </View>

      {/* Tabs */}
      <SegmentedControl
        value={tab}
        onChange={(value) => setTab(value as 'friends' | 'pending')}
        segments={[{ key: 'friends', label: 'Friends' }, { key: 'pending', label: 'Requests' }]}
        containerStyle={s.tabsRow}
        testID="friends-tabs"
      />

      {/* Content */}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        pointerEvents={showAdd ? 'none' : 'auto'}
        testID="friends-content"
      >
        {initialLoading && !hasFriends && !hasIncoming && !hasOutbound && (
          <StateSurface
            variant="loading"
            title="Loading friends…"
            material="embedded"
            alignment="center"
            style={s.loadingBlock}
            testID="friends-loading-state"
          />
        )}
        {/* Friends tab */}
        {!initialLoading && tab === 'friends' && !hasFriends && (
          <View style={s.emptyBlock}>
            <View style={[s.emptyIconMark, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
              <CairnIcon name="friends" size={IconSize.lg} color={theme.iconActive} accent={theme.accent} active />
            </View>
            <View style={s.emptyTextGroup}>
              <Text style={[s.emptyTitle, { color: theme.foreground }]}>No friends yet</Text>
              <Text style={[s.emptyBody, { color: theme.foregroundSecondary }]}>Add someone by email to connect on CairnNZ.</Text>
            </View>
          </View>
        )}
        {tab === 'friends' && hasFriends && (
          <>
            <Text style={[s.sectionTitle, { color: theme.foregroundSecondary }]}>{friends.length} {friends.length === 1 ? 'friend' : 'friends'}</Text>
            {friends.map((f) => (
              <FriendRow
                key={f.id}
                id={f.id}
                name={f.name}
                email={f.email}
                onPress={() => handleFriendTap({ id: f.id, name: f.name, email: f.email })}
                onLongPress={() => handleFriendLongPress({ id: f.id, name: f.name, email: f.email })}
              />
            ))}
          </>
        )}

        {/* Requests tab */}
        {!initialLoading && tab === 'pending' && pendingEmpty && (
          <View style={s.emptyBlock}>
            <View style={[s.emptyIconMark, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
              <Icon name="Mail" size={DS.ic_lg} color={theme.iconActive} strokeWidth={1.8} />
            </View>
            <View style={s.emptyTextGroup}>
              <Text style={[s.emptyTitle, { color: theme.foreground }]}>No friend requests</Text>
              <Text style={[s.emptyBody, { color: theme.foregroundSecondary }]}>Received and sent requests will appear here.</Text>
            </View>
          </View>
        )}
        {tab === 'pending' && !pendingEmpty && (
          <>
            {showReceived && (
              <>
                <Text style={[s.sectionTitle, { color: theme.foregroundSecondary }]}>Received · {incoming.length}</Text>
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
            {showSent && (
              <>
                <Text style={[s.sectionTitle, { marginTop: 20, color: theme.foregroundSecondary }]}>Sent · {outbound.length}</Text>
                {outbound.map((r) => (
                  <SentRow
                    key={r.id}
                    id={String(r.id)}
                    toName={r.toName}
                    toEmail={r.toEmail}
                    onCancel={() => handleCancelOutbound(r)}
                  />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* One stable primary action position across list, empty and loading states. */}
      {!initialLoading && !showAdd && (
        <PrimaryButton
          label="Add friend"
          onPress={() => setShowAdd(true)}
          variant="primary"
          renderIcon={(color) => <Icon name="Plus" size={DS.ic_sm} color={color} strokeWidth={2} />}
          style={[s.floatingAdd, { bottom: Math.max(insets.bottom, Spacing.xl) }]}
        />
      )}

      {/* Add-friend full-screen page */}
      {showAdd && (
        <AddFriendPage
          onDismiss={() => setShowAdd(false)}
          onRequestSent={() => { void loadRequests(); }}
        />
      )}

      {/* Friends-local profile composition; cross-product detail shells remain out of scope. */}
      {profileFriend && (
        <ModalCard visible onDismiss={closeProfile} testID="friend-profile-modal">
          <View style={s.profileHeaderRow}>
              <View style={[s.avatar, { backgroundColor: avatarColorFor(profileFriend.id) }]}>
                <Text style={s.avatarText}>{initialsOf(profileFriend.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.profileName, { color: theme.foreground }]}>{profileFriend.name}</Text>
                <Text style={[s.cardMeta, { color: theme.foregroundSecondary }]}>{profileFriend.email}</Text>
              </View>
              <DismissButton
                onPress={closeProfile}
                label="Close profile"
                testID="friend-profile-close"
              />
            </View>
            {profileLoading ? (
              <StateSurface
                variant="loading"
                title="Loading profile…"
                material="embedded"
                alignment="center"
                style={s.profileState}
              />
            ) : profileData ? (
              <View style={[s.profileStats, { borderColor: theme.borderSubtle }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={[s.profileStat, { color: theme.foreground }]}>{profileData.placesExplored}</Text>
                    <Text style={[s.profileStatLabel, { color: theme.foregroundSecondary }]}>
                      {profileData.placesExplored === 1 ? 'place explored' : 'places explored'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={[s.profileStat, { color: theme.foreground }]}>{profileData.cairnsPlanted}</Text>
                    <Text style={[s.profileStatLabel, { color: theme.foregroundSecondary }]}>
                      {profileData.cairnsPlanted === 1 ? 'cairn planted' : 'cairns planted'}
                    </Text>
                  </View>
                </View>
              </View>
            ) : (
              <StateSurface
                variant="unavailable"
                title="Profile unavailable"
                body="Try opening this profile again in a moment."
                material="embedded"
                alignment="center"
                style={s.profileState}
              />
            )}
            <View style={s.profileRemoveShell} testID="friend-profile-remove-region">
              {removeConfirming ? (
                <View style={s.removeConfirmation} testID="friend-profile-remove-confirmation">
                  <Text style={[s.removeWarning, { color: theme.foregroundSecondary }]}>
                    You’ll lose access to routes, cairns, and explored areas shared by this friend. Your own exploration won’t be affected.
                  </Text>
                  {removeError ? <Text style={[s.removeError, { color: theme.destructive }]}>{removeError}</Text> : null}
                  <PrimaryButton
                    label="Remove friend"
                    variant="destructive"
                    onPress={confirmRemoveFriend}
                    loading={removeBusy}
                    style={s.profileRemoveAction}
                    testID="friend-profile-remove-final"
                  />
                </View>
              ) : (
                <PrimaryButton
                  label="Remove friend"
                  variant="secondary"
                  onPress={() => setRemoveConfirming(true)}
                  style={s.profileRemoveAction}
                  testID="friend-profile-remove-trigger"
                />
              )}
            </View>
        </ModalCard>
      )}

      {cancelRequestTarget && (
        <ModalCard
          visible
          onDismiss={() => { if (!cancelRequestBusy) setCancelRequestTarget(null); }}
          dismissible={!cancelRequestBusy}
          testID="cancel-request-modal"
        >
          <ModalCardHeader
            title={`Cancel request to ${cancelRequestTarget.toName}?`}
            body="They won’t receive this friend request."
            onClose={() => setCancelRequestTarget(null)}
          />
          {cancelRequestError ? <Text style={[s.dialogError, { color: theme.destructive }]}>{cancelRequestError}</Text> : null}
          <View style={s.dialogActions}>
            <PrimaryButton label="Cancel request" variant="destructive" onPress={confirmCancelOutbound} loading={cancelRequestBusy} style={s.dialogAction} testID="cancel-request-confirm" />
          </View>
        </ModalCard>
      )}

      {friendActionTarget && (
        <ModalCard
          visible
          onDismiss={() => { if (!blockBusy) setFriendActionTarget(null); }}
          dismissible={!blockBusy}
          testID="friend-actions-modal"
        >
          <ModalCardHeader
            title={blockConfirming ? `Block ${firstNameOf(friendActionTarget.name)}?` : friendActionTarget.name}
            body={blockConfirming
              ? 'This friendship will end, and they will no longer see your public cairns. You can unblock them later in Settings.'
              : friendActionTarget.email}
            onClose={() => setFriendActionTarget(null)}
          />
          {blockError ? <Text style={[s.dialogError, { color: theme.destructive }]}>{blockError}</Text> : null}
          <View style={s.dialogActions}>
            {blockConfirming ? (
              <>
                <PrimaryButton label="Back" variant="secondary" onPress={() => setBlockConfirming(false)} style={s.dialogAction} />
                <PrimaryButton label={`Block ${firstNameOf(friendActionTarget.name)}`} variant="destructive" onPress={confirmBlockFriend} loading={blockBusy} style={s.dialogAction} />
              </>
            ) : (
              <>
                <PrimaryButton
                  label="View profile"
                  variant="primary"
                  onPress={() => {
                    const friend = friendActionTarget;
                    setFriendActionTarget(null);
                    void handleFriendTap(friend);
                  }}
                  style={s.dialogAction}
                />
                <PrimaryButton label="Block friend" variant="secondary" onPress={() => setBlockConfirming(true)} style={s.dialogAction} />
              </>
            )}
          </View>
        </ModalCard>
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
    paddingTop: Spacing.xxl,
    paddingBottom: 104,
    gap: DS.sp3,
  },

  loadingBlock: {
    paddingTop: 96,
  },

  sectionTitle: {
    fontSize: DS.fs_caption,
    fontWeight: DS.fw_semibold,
    color: T.forest,
    paddingHorizontal: DS.sp1,
    paddingBottom: DS.sp2,
    letterSpacing: 0.2,
  },
  // ── Cards (friend / incoming / sent) ─────────────────────────────────────
  card: {
    minHeight: 64,
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
    borderRadius: Radius.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sentCancel: {
    minHeight: 38,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sentCancelText: {
    fontSize: FontSize.small,
    fontWeight: DS.fw_semibold,
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
    ...Shadow.elevated,
  },

  // ── Add-friend rising sheet ───────────────────────────────────────────────
  f6Root: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 200,
  },
  f6Scrim: {
    ...StyleSheet.absoluteFillObject,
  },
  f6Sheet: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    // Leaves the primary tabs breathing room while still covering the first row.
    height: '80.2%',
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
    height: 180,
    overflow: 'hidden',
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
  },
  f6HeroImg: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    transform: [{ scale: 1.06 }],
  },
  f6Arch: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 108,
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
    top: 48,
    bottom: 0,
    paddingTop: Spacing.lg,
  },
  f6Close: {
    position: 'absolute',
    top: Spacing.base,
    right: Spacing.base,
    zIndex: 4,
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
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  f6Field: {
    marginTop: DS.sp6,
  },
  f6Input: {
    minHeight: 50,
    paddingHorizontal: DS.sp5,
  },
  f6Send: {
    marginTop: DS.sp6,
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
  profileStats: {
    paddingVertical: Spacing.base,
    borderTopWidth: 1,
    borderBottomWidth: 1,
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
  profileState: { paddingVertical: Spacing.base },
  profileRemoveShell: {
    marginTop: DS.sp3,
    paddingTop: Spacing.md,
  },
  profileRemoveAction: { width: '100%' },
  removeConfirmation: { gap: Spacing.md },
  removeWarning: { fontSize: FontSize.small, lineHeight: 19 },
  removeError: {
    fontSize: FontSize.small,
    lineHeight: 17,
  },
  dialogActions: {
    gap: Spacing.sm,
  },
  dialogAction: {
    width: '100%',
  },
  dialogError: {
    fontSize: FontSize.small,
    lineHeight: 18,
    marginBottom: Spacing.md,
  },
});
