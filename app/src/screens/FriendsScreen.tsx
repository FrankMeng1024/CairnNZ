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
  TextInput, Switch, Animated, ActivityIndicator,
  KeyboardAvoidingView, Platform, Keyboard, TouchableWithoutFeedback,
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
import { useFriendStore, sendFriendRequest, fetchFriendRequests, acceptFriendRequestAPI, rejectFriendRequestAPI } from '../store/useFriendStore';
import { EmptyFriends } from '../components/Illustrations';

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

const OWN_EMAIL = 'me@cairn.app';

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
function FriendCard({ friend, onToggleShare }: {
  friend: Friend;
  onToggleShare: () => void;
}) {
  // Backend doesn't (yet) return online status / last seen — surface those
  // only when we have real data. Sentinel value 'N/A' means "unknown".
  const hasStatus = friend.online || (friend.lastSeen && friend.lastSeen !== 'N/A');
  const statusColor = getStatusDotColor(friend.online, friend.lastSeen);
  const avatarGradStart = Colors.primaryLight;
  const avatarGradEnd = Colors.primaryDeep;

  return (
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
        <Text style={cardStyles.name}>{friend.name}</Text>
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
        {!friend.sharing && (
          <Text style={cardStyles.noShareLabel}>Not sharing flags</Text>
        )}
      </View>
      <View style={cardStyles.toggleCol}>
        <Text style={cardStyles.toggleLabel}>{friend.sharing ? 'Sharing' : 'Hidden'}</Text>
        <Switch
          value={friend.sharing}
          onValueChange={onToggleShare}
          trackColor={{ false: Colors.border, true: Colors.primaryLight }}
          thumbColor="#fff"
          style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
        />
      </View>
    </View>
  );
}

// ── Add Friend Sheet ─────────────────────────────────────────────────────────
type AddState = 'idle' | 'loading' | 'success' | 'error';

function AddFriendSheet({ onDismiss }: { onDismiss: () => void }) {
  const [email, setEmail] = useState('');
  const [validationError, setValidationError] = useState('');
  const [addState, setAddState] = useState<AddState>('idle');
  const successEmail = useRef('');

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
        onDismiss();
      }, 2000);
    } else {
      setValidationError(result.error || 'Failed to send request');
      setAddState('idle');
    }
  };

  return (
    <View style={sheetStyles.backdrop}>
      {/* Tap outside the sheet to dismiss — matches iOS modal convention */}
      <TouchableOpacity
        style={sheetStyles.backdropTouch}
        activeOpacity={1}
        onPress={onDismiss}
      />
      {/* KeyboardAvoidingView lifts the sheet above the on-screen keyboard so
          the email input and Send button remain visible while typing. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={sheetStyles.kbWrap}
        pointerEvents="box-none"
      >
        <View style={sheetStyles.sheet}>
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
                autoFocus
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

            <PressBtn style={sheetStyles.cancelBtn} onPress={onDismiss} scaleTo={0.97}>
              <Text style={sheetStyles.cancelText}>Cancel</Text>
            </PressBtn>
          </>
        )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ onAddFriend }: { onAddFriend: () => void }) {
  return (
    <View style={emptyStyles.container}>
      <EmptyFriends size={160} />
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

  const loadRequests = async () => {
    const reqs = await fetchFriendRequests();
    console.log('[FriendsScreen] loadRequests got:', reqs);
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
      // Reload both lists
      await Promise.all([loadFriendsFromBackend(), loadRequests()]);
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
  const bannerOpacity = useRef(new Animated.Value(0)).current;
  const bannerTransY = useRef(new Animated.Value(12)).current;
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

    // Banner: fade + slide up, 250ms, delay 80ms
    Animated.parallel([
      Animated.timing(bannerOpacity, { toValue: 1, duration: 250, delay: 80, useNativeDriver: true }),
      Animated.timing(bannerTransY, { toValue: 0, duration: 250, delay: 80, useNativeDriver: true }),
    ]).start();

    // Cards: stagger 60ms, starting at delay ~160ms
    const cardAnimations = cardAnims.map((a) =>
      Animated.parallel([
        Animated.timing(a.opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(a.transY, { toValue: 0, duration: 220, useNativeDriver: true }),
      ])
    );
    setTimeout(() => Animated.stagger(60, cardAnimations).start(), 160);
  }, []);

  const toggleShare = (id: string) => {
    setFriends(prev => prev.map(f => f.id === id ? { ...f, sharing: !f.sharing } : f));
  };

  const sharingCount = friends.filter(f => f.sharing).length;
  const hasFriends = friends.length > 0;

  return (
    <Animated.View style={[{ flex: 1 }, { opacity: screenOpacity }]}>
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <BackButton variant="pill" onPress={() => nav.goBack()} />
        <Text style={styles.topTitle}>Friends</Text>
        <PressBtn style={styles.addTopBtn} onPress={() => setShowAdd(true)} scaleTo={0.94}>
          <Icon name="UserPlus" size={14} color="#fff" strokeWidth={2} />
          <Text style={styles.addTopBtnText}>Add</Text>
        </PressBtn>
      </View>

      {hasFriends || incomingRequests.length > 0 ? (
        <>
          {/* Share summary banner — only when there are actual friends */}
          {hasFriends && (
          <Animated.View style={{ opacity: bannerOpacity, transform: [{ translateY: bannerTransY }] }}>
          <View style={styles.shareBannerRow}>
            <View style={styles.sharePill}>
              <Icon name="Users" size={12} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.shareBannerText}>
                Sharing flags with {sharingCount}/{friends.length} friends
              </Text>
            </View>
            <Text style={styles.shareBannerSub}>Toggle sharing individually per friend</Text>
          </View>
          </Animated.View>
          )}

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
                  onToggleShare={() => toggleShare(friend.id)}
                />
              </Animated.View>
            ))}

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

            {/* Info box */}
            <View style={styles.infoBox}>
              <Icon name="Info" size={14} color={Colors.textSecondary} strokeWidth={1.8} />
              <Text style={styles.infoBoxText}>
                When you turn off sharing, that friend won't see your new flags. Existing shared flags are not affected.
              </Text>
            </View>
          </ScrollView>
        </>
      ) : (
        <EmptyState onAddFriend={() => setShowAdd(true)} />
      )}

      {/* Add Friend Sheet */}
      {showAdd && (
        <AddFriendSheet onDismiss={() => setShowAdd(false)} />
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
  backBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingVertical: 6, paddingRight: Spacing.sm,
  },
  backText: { fontSize: FontSize.caption, fontWeight: '600', color: Colors.primary },
  topTitle: {
    flex: 1, textAlign: 'center',
    fontSize: FontSize.h3, fontWeight: '700', color: Colors.textPrimary,
  },
  addTopBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
  },
  addTopBtnText: { fontSize: FontSize.small, fontWeight: '700', color: '#fff' },

  shareBannerRow: {
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    gap: 4,
  },
  sharePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: Colors.primaryBg,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md, paddingVertical: 4,
  },
  shareBannerText: { fontSize: FontSize.caption, fontWeight: '600', color: Colors.primary },
  shareBannerSub: { fontSize: FontSize.small, color: Colors.textSecondary, marginTop: 2, paddingHorizontal: 2 },

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

  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: Radius.card,
    padding: Spacing.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
    marginTop: Spacing.xs,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  infoBoxText: {
    flex: 1, fontSize: FontSize.small,
    color: Colors.textSecondary, lineHeight: 18,
  },
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
  noShareLabel: {
    fontSize: FontSize.tiny, fontWeight: '600', color: Colors.textMuted,
    marginTop: 3, backgroundColor: Colors.border,
    borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  toggleCol: { alignItems: 'center', gap: 2 },
  toggleLabel: { fontSize: FontSize.tiny, color: Colors.textMuted, fontWeight: '500' },
});

const sheetStyles = StyleSheet.create({
  backdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    // Cream tint backdrop (Colors.overlayDark — name kept for compat;
    // value is no longer dark). Sheet still reads as elevated via shadow.
    backgroundColor: Colors.overlayDark,
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

  successState: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.md },
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
