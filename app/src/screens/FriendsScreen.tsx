/**
 * FriendsScreen — Sprint 19 uplift (STORY-00045)
 *
 * - Empty state: illustration + "No friends yet" + CTA
 * - Add-friend form: email validation, "Can't invite yourself", loading → success state
 * - Existing friends list unchanged; Add button works from both CTA and top-right
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Animated, Easing, ActivityIndicator,
  KeyboardAvoidingView, Platform,
  // O1 batch 37: Keyboard, TouchableWithoutFeedback removed — 0 JSX references.
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Colors, Spacing, Radius, FontSize, Shadow, IconSize } from '../components/tokens';
import { Icon } from '../components/Icon';
import { BackButton } from '../components/BackButton';
import { PressBtn } from '../components/PressBtn';
import { Alert } from 'react-native';
import { useFriendStore, sendFriendRequest, fetchFriendRequests, acceptFriendRequestAPI, rejectFriendRequestAPI, blockUser, fetchFriendProfile, fetchOutboundRequests, cancelOutboundRequest, type OutboundRequest, type FriendProfile } from '../store/useFriendStore';
import { useMarkerStore } from '../store/useMarkerStore';
import { EmptyFriends, IllustrationHalo } from '../components/Illustrations';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface Friend {
  id: string;
  name: string;
  email: string;
  initials: string;
  online: boolean;
  lastSeen: string;
  sharedMarkers: number;
  sharing: boolean;
}

// O1 batch 37: OWN_EMAIL removed — declared but never used.

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ── Spring press wrapper ────────────────────────────────────────────────────
function PressCard({
  onPress, style, children, scale = 0.98,
}: {
  onPress: () => void;
  style?: object | object[];
  children: React.ReactNode;
  scale?: number;
}) {
  const anim = useRef(new Animated.Value(1)).current;
  const onIn = () => Animated.spring(anim, { toValue: scale, useNativeDriver: true, tension: 300, friction: 10 }).start();
  const onOut = () => Animated.spring(anim, { toValue: 1, useNativeDriver: true, tension: 300, friction: 8 }).start();
  return (
    <Animated.View style={[{ transform: [{ scale: anim }] }, style]}>
      <TouchableOpacity onPress={onPress} onPressIn={onIn} onPressOut={onOut} activeOpacity={1}>
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}

// Derive status dot color: online=success, recent(<1h)=warning, inactive=border
function getStatusDotColor(online: boolean, lastSeen: string): string {
  if (online) return Colors.success;
  // "45m ago", "1h ago", "Just now" → recent
  const recentMatch = lastSeen.match(/^(\d+)m ago$/i);
  if (recentMatch) return Colors.warning;
  if (/^1h ago$/i.test(lastSeen)) return Colors.warning;
  if (/just now/i.test(lastSeen)) return Colors.success;
  return Colors.border;
}

// ── Friend Card ─────────────────────────────────────────────────────────────
function FriendCard({ friend, onLongPress }: {
  friend: Friend;
  onLongPress?: (friend: Friend) => void;
}) {
  // FRI-06 (O18 user decision): backend doesn't return real online/lastSeen/
  // sharedMarkers yet. The UI already gates on `hasStatus` and `> 0` so a
  // fresh install shows neither the dot nor the meta text. Fields are kept
  // in the model so the plumbing is ready when backend catches up — do NOT
  // render them until backend provides real data.
  const hasStatus = friend.online || (friend.lastSeen && friend.lastSeen !== 'N/A');
  const statusColor = getStatusDotColor(friend.online, friend.lastSeen);
  const avatarGradStart = Colors.primaryLight;
  const avatarGradEnd = Colors.primaryDeep;

  // O18 FRI-block + PROF-03: long-press opens action sheet (View profile /
  // Block / Remove). Tap does nothing yet (profile view is separate flow).
  const handleLongPress = () => {
    if (onLongPress) onLongPress(friend);
  };

  return (
    <TouchableOpacity
      onLongPress={handleLongPress}
      delayLongPress={500}
      activeOpacity={0.8}
      testID={`friend-card-${friend.id}`}
    >
      <View style={cardStyles.card}>
      <View style={cardStyles.avatarWrap}>
        <LinearGradient
          colors={[avatarGradStart, avatarGradEnd]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={cardStyles.avatar}
        >
          <Text style={cardStyles.avatarText}>
            {friend.initials}
          </Text>
        </LinearGradient>
        {hasStatus && (
          <View style={[cardStyles.onlineDot, { backgroundColor: statusColor }]} />
        )}
      </View>
      <View style={cardStyles.info}>
        <Text style={cardStyles.name} numberOfLines={1}>{friend.name}</Text>
        <View style={cardStyles.metaRow}>
          {hasStatus && (
            <Text style={cardStyles.meta}>
              {friend.online ? 'Online' : friend.lastSeen}
            </Text>
          )}
          {friend.sharedMarkers > 0 && (
            <>
              {hasStatus && <Text style={cardStyles.metaDot}> · </Text>}
              <Icon name="Flag" size={12} color={Colors.flag} strokeWidth={2} />
              <Text style={cardStyles.meta}> {friend.sharedMarkers} shared flags</Text>
            </>
          )}
        </View>
      </View>
    </View>
    </TouchableOpacity>
  );
}

// ── Add Friend Sheet ─────────────────────────────────────────────────────────
type AddState = 'idle' | 'loading' | 'success' | 'error';

function AddFriendSheet({ onDismiss }: { onDismiss: () => void }) {
  const [email, setEmail] = useState('');
  const [validationError, setValidationError] = useState('');
  const [addState, setAddState] = useState<AddState>('idle');
  const successEmail = useRef('');

  // UX-A fix (v372→v373→v374): match Hiking choose-a-route sheet animation
  // (Animated.timing + Easing.out(Easing.cubic), 280ms slide, 220ms
  // backdrop). v374: align starting translateY to 300 (Hiking uses 300,
  // we had 400 = 100px further off-screen = same duration but faster
  // perceived velocity = "less smooth"). Now matches Hiking exactly.
  const slideAnim = useRef(new Animated.Value(300)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 300,
        duration: 220,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start(() => onDismiss());
  };

  const handleSubmit = async () => {
    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setValidationError('Enter a valid email');
      return;
    }
    setValidationError('');
    setAddState('loading');
    successEmail.current = trimmed;

    const result = await sendFriendRequest(trimmed);
    if (result.success) {
      setAddState('success');
      setTimeout(() => {
        setEmail('');
        setAddState('idle');
        dismiss();
      }, 2000);
    } else {
      // O18 FRI-09: map known backend errors to human copy so a rejected
      // "user not found" doesn't get silently mis-labeled as "sent".
      const raw = (result.error || '').toLowerCase();
      let msg: string;
      if (raw.includes('not found') || raw.includes('no user') || raw.includes('does not exist')) {
        msg = 'No one at Cairn uses that email yet. Ask them to sign up first.';
      } else if (raw.includes('already') && (raw.includes('friend') || raw.includes('request'))) {
        msg = 'You already sent a request or are friends with this person.';
      } else if (raw.includes('yourself') || raw.includes('self')) {
        msg = "You can't friend yourself.";
      } else {
        msg = result.error || "Couldn't send. Check your connection and try again.";
      }
      setValidationError(msg);
      setAddState('idle');
    }
  };

  return (
    <Animated.View style={[sheetStyles.backdrop, { opacity: backdropAnim }]}>
      {/* Tap outside the sheet to dismiss — matches iOS modal convention */}
      <TouchableOpacity
        style={sheetStyles.backdropTouch}
        activeOpacity={1}
        onPress={dismiss}
      />
      {/* KeyboardAvoidingView lifts the sheet above the on-screen keyboard so
          the email input and Send button remain visible while typing. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={sheetStyles.kbWrap}
        pointerEvents="box-none"
      >
        <Animated.View style={[sheetStyles.sheet, { transform: [{ translateY: slideAnim }] }]}>
          {/* Drag handle */}
          <View style={sheetStyles.handle} />

        {addState === 'success' ? (
          <View style={sheetStyles.successState}>
            <View style={sheetStyles.successIcon}>
              <Icon name="CircleCheck" size={40} color={Colors.success} strokeWidth={1.5} />
            </View>
            <Text style={sheetStyles.successTitle}>Friend request sent</Text>
            <Text style={sheetStyles.successEmail}>{successEmail.current}</Text>
          </View>
        ) : (
          <>
            <View style={sheetStyles.illustration}>
              <View style={sheetStyles.illustrationIcon}>
                <Icon name="Users" size={40} color={Colors.primary} strokeWidth={1.5} />
              </View>
              <Text style={sheetStyles.illustrationTitle}>Add a Friend</Text>
              <Text style={sheetStyles.illustrationSub}>
                Send them a friend request inside Cairn — they accept it next time they open the app.
              </Text>
            </View>

            <Text style={sheetStyles.fieldLabel}>Their Cairn email</Text>
            <View style={[sheetStyles.inputWrap, validationError ? sheetStyles.inputError : null]}>
              <Icon name="Mail" size={IconSize.sm} color={Colors.textMuted} strokeWidth={1.8} />
              <TextInput
                style={sheetStyles.input}
                placeholder="The email they signed up with"
                placeholderTextColor={Colors.textMuted}
                value={email}
                onChangeText={(t) => { setEmail(t); if (validationError) setValidationError(''); }}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
            {!!validationError && (
              <Text style={sheetStyles.errorText}>{validationError}</Text>
            )}

            <PressBtn
              style={[sheetStyles.sendBtn, (!email.trim() || addState === 'loading') && sheetStyles.sendBtnDisabled]}
              onPress={handleSubmit}
              scaleTo={0.96}
              disabled={!email.trim() || addState === 'loading'}
            >
              {addState === 'loading' ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Icon name="Send" size={IconSize.sm} color="#fff" strokeWidth={2} />
                  <Text style={sheetStyles.sendBtnText}>Send Request</Text>
                </>
              )}
            </PressBtn>

            <PressBtn style={sheetStyles.cancelBtn} onPress={dismiss} scaleTo={0.97}>
              <Text style={sheetStyles.cancelText}>Cancel</Text>
            </PressBtn>
          </>
        )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

// ── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ onAddFriend }: { onAddFriend: () => void }) {
  return (
    <View style={emptyStyles.container}>
      <IllustrationHalo>
        <EmptyFriends size={192} />
      </IllustrationHalo>
      <Text style={emptyStyles.heading}>Cairn is better with trail companions</Text>
      <Text style={emptyStyles.body}>Invite friends to share markers and stay connected on the track.</Text>
      <PressBtn style={emptyStyles.cta} onPress={onAddFriend} scaleTo={0.96}>
        <Icon name="UserPlus" size={IconSize.sm} color="#fff" strokeWidth={2} />
        <Text style={emptyStyles.ctaText}>Add a Friend</Text>
      </PressBtn>
    </View>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export function FriendsScreen() {
  const nav = useNavigation<Nav>();
  const [showAdd, setShowAdd] = useState(false);

  // Real friends only — no mock fallback. Empty list = empty state UI.
  // (Previously fallback'd to MOCK_FRIENDS which leaked Sam/Alex into every
  // user's view, regardless of who they were logged in as.)
  const storeFriends = useFriendStore(s => s.friends);
  const loadFriendsFromBackend = useFriendStore(s => s.loadFriendsFromBackend);
  const loadCircleMarkers = useMarkerStore(s => s.loadCircleMarkers);

  const mapStoreFriend = (f: typeof storeFriends[0]): Friend => ({
    id: f.id,
    name: f.name,
    email: f.email,
    initials: f.name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2),
    online: false,
    lastSeen: 'N/A',
    sharedMarkers: 0,
    sharing: f.shareMarkers,
  });

  const [friends, setFriends] = useState<Friend[]>(
    storeFriends.map(mapStoreFriend),
  );

  // Incoming friend requests (raw from backend — snake_case shape).
  // We map to a small local type to avoid coupling to the store interface.
  type IncomingRequest = {
    id: string | number;
    from_name: string;
    from_email: string;
    sent_at: string | number;
  };
  const [incomingRequests, setIncomingRequests] = useState<IncomingRequest[]>([]);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [requestsExpanded, setRequestsExpanded] = useState(false);

  // O18 FRI-out: outbound (I-sent) requests.
  const [outboundRequests, setOutboundRequests] = useState<OutboundRequest[]>([]);
  // O18 PROF-03: profile card modal state.
  const [profileFriend, setProfileFriend] = useState<Friend | null>(null);
  const [profileData, setProfileData] = useState<FriendProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const loadRequests = async () => {
    const reqs = await fetchFriendRequests();
    // fetchFriendRequests returns whatever backend gives — backend uses snake_case.
    // Normalize types and stash on state.
    setIncomingRequests(
      (reqs as unknown as IncomingRequest[]).map((r) => ({
        id: r.id,
        from_name: r.from_name,
        from_email: r.from_email,
        sent_at: r.sent_at,
      })),
    );
    // O18 FRI-out: also refresh outbound.
    try {
      const out = await fetchOutboundRequests();
      setOutboundRequests(out);
    } catch { /* silent */ }
  };

  // O18 FRI-block + PROF-03: long-press action sheet on any friend card.
  const handleFriendLongPress = (friend: Friend) => {
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
                    if (r.error) {
                      Alert.alert('Block failed', r.error, [{ text: 'OK' }]);
                      return;
                    }
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

  // O18 FRI-out: cancel my outbound request.
  const handleCancelOutbound = async (req: OutboundRequest) => {
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
            if (ok) {
              setOutboundRequests((prev) => prev.filter((r) => r.id !== req.id));
            }
          },
        },
      ],
    );
  };

  // Refresh from backend on mount
  useEffect(() => {
    loadFriendsFromBackend();
    loadRequests();
  }, []);

  // Sync local list with store — including when store goes empty (logout/clear).
  useEffect(() => {
    setFriends(storeFriends.map(mapStoreFriend));
  }, [storeFriends]);

  async function handleAccept(id: string | number) {
    setBusyRequestId(String(id));
    const ok = await acceptFriendRequestAPI(String(id));
    setBusyRequestId(null);
    if (ok) {
      // Reload friends list + requests, then refresh circle markers so the
      // new friend's flags appear on the map immediately (R10).
      await Promise.all([loadFriendsFromBackend(), loadRequests()]);
      void loadCircleMarkers();
    }
  }

  async function handleReject(id: string | number) {
    setBusyRequestId(String(id));
    const ok = await rejectFriendRequestAPI(String(id));
    setBusyRequestId(null);
    if (ok) await loadRequests();
  }

  // STORY-00109: staggered entrance animations
  const screenOpacity = useRef(new Animated.Value(0)).current;
  // STORY-00109: staggered entrance animations.
  // Slot count: 1 (request section, if any) + N friends + 1 add card.
  // We keep a generous pool of 12 to cover up to ~10 friends without realloc.
  const cardAnims = useRef(
    Array.from({ length: 12 }, () => ({
      opacity: new Animated.Value(0),
      transY: new Animated.Value(16),
    }))
  ).current;

  useEffect(() => {
    // Screen fade-in: 280ms ease-out
    Animated.timing(screenOpacity, { toValue: 1, duration: 280, useNativeDriver: true }).start();

    // Cards: stagger 60ms, starting at delay ~160ms
    const cardAnimations = cardAnims.map((a) =>
      Animated.parallel([
        Animated.timing(a.opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(a.transY, { toValue: 0, duration: 220, useNativeDriver: true }),
      ])
    );
    setTimeout(() => Animated.stagger(60, cardAnimations).start(), 160);
  }, []);

  const hasFriends = friends.length > 0;

  return (
    <Animated.View style={[{ flex: 1 }, { opacity: screenOpacity }]}>
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <BackButton variant="pill" onPress={() => nav.goBack()} />
        <Text style={styles.topTitle}>Friends</Text>
        <PressBtn style={styles.addTopBtn} onPress={() => setShowAdd(true)} scaleTo={0.94}>
          <Icon name="UserPlus" size={12} color="#fff" strokeWidth={2.2} />
          <Text style={styles.addTopBtnText}>Add</Text>
        </PressBtn>
      </View>

      {hasFriends || incomingRequests.length > 0 ? (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            {/* Pending incoming requests — at top so users see them first.
                Single request: render the full card.
                Multiple: render a collapsed summary row that expands on tap. */}
            {incomingRequests.length > 0 && (
              <Animated.View
                style={{
                  opacity: cardAnims[0]?.opacity ?? 1,
                  transform: [{ translateY: cardAnims[0]?.transY ?? 0 }],
                }}
              >
                <View style={styles.requestSection}>
                  {incomingRequests.length > 1 && !requestsExpanded ? (
                    // Collapsed summary — single tappable row
                    <PressBtn
                      style={styles.requestSummaryRow}
                      onPress={() => setRequestsExpanded(true)}
                      scaleTo={0.98}
                    >
                      <View style={styles.requestSummaryAvatar}>
                        <Icon name="UserPlus" size={IconSize.sm} color={Colors.primary} strokeWidth={2} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.requestSummaryTitle}>
                          {incomingRequests.length} friend requests
                        </Text>
                        <Text style={styles.requestSummarySub}>
                          From {incomingRequests.slice(0, 2).map((r) => r.from_name).join(', ')}
                          {incomingRequests.length > 2 ? ` and ${incomingRequests.length - 2} more` : ''}
                        </Text>
                      </View>
                      <Icon name="ChevronDown" size={IconSize.sm} color={Colors.textSecondary} strokeWidth={2} />
                    </PressBtn>
                  ) : (
                    <>
                      <View style={styles.requestSectionHeader}>
                        <Text style={styles.sectionLabel}>
                          {incomingRequests.length === 1
                            ? '1 friend request'
                            : `${incomingRequests.length} friend requests`}
                        </Text>
                        {incomingRequests.length > 1 && (
                          <PressBtn
                            onPress={() => setRequestsExpanded(false)}
                            scaleTo={0.94}
                            style={styles.collapseBtn}
                          >
                            <Icon name="ChevronUp" size={IconSize.sm} color={Colors.textSecondary} strokeWidth={2} />
                          </PressBtn>
                        )}
                      </View>
                      {incomingRequests.map((req) => (
                        <View key={req.id} style={styles.requestCard}>
                          <View style={styles.requestAvatar}>
                            <Text style={styles.requestInitials}>
                              {req.from_name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.requestName}>{req.from_name}</Text>
                            <Text style={styles.requestEmail}>{req.from_email}</Text>
                          </View>
                          <View style={styles.requestActions}>
                            <PressBtn
                              style={[styles.requestBtn, styles.requestAccept]}
                              onPress={() => handleAccept(req.id)}
                              scaleTo={0.94}
                              disabled={busyRequestId === String(req.id)}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                              accessibilityLabel="Accept friend request"
                              accessibilityRole="button"
                            >
                              {busyRequestId === String(req.id) ? (
                                <ActivityIndicator size="small" color="#fff" />
                              ) : (
                                <Icon name="Check" size={IconSize.sm} color="#fff" strokeWidth={2.4} />
                              )}
                            </PressBtn>
                            <PressBtn
                              style={[styles.requestBtn, styles.requestReject]}
                              onPress={() => handleReject(req.id)}
                              scaleTo={0.94}
                              disabled={busyRequestId === String(req.id)}
                              hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                              accessibilityLabel="Decline friend request"
                              accessibilityRole="button"
                            >
                              <Icon name="X" size={IconSize.sm} color={Colors.textSecondary} strokeWidth={2.4} />
                            </PressBtn>
                          </View>
                        </View>
                      ))}
                    </>
                  )}
                </View>
              </Animated.View>
            )}

            {friends.map((friend, i) => (
              <Animated.View
                key={friend.id}
                style={{
                  opacity: cardAnims[i + (incomingRequests.length > 0 ? 1 : 0)]?.opacity ?? 1,
                  transform: [{ translateY: cardAnims[i + (incomingRequests.length > 0 ? 1 : 0)]?.transY ?? 0 }],
                }}
              >
                <FriendCard
                  friend={friend}
                  onLongPress={handleFriendLongPress}
                />
              </Animated.View>
            ))}

            {/* O18 FRI-out: outbound requests section — only when non-empty. */}
            {outboundRequests.length > 0 && (
              <View style={{ marginTop: Spacing.md }}>
                <Text style={{ fontSize: FontSize.small, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing.xs }}>
                  Sent
                </Text>
                {outboundRequests.map((r) => (
                  <View key={r.id} style={[cardStyles.card, { opacity: 0.75 }]}>
                    <View style={cardStyles.avatarWrap}>
                      <View style={[cardStyles.avatar, { backgroundColor: Colors.border, justifyContent: 'center', alignItems: 'center' }]}>
                        <Text style={cardStyles.avatarText}>{r.toName?.[0]?.toUpperCase() ?? '?'}</Text>
                      </View>
                    </View>
                    <View style={cardStyles.info}>
                      <Text style={cardStyles.name} numberOfLines={1}>{r.toName}</Text>
                      <Text style={cardStyles.meta}>Request pending</Text>
                    </View>
                    <TouchableOpacity
                      testID={`btn-cancel-outbound-${r.id}`}
                      onPress={() => handleCancelOutbound(r)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={{ paddingHorizontal: Spacing.sm }}
                    >
                      <Text style={{ color: Colors.danger, fontSize: FontSize.small, fontWeight: '600' }}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Add friend card */}
            <Animated.View style={{
              opacity: cardAnims[friends.length + (incomingRequests.length > 0 ? 1 : 0)]?.opacity ?? 1,
              transform: [{ translateY: cardAnims[friends.length + (incomingRequests.length > 0 ? 1 : 0)]?.transY ?? 0 }],
              marginTop: Spacing.xs,
            }}>
            <PressCard onPress={() => setShowAdd(true)}>
              <View style={styles.addCard}>
                <View style={styles.addCardIconWrap}>
                  <Icon name="UserPlus" size={IconSize.md} color={Colors.primary} strokeWidth={1.8} />
                </View>
                <View>
                  <Text style={styles.addCardLabel}>Add a friend</Text>
                  <Text style={styles.addCardHint}>By their Cairn email</Text>
                </View>
              </View>
            </PressCard>
            </Animated.View>

          </ScrollView>
        </>
      ) : (
        <EmptyState onAddFriend={() => setShowAdd(true)} />
      )}

      {/* Add Friend Sheet */}
      {showAdd && (
        <AddFriendSheet onDismiss={() => setShowAdd(false)} />
      )}

      {/* O18 PROF-03: Friend profile modal.
       * Minimal card — name, email, member-since, friend count, hike count.
       * Fetched on demand from GET /api/friends/:id/profile.
       */}
      {profileFriend && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 24, zIndex: 100 }}>
          <View style={{ backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.lg, width: '100%', maxWidth: 340 }}>
            <View style={{ alignItems: 'center', marginBottom: Spacing.md }}>
              <LinearGradient
                colors={[Colors.primaryLight, Colors.primaryDeep]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontSize: 24, fontWeight: '700' }}>{profileFriend.initials}</Text>
              </LinearGradient>
              <Text style={{ fontSize: FontSize.h3, fontWeight: '700', color: Colors.textPrimary, marginTop: Spacing.sm }}>{profileFriend.name}</Text>
              <Text style={{ fontSize: FontSize.caption, color: Colors.textSecondary }}>{profileFriend.email}</Text>
            </View>
            {profileLoading ? (
              <ActivityIndicator color={Colors.primary} style={{ marginVertical: 20 }} />
            ) : profileData ? (
              <View style={{ paddingVertical: Spacing.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: Colors.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ fontSize: FontSize.h3, fontWeight: '700', color: Colors.textPrimary }}>{profileData.hikeCount}</Text>
                    <Text style={{ fontSize: FontSize.caption, color: Colors.textMuted }}>hikes</Text>
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ fontSize: FontSize.h3, fontWeight: '700', color: Colors.textPrimary }}>{profileData.friendCount}</Text>
                    <Text style={{ fontSize: FontSize.caption, color: Colors.textMuted }}>friends</Text>
                  </View>
                </View>
                {profileData.memberSince && (
                  <Text style={{ fontSize: FontSize.caption, color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.sm }}>
                    Member since {new Date(profileData.memberSince).toLocaleDateString()}
                  </Text>
                )}
              </View>
            ) : (
              <Text style={{ color: Colors.textMuted, textAlign: 'center', marginVertical: 20 }}>Profile unavailable.</Text>
            )}
            <TouchableOpacity
              testID="btn-close-profile"
              style={{ backgroundColor: Colors.primary, paddingVertical: 12, borderRadius: 999, marginTop: Spacing.md }}
              onPress={() => { setProfileFriend(null); setProfileData(null); }}
            >
              <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '600' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
    </Animated.View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.base, paddingTop: Spacing.lg, paddingBottom: Spacing.sm,
    backgroundColor: Colors.bg,
  },
  // O1 batch 37: backBtn, backText removed — 0 references in JSX.
  topTitle: {
    flex: 1, textAlign: 'center',
    fontSize: FontSize.h3, fontWeight: '700', color: Colors.textPrimary,
  },
  addTopBtn: {
    // UX-H fix (v372→v373): match BackButton pill dimensions and visual
    // weight. Pre-fix Add was a heavier solid-primary pill, taller and
    // bolder than Back; now mirrors Back's pill: same paddingVertical=7,
    // FontSize.small, fontWeight=600, but kept solid primary for the
    // "primary action" affordance. Icon size also reduced 14 -> 12 to
    // match Back's chevron weight.
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md, paddingVertical: 7,
  },
  addTopBtnText: { fontSize: FontSize.small, fontWeight: '600', color: '#fff' },

  // O1 batch 37: shareBannerRow, sharePill, shareBannerText, shareBannerSub removed — 0 JSX refs.

  scrollContent: { padding: Spacing.base, gap: Spacing.sm, paddingBottom: Spacing.xxl },

  // Incoming friend requests section — shown at the top of the list
  requestSection: { gap: Spacing.xs, marginBottom: Spacing.sm },
  requestSectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 4, paddingBottom: 4,
  },
  collapseBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  // Collapsed summary row (when N>1 requests, shown as single tap-to-expand row)
  requestSummaryRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.card,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.base,
    borderWidth: 1, borderColor: Colors.primaryBg,
  },
  requestSummaryAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  requestSummaryTitle: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary },
  requestSummarySub: { fontSize: FontSize.small, color: Colors.textSecondary, marginTop: 2 },
  sectionLabel: {
    fontSize: FontSize.small, fontWeight: '700', color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: 4, paddingBottom: 4,
  },
  requestCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.card,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.base,
    borderWidth: 1, borderColor: Colors.primaryBg,
  },
  requestAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  requestInitials: {
    fontSize: FontSize.body, fontWeight: '700', color: Colors.primary,
  },
  requestName: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary },
  requestEmail: { fontSize: FontSize.small, color: Colors.textSecondary, marginTop: 2 },
  requestActions: { flexDirection: 'row', gap: 6 },
  requestBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  requestAccept: { backgroundColor: Colors.primary },
  requestReject: { backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border },

  addCard: {
    backgroundColor: Colors.primaryLight, borderRadius: Radius.card,
    padding: Spacing.base, flexDirection: 'row', alignItems: 'center',
    gap: Spacing.md, borderWidth: 1.5, borderColor: Colors.primary,
    borderStyle: 'dashed', opacity: 0.9,
  },
  addCardIconWrap: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  addCardLabel: { fontSize: FontSize.body, fontWeight: '600', color: Colors.primary },
  addCardHint: { fontSize: FontSize.small, color: Colors.textSecondary, marginTop: 1 },

  // O1 batch 37: infoBox, infoBoxText removed — 0 JSX references.
});

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.88)', borderRadius: Radius.card,
    padding: Spacing.base, flexDirection: 'row', alignItems: 'center',
    gap: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: FontSize.body, fontWeight: '700', color: Colors.primary },
  onlineDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 10, height: 10, borderRadius: 5,
    borderWidth: 2, borderColor: Colors.bg,
  },
  info: { flex: 1 },
  name: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  metaDot: { fontSize: FontSize.small, color: Colors.textSecondary },
  meta: { fontSize: FontSize.small, color: Colors.textSecondary },
  // O1 batch 37: noShareLabel, toggleCol, toggleLabel removed — 0 JSX references.
});

const sheetStyles = StyleSheet.create({
  backdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    // UX-A fix (v372→v373): match Hiking choose-a-route backdrop —
    // soft dark layer (rgba(0,0,0,0.35)) instead of the cream-tint
    // overlayDark token. The cream tint reads as "white veil" which
    // user reported as jarring; the dark layer reads as conventional
    // modal scrim.
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
  },
  kbWrap: {
    width: '100%',
    // Anchored to bottom of backdrop; KeyboardAvoidingView pushes upward when
    // keyboard appears so input + buttons remain visible.
  },
  sheet: {
    backgroundColor: Colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: Spacing.xl, paddingTop: Spacing.md,
    gap: Spacing.md,
    // v376: 回退 v375 的 maxHeight + flexShrink + ScrollView 方案。
    // 真机看到 sheet 底下大量空白 — 因为 maxHeight:'70%' + flexShrink:1
    // 把 sheet 撑到屏幕 70% 高度,但内容只有 ~400px,剩余 ~200px 是
    // 内部 ScrollView 留出的空白。让 sheet 自适应内容高度即可,
    // KeyboardAvoidingView 会在键盘弹起时把 sheet 推上去。
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: 'center',
    marginBottom: Spacing.sm,
  },
  illustration: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  illustrationIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  illustrationTitle: { fontSize: FontSize.h3, fontWeight: '700', color: Colors.textPrimary },
  illustrationSub: { fontSize: FontSize.small, color: Colors.textSecondary, textAlign: 'center' },
  fieldLabel: { fontSize: FontSize.caption, fontWeight: '600', color: Colors.textSecondary },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: Radius.button,
    borderWidth: 1.5, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, gap: Spacing.sm,
  },
  inputError: { borderColor: Colors.danger },
  input: {
    flex: 1, paddingVertical: Spacing.md,
    fontSize: FontSize.body, color: Colors.textPrimary,
  },
  errorText: {
    fontSize: FontSize.small, color: Colors.danger,
    fontWeight: '600', marginTop: -Spacing.xs,
  },
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    justifyContent: 'center',
    backgroundColor: Colors.primary, borderRadius: Radius.button,
    paddingVertical: Spacing.md, minHeight: 52,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: FontSize.body },
  cancelBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  cancelText: { fontSize: FontSize.body, color: Colors.textSecondary, fontWeight: '500' },

  // v376 review NIT-7 (round 2): minHeight 380 — pass-2 reviewer
  // measured form-state at ~360-400px (illustration ~136 + label/input
  // ~52 + send ~52 + cancel ~40 + paddings/gaps). 320 undershot.
  successState: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.md, minHeight: 380, justifyContent: 'center' },
  successIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.successBg,
    alignItems: 'center', justifyContent: 'center',
  },
  successTitle: { fontSize: FontSize.h3, fontWeight: '700', color: Colors.success },
  successEmail: { fontSize: FontSize.body, color: Colors.textSecondary },
});

const emptyStyles = StyleSheet.create({
  container: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: Spacing.xl, gap: Spacing.lg,
  },
  heading: {
    fontSize: FontSize.h2, fontWeight: '700', color: Colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    fontSize: FontSize.body, color: Colors.textSecondary,
    textAlign: 'center', lineHeight: 22,
  },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: Radius.button,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    marginTop: Spacing.sm,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: FontSize.body },
});
