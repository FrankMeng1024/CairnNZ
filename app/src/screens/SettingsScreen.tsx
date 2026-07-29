/**
 * SettingsScreen — O12 MVP redesign (2026-07-27)
 *
 * Structure (per Mockup 5 Option A):
 *   1. Profile card (letter avatar + name + email + inline Change password)
 *   2. Preferences   — Units / Night mode / Haptic feedback
 *   3. Memory        — readonly stats
 *   4. About & Legal — MetService / Report safety / Feedback / Privacy / Terms / About Cairn
 *   5. Danger zone   — Reset my map memory (type "reset memory") + Delete account (type "delete account")
 *   6. Account       — Sign out (grey card, below Danger)
 *   7. Footer        — "Ngā mihi nui — thanks for using Cairn."
 *   Hidden Developer — unlocked by 5-tap on About Cairn row
 *
 * Removed from old Settings (see O12 commit for rationale):
 *   - Interface Mode / Explorer / Navigator (uiMode was dead double-switch)
 *   - Share flags default, Live location sharing (unimplemented)
 *   - Trip Sharing (unimplemented)
 *   - Danger Alerts, Route Deviation, Broadcast Interval, Voice Broadcasts (unimplemented — belong to
 *     future navigation panel, not global Settings)
 *   - Sound Effects, Edge Warning Glow (unimplemented)
 *   - Old Clear uploaded / Clear ALL hike data (moved to internal auto-cleanup via hikeTracksCache size cap)
 *   - Emergency Contacts (T2 already deleted; SOS work descoped)
 *   - Explicit always-visible Debug toggle (5-tap gesture restores it — App Store review safety)
 */
import React, { useState, useRef, useEffect } from 'react';
import * as Application from 'expo-application';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, Alert, TextInput, ActivityIndicator, Platform, Linking, Modal,
  KeyboardAvoidingView, Pressable, Keyboard, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAppStore } from '../store/useAppStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useMemoryStore } from '../features/memory/store/useMemoryStore';
import { useMarkerStore } from '../store/useMarkerStore';
import { useSimWalkerStore } from '../dev/simWalker/useSimWalkerStore';
import { logout } from '../services/authService';
import { haptic } from '../services/hapticService';
import { deleteAllMemoryFromServer } from '../services/memorySync';
import { crashLogger } from '../services/crashLogger';
import { getToken } from '../services/tokenStore';
import { storage } from '../store/storage';
import { API_BASE_URL, PRIVACY_URL } from '../config/api';
import { Colors, Spacing, Radius, FontSize, IconSize } from '../components/tokens';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import { BackButton } from '../components/BackButton';
import { PressBtn } from '../components/PressBtn';
import { pickDebugScreenshots, uploadDebugScreenshots } from '../services/debugUpload';
import { log } from '../services/appLog';
import { OTA_VERSION } from '../components/OtaBadge';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// O13 bug 5: openMailWithFallback helper removed — Feedback/Safety/Bug
// merged into a single in-app inline form that posts through appLog. No
// mailto hop needed.

// ── Row helpers ────────────────────────────────────────────────────────────
function ToggleRow({
  iconName, iconColor, iconBg, label, hint, value, onToggle,
}: {
  iconName: IconName; iconColor: string; iconBg: string;
  label: string; hint?: string;
  value: boolean; onToggle: () => void;
}) {
  return (
    <View style={rowStyles.row}>
      <View style={[rowStyles.iconWrap, { backgroundColor: iconBg }]}>
        <Icon name={iconName} size={16} color={iconColor} strokeWidth={1.8} />
      </View>
      <View style={rowStyles.content}>
        <Text style={rowStyles.label}>{label}</Text>
        {hint ? <Text style={rowStyles.hint} numberOfLines={2}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: Colors.switchTrack, true: Colors.primary }}
        thumbColor={Colors.surface}
      />
    </View>
  );
}

function ActionRow({
  iconName, iconColor, iconBg, label, hint, value, labelColor, onPress, external, hideChevron, disabled,
}: {
  iconName?: IconName; iconColor?: string; iconBg?: string;
  label: string; hint?: string; value?: string; labelColor?: string;
  onPress: () => void; external?: boolean; hideChevron?: boolean; disabled?: boolean;
}) {
  return (
    <PressBtn style={rowStyles.actionRow} onPress={onPress} scaleTo={0.97} disabled={disabled}>
      {iconName && iconBg && iconColor ? (
        <View style={[rowStyles.iconWrap, { backgroundColor: iconBg }]}>
          <Icon name={iconName} size={16} color={iconColor} strokeWidth={1.8} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={[rowStyles.actionLabel, labelColor ? { color: labelColor } : null]}>{label}</Text>
        {hint ? <Text style={rowStyles.hint} numberOfLines={2}>{hint}</Text> : null}
      </View>
      {value ? <Text style={rowStyles.value}>{value}</Text> : null}
      {!hideChevron && (
        <Icon
          name={external ? 'ExternalLink' : 'ChevronRight'}
          size={IconSize.sm}
          color={Colors.textMuted}
          strokeWidth={2}
        />
      )}
    </PressBtn>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

// ── Type-to-confirm modal ─────────────────────────────────────────────────
function TypeToConfirmModal({
  visible, title, body, keyword, confirmLabel, onCancel, onConfirm, destructive = true,
}: {
  visible: boolean;
  title: string;
  body: string;
  keyword: string; // user must type this string exactly
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
  destructive?: boolean;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const match = typed.trim().toLowerCase() === keyword.toLowerCase();

  useEffect(() => {
    if (!visible) {
      setTyped('');
      setBusy(false);
    }
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => { if (!busy) onCancel(); }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {/* Tap outside the card → cancel. Tap on card is absorbed so
         *  users don't lose typed text by tapping accidentally. */}
        <Pressable
          style={modalStyles.backdrop}
          onPress={busy ? undefined : onCancel}
          accessibilityLabel="Dismiss confirmation"
        >
          <Pressable style={modalStyles.card} onPress={() => { /* absorb — do not bubble */ }}>
            <Text style={modalStyles.title} accessibilityRole="header">{title}</Text>
            <Text style={modalStyles.body}>{body}</Text>
            <Text style={modalStyles.hint}>
              Type <Text style={modalStyles.hintKeyword}>{keyword}</Text> to confirm.
            </Text>
            <TextInput
              style={modalStyles.input}
              value={typed}
              onChangeText={setTyped}
              placeholder={keyword}
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              autoFocus={visible}
              accessibilityLabel={`Confirmation keyword input, type ${keyword}`}
            />
            <View style={modalStyles.actions}>
              <TouchableOpacity
                style={modalStyles.btnCancel}
                onPress={() => { Keyboard.dismiss(); onCancel(); }}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={modalStyles.btnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  modalStyles.btnConfirm,
                  destructive && modalStyles.btnConfirmDestructive,
                  (!match || busy) && modalStyles.btnConfirmDisabled,
                ]}
                disabled={!match || busy}
                accessibilityRole="button"
                accessibilityLabel={`${confirmLabel}, ${match ? 'enabled' : 'disabled — type the keyword first'}`}
                onPress={async () => {
                  Keyboard.dismiss();
                  setBusy(true);
                  try {
                    await onConfirm();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={modalStyles.btnConfirmText}>{confirmLabel}</Text>
                }
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────
export function SettingsScreen() {
  const nav = useNavigation<Nav>();
  const { user, isLoggedIn, logout: appLogout } = useAppStore();
  const simWalkerActive = useSimWalkerStore((s) => s.active);
  const setSimWalkerActive = useSimWalkerStore((s) => s.setActive);

  // Settings store — only what remains after O12 cleanup
  // O12: nightMode field remains in useSettingsStore for a future Dark Theme
  // Sprint, but the SettingsScreen toggle is hidden (no consumer yet).
  const hapticFeedback = useSettingsStore((s) => s.hapticFeedback);
  const units = useSettingsStore((s) => s.units);
  const dateFormat = useSettingsStore((s) => s.dateFormat);
  const debugMode = useSettingsStore((s) => s.debugMode);
  const updateSetting = useSettingsStore((s) => s.updateSetting);

  // Memory stats (readonly display)
  const memoryPointCount = useMemoryStore((s) => s.points.length);
  const allMarkers = useMarkerStore((s) => s.markers);
  const myCairnCount = user?.id ? allMarkers.filter((m) => m.authorId === user.id).length : 0;

  // O18 SET-05 (batch 6.5): push notification preferences.
  const [pushPrefs, setPushPrefs] = useState<{ friendRequests: boolean; markerReplies: boolean; memoryHits: boolean; announcements: boolean } | null>(null);
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getPushPreferences } = require('../services/pushService');
        const p = await getPushPreferences();
        if (!cancelled && p) setPushPrefs(p);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [isLoggedIn]);
  const togglePushPref = async (key: 'friendRequests' | 'markerReplies' | 'memoryHits' | 'announcements') => {
    if (!pushPrefs) return;
    const next = { ...pushPrefs, [key]: !pushPrefs[key] };
    setPushPrefs(next); // optimistic
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { updatePushPreferences } = require('../services/pushService');
      const server = await updatePushPreferences({ [key]: next[key] });
      if (server) setPushPrefs(server);
    } catch { /* revert on failure — server sends full state */ }
  };

  // Change Password
  const [showChangePw, setShowChangePw] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  // O13 bug 1: eye toggle to show/hide each password field. Off by default
  // so shoulder-surfing risk stays low; user opts in per field.
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  const handleChangePassword = async () => {
    setPwError(''); setPwSuccess('');
    if (newPw.length < 8) { setPwError('New password must be at least 8 characters.'); return; }
    if (newPw !== confirmPw) { setPwError('New passwords do not match.'); return; }
    setPwLoading(true);
    // O12 subagent audit fixes:
    //   1. 15s AbortController timeout — pre-fix, a hung network left the
    //      spinner turning forever with no user recourse.
    //   2. Guard against getToken() returning null → don't send "Bearer null".
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const token = await getToken();
      if (!token) {
        setPwError('Session expired. Please sign in again.');
        return;
      }
      const res = await fetch(`${API_BASE_URL}/api/auth/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        // O13 bug 1 root cause: backend Joi schema (auth.passwordChange in
        // backend/src/middleware/schemas.js) expects snake_case field names
        // `old_password` + `new_password`. Pre-fix, client sent camelCase
        // `currentPassword` + `newPassword` — every request failed Joi
        // validation with 400 "validation failed". Now we send snake_case.
        body: JSON.stringify({ old_password: currentPw, new_password: newPw }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // Round-2 N2-M6 + Round-3 V3-N1: backend error shapes vary (Express,
        // zod, Nest, RFC7807). Try common shapes before falling back to HTTP
        // status. `data?.errors?.[0]?.msg` handles express-validator arrays.
        const errMsg =
          data?.error ||
          data?.message ||
          data?.detail ||
          data?.errors?.[0]?.msg ||
          `Failed to update password (HTTP ${res.status}).`;
        setPwError(errMsg);
        return;
      }
      setPwSuccess('Password updated. Please sign in again.');
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      // O13 bug 1: after successful password change, force re-login. The old
      // token stays valid on the backend but we want the user to prove they
      // know the new password (security best practice + user expectation).
      setTimeout(async () => {
        if (!dbgMountedRef.current) return;
        try { await logout(); } catch { /* swallow */ }
        try { await storage.removeItem('cairn_remember_me'); } catch { /* swallow */ }
        appLogout();
        nav.replace('Auth');
      }, 1500);
      return; // do not fall through to finally's setPwLoading(false) — flow ends
    } catch (err) {
      // AbortError = user waited past the 15s timeout.
      const msg = (err as { name?: string })?.name === 'AbortError'
        ? 'Network timed out. Please try again.'
        : 'Unable to connect. Please try again.';
      setPwError(msg);
    } finally {
      clearTimeout(timeoutId);
      setPwLoading(false);
    }
  };

  // Units picker
  // O13 bug 2: switched from modal popup to inline expand (like Change password)
  const [showUnitsInline, setShowUnitsInline] = useState(false);
  // O18 HIST-09: date format picker (inline expand, same pattern as units).
  const [showDateInline, setShowDateInline] = useState(false);

  // Feedback / Report / Debug screenshot — inline unified form (O13 bug 5)
  const [showFeedbackInline, setShowFeedbackInline] = useState(false);
  const [feedbackKind, setFeedbackKind] = useState<'feedback' | 'safety' | 'bug'>('feedback');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  // O15 bug 3: attached screenshot previews (clip.yiiling pattern).
  // Stored locally in state so user can see thumbnails + remove them.
  // On Send, upload via existing uploadDebugScreenshots pipeline.
  const [feedbackAttachments, setFeedbackAttachments] = useState<Array<{
    uri: string; width: number; height: number; fileName?: string;
  }>>([]);

  // O15 bug 1: help modal explaining what "places explored" means.
  const [showProgressHelp, setShowProgressHelp] = useState(false);

  // Reset memory type-to-confirm
  const [showResetMemoryModal, setShowResetMemoryModal] = useState(false);

  // Delete account type-to-confirm
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);

  // Debug screenshot upload (kept — genuinely useful for support)
  const [dbgState, setDbgState] = useState<'idle' | 'picking' | 'uploading' | 'done' | 'err'>('idle');
  const [dbgLabel, setDbgLabel] = useState<string>('');
  const dbgResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dbgMountedRef = useRef(true);

  const dbgFlashAndReset = (next: 'done' | 'err', label: string, ms = 5000) => {
    if (!dbgMountedRef.current) return;
    setDbgState(next);
    setDbgLabel(label);
    if (dbgResetTimer.current) clearTimeout(dbgResetTimer.current);
    dbgResetTimer.current = setTimeout(() => {
      if (!dbgMountedRef.current) return;
      setDbgState('idle');
      setDbgLabel('');
    }, ms);
  };

  useEffect(() => {
    // O12: __DEV__ && debugMode force-clear REMOVED — 5-tap gesture on About row is the
    // new intended unlock path. Force-clearing would nuke the unlock in production.
    dbgMountedRef.current = true;
    return () => {
      dbgMountedRef.current = false;
      if (dbgResetTimer.current) clearTimeout(dbgResetTimer.current);
      // O12 audit fix: clean up 5-tap timer on unmount
      if (aboutTapTimer.current) clearTimeout(aboutTapTimer.current);
    };
  }, []);

  // O15 bug 3: pick screenshots but DO NOT upload here. Add to
  // feedbackAttachments state so user sees preview thumbnails and can
  // remove any before Send. Actual upload happens inside handleSendFeedback
  // when the user taps Send.
  const handlePickAttachments = async () => {
    if (dbgState === 'picking' || dbgState === 'uploading') return;
    if (dbgResetTimer.current) {
      clearTimeout(dbgResetTimer.current);
      dbgResetTimer.current = null;
    }
    log('settings.feedback.pick_open', { logged_in: isLoggedIn });
    if (!dbgMountedRef.current) return;
    setDbgState('picking');
    // Cap the picker so total attachments (existing + new) can't exceed 5.
    const remaining = Math.max(0, 5 - feedbackAttachments.length);
    if (remaining === 0) {
      setDbgState('idle');
      setFeedbackError('Up to 5 attachments.');
      return;
    }
    const outcome = await pickDebugScreenshots({ selectionLimit: remaining });
    if (!dbgMountedRef.current) return;
    if (outcome.kind === 'permission_denied') {
      log('settings.feedback.pick_perm_denied');
      setDbgState('idle');
      setFeedbackError('Photo permission denied. Enable in iOS/Android settings.');
      return;
    }
    if (outcome.kind === 'canceled') {
      setDbgState('idle');
      return;
    }
    if (outcome.kind === 'error') {
      log('settings.feedback.pick_err', { error: outcome.message });
      setDbgState('idle');
      setFeedbackError(outcome.message);
      return;
    }
    // Success — add to previews. No upload yet.
    setFeedbackAttachments((cur) => [
      ...cur,
      ...outcome.photos.map((p) => ({
        uri: p.uri,
        width: p.width,
        height: p.height,
      })),
    ]);
    setDbgState('idle');
    setFeedbackError('');
    log('settings.feedback.pick_added', { count: outcome.photos.length });
  };
  // Legacy alias — some old sim-walker debug flows may still expect the
  // pre-O13 name. Kept as an alias so no other file needs changes.
  const handleDebugUpload = handlePickAttachments;

  // O13 bug 5: dbgRowLabel / dbgRowDisabled removed — legacy debug row was
  // replaced by the unified in-app Feedback form. handleDebugUpload is
  // still used by the "Attach screenshots" button inside the Bug tab of
  // that form.

  // 5-tap gesture on About Cairn row → unlock Developer
  const aboutTapCount = useRef(0);
  const aboutTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleAboutTap = () => {
    aboutTapCount.current += 1;
    if (aboutTapTimer.current) clearTimeout(aboutTapTimer.current);
    aboutTapTimer.current = setTimeout(() => { aboutTapCount.current = 0; }, 3000);
    if (aboutTapCount.current >= 5) {
      aboutTapCount.current = 0;
      if (aboutTapTimer.current) clearTimeout(aboutTapTimer.current);
      if (!debugMode) {
        updateSetting('debugMode', true);
        Alert.alert('Developer mode', 'Debug tools unlocked. Scroll down to see them.');
      } else {
        // If already on, do nothing (avoid accidental disable via re-tap)
      }
    }
  };

  const appVersion = Application.nativeApplicationVersion ?? '0.2.5';
  const aboutRowValue = `v${appVersion} · ${OTA_VERSION}`;

  return (
    <View style={{ flex: 1 }}>
      <SafeAreaView style={styles.container} edges={['top']}>
        {/* Top bar (no Save button — settings auto-persist via updateSetting) */}
        <View style={styles.topBar}>
          <BackButton variant="pill" onPress={() => nav.goBack()} />
          <Text style={styles.topTitle}>Settings</Text>
          <View style={styles.topBarSpacer} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

          {/* ── Profile card (top, no section header) ── */}
          {isLoggedIn && user ? (
            <View style={styles.card}>
              <View style={profileStyles.header}>
                <View style={profileStyles.avatar}>
                  <Text style={profileStyles.avatarText}>
                    {(user.name.trim().charAt(0) || '?').toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={profileStyles.name}>{user.name}</Text>
                  <Text style={profileStyles.email}>{user.email}</Text>
                  {/* O18 HOME-05: "Member for X days" — no rewards, no
                      streaks (per user note: not habit-tracking app). Just
                      a quiet acknowledgement of time spent together. */}
                  {user.createdAt && (() => {
                    const days = Math.max(1, Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000));
                    return (
                      <Text style={profileStyles.memberFor}>
                        Member for {days} {days === 1 ? 'day' : 'days'}
                      </Text>
                    );
                  })()}
                </View>
              </View>
              <View style={styles.dividerFlush} />
              <ActionRow
                label="Change password"
                onPress={() => {
                  setShowChangePw(v => !v);
                  setPwError('');
                  setPwSuccess('');
                  // Round-5 R5-M1: also clear the password fields so
                  // plaintext doesn't linger in JS memory across toggles.
                  setCurrentPw('');
                  setNewPw('');
                  setConfirmPw('');
                }}
              />
              {showChangePw && (
                <View style={pwStyles.form}>
                  {!!pwError && <Text style={pwStyles.error}>{pwError}</Text>}
                  {!!pwSuccess && <Text style={pwStyles.success}>{pwSuccess}</Text>}
                  <Text style={pwStyles.label}>Current password</Text>
                  <View style={pwStyles.inputRow}>
                    <TextInput
                      style={pwStyles.inputFlex}
                      value={currentPw}
                      onChangeText={setCurrentPw}
                      placeholder="Enter your current password"
                      placeholderTextColor={Colors.textMuted}
                      secureTextEntry={!showCurrentPw}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      style={pwStyles.eyeBtn}
                      onPress={() => setShowCurrentPw(v => !v)}
                      accessibilityLabel={showCurrentPw ? 'Hide current password' : 'Show current password'}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Icon name={showCurrentPw ? 'EyeOff' : 'Eye'} size={18} color={Colors.textSecondary} strokeWidth={1.8} />
                    </TouchableOpacity>
                  </View>
                  <Text style={pwStyles.label}>New password</Text>
                  <View style={pwStyles.inputRow}>
                    <TextInput
                      style={pwStyles.inputFlex}
                      value={newPw}
                      onChangeText={setNewPw}
                      placeholder="Min. 8 characters"
                      placeholderTextColor={Colors.textMuted}
                      secureTextEntry={!showNewPw}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      style={pwStyles.eyeBtn}
                      onPress={() => setShowNewPw(v => !v)}
                      accessibilityLabel={showNewPw ? 'Hide new password' : 'Show new password'}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Icon name={showNewPw ? 'EyeOff' : 'Eye'} size={18} color={Colors.textSecondary} strokeWidth={1.8} />
                    </TouchableOpacity>
                  </View>
                  <Text style={pwStyles.label}>Confirm new password</Text>
                  <View style={pwStyles.inputRow}>
                    <TextInput
                      style={pwStyles.inputFlex}
                      value={confirmPw}
                      onChangeText={setConfirmPw}
                      placeholder="Re-enter new password"
                      placeholderTextColor={Colors.textMuted}
                      secureTextEntry={!showConfirmPw}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      style={pwStyles.eyeBtn}
                      onPress={() => setShowConfirmPw(v => !v)}
                      accessibilityLabel={showConfirmPw ? 'Hide confirm password' : 'Show confirm password'}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Icon name={showConfirmPw ? 'EyeOff' : 'Eye'} size={18} color={Colors.textSecondary} strokeWidth={1.8} />
                    </TouchableOpacity>
                  </View>
                  <PressBtn
                    style={[pwStyles.btn, pwLoading && { opacity: 0.6 }]}
                    onPress={handleChangePassword}
                    disabled={pwLoading}
                    scaleTo={0.96}
                  >
                    {pwLoading
                      ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <ActivityIndicator size="small" color="#fff" />
                          <Text style={pwStyles.btnText}>Updating…</Text>
                        </View>
                      )
                      : <Text style={pwStyles.btnText}>Update password</Text>
                    }
                  </PressBtn>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.card}>
              <PressBtn style={rowStyles.actionRow} onPress={() => nav.replace('Auth')} scaleTo={0.97}>
                <View style={[rowStyles.iconWrap, { backgroundColor: Colors.primaryLight }]}>
                  <Icon name="User" size={16} color={Colors.primary} strokeWidth={1.8} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: FontSize.body, fontWeight: '500', color: Colors.textPrimary }}>Sign in to save your data</Text>
                  <Text style={{ fontSize: FontSize.small, color: Colors.textSecondary, marginTop: 1 }}>Your sessions will sync across devices</Text>
                </View>
                <Icon name="ChevronRight" size={IconSize.sm} color={Colors.textMuted} strokeWidth={2} />
              </PressBtn>
            </View>
          )}

          {/* ── Your progress (O15 bug 1: moved here from below Preferences,
           *  right after Profile card so the badge feels like part of the
           *  user's identity — achievement / 功勋). Section header includes
           *  a ? tap that opens a modal explaining how "places explored"
           *  is calculated. */}
          <View style={progressStyles.headerRow}>
            <Text style={styles.sectionHeader}>Your progress</Text>
            <TouchableOpacity
              onPress={() => setShowProgressHelp(true)}
              style={progressStyles.helpBtn}
              accessibilityLabel="How is progress calculated?"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="Info" size={14} color={Colors.textMuted} strokeWidth={2} />
            </TouchableOpacity>
          </View>
          <View style={badgeStyles.row}>
            <View style={badgeStyles.card}>
              <View style={[badgeStyles.iconBadge, { backgroundColor: '#eef3e6' }]}>
                <Icon name="Footprints" size={22} color={Colors.primary} strokeWidth={1.8} />
              </View>
              <Text style={badgeStyles.value}>{memoryPointCount}</Text>
              <Text style={badgeStyles.label}>
                {memoryPointCount === 1 ? 'place explored' : 'places explored'}
              </Text>
            </View>
            <View style={badgeStyles.card}>
              <View style={[badgeStyles.iconBadge, { backgroundColor: 'rgba(181,130,61,0.12)' }]}>
                <Icon name="Mountain" size={22} color="#b5823d" strokeWidth={1.8} />
              </View>
              <Text style={badgeStyles.value}>{myCairnCount}</Text>
              <Text style={badgeStyles.label}>
                {myCairnCount === 1 ? 'cairn planted' : 'cairns planted'}
              </Text>
            </View>
          </View>

          {/* ── Preferences ── */}
          <SectionHeader title="Preferences" />
          <View style={styles.card}>
            <ActionRow
              iconName="Ruler"
              iconColor={Colors.primary}
              iconBg={Colors.primaryLight}
              label="Units"
              hint="Distance and elevation"
              value={units === 'imperial' ? 'Miles / feet' : 'Kilometres / metres'}
              onPress={() => setShowUnitsInline(v => !v)}
            />
            {/* O13 bug 2: inline expansion instead of popup modal. Matches
             *  the Change-password disclosure pattern in the Profile card. */}
            {showUnitsInline && (
              <View style={inlineStyles.expand}>
                <View style={styles.divider} />
                <TouchableOpacity
                  style={inlineStyles.pickerRow}
                  onPress={() => { updateSetting('units', 'metric'); setShowUnitsInline(false); }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        inlineStyles.pickerLabel,
                        units === 'metric' && inlineStyles.pickerLabelActive,
                      ]}
                    >
                      Metric
                    </Text>
                    <Text style={inlineStyles.pickerHint}>Kilometres, metres</Text>
                  </View>
                  {units === 'metric' && <Icon name="Check" size={18} color={Colors.primary} strokeWidth={2.5} />}
                </TouchableOpacity>
                <View style={styles.divider} />
                <TouchableOpacity
                  style={inlineStyles.pickerRow}
                  onPress={() => { updateSetting('units', 'imperial'); setShowUnitsInline(false); }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        inlineStyles.pickerLabel,
                        units === 'imperial' && inlineStyles.pickerLabelActive,
                      ]}
                    >
                      Imperial
                    </Text>
                    <Text style={inlineStyles.pickerHint}>Miles, feet</Text>
                  </View>
                  {units === 'imperial' && <Icon name="Check" size={18} color={Colors.primary} strokeWidth={2.5} />}
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.divider} />
            {/* O18 HIST-09: date format picker (dmy / mdy / ymd) */}
            <ActionRow
              iconName="Calendar"
              iconColor={Colors.primary}
              iconBg={Colors.primaryLight}
              label="Date format"
              hint="How dates appear across the app"
              value={dateFormat === 'mdy' ? 'MM/DD/YYYY' : dateFormat === 'ymd' ? 'YYYY-MM-DD' : 'DD/MM/YYYY'}
              onPress={() => setShowDateInline(v => !v)}
            />
            {showDateInline && (
              <View style={inlineStyles.expand}>
                <View style={styles.divider} />
                <TouchableOpacity
                  style={inlineStyles.pickerRow}
                  onPress={() => { updateSetting('dateFormat', 'dmy'); setShowDateInline(false); }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[inlineStyles.pickerLabel, dateFormat === 'dmy' && inlineStyles.pickerLabelActive]}>DD/MM/YYYY</Text>
                    <Text style={inlineStyles.pickerHint}>New Zealand / UK · e.g. 29/07/2026</Text>
                  </View>
                  {dateFormat === 'dmy' && <Icon name="Check" size={18} color={Colors.primary} strokeWidth={2.5} />}
                </TouchableOpacity>
                <View style={styles.divider} />
                <TouchableOpacity
                  style={inlineStyles.pickerRow}
                  onPress={() => { updateSetting('dateFormat', 'mdy'); setShowDateInline(false); }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[inlineStyles.pickerLabel, dateFormat === 'mdy' && inlineStyles.pickerLabelActive]}>MM/DD/YYYY</Text>
                    <Text style={inlineStyles.pickerHint}>United States · e.g. 07/29/2026</Text>
                  </View>
                  {dateFormat === 'mdy' && <Icon name="Check" size={18} color={Colors.primary} strokeWidth={2.5} />}
                </TouchableOpacity>
                <View style={styles.divider} />
                <TouchableOpacity
                  style={inlineStyles.pickerRow}
                  onPress={() => { updateSetting('dateFormat', 'ymd'); setShowDateInline(false); }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[inlineStyles.pickerLabel, dateFormat === 'ymd' && inlineStyles.pickerLabelActive]}>YYYY-MM-DD</Text>
                    <Text style={inlineStyles.pickerHint}>ISO · e.g. 2026-07-29</Text>
                  </View>
                  {dateFormat === 'ymd' && <Icon name="Check" size={18} color={Colors.primary} strokeWidth={2.5} />}
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.divider} />
            <ToggleRow
              iconName="Vibrate"
              iconColor="#8a6e3b"
              iconBg="#f2ece0"
              label="Haptic feedback"
              hint="Little buzz when you tap buttons"
              value={hapticFeedback}
              onToggle={() => {
                const next = !hapticFeedback;
                updateSetting('hapticFeedback', next);
                // O13 bug 3: preview the effect on toggle-on so the user
                // immediately feels what they enabled. Toggle-off obviously
                // does nothing (no vibration to preview).
                if (next) haptic.notification('success');
              }}
            />
          </View>

          {/* O15 bug 1: Progress moved to right below Profile card
           *  (was between Preferences and About). Now the user sees
           *  their achievement immediately after their identity. */}

          {/* ── O18 SET-05: Notifications ────────────────────────── */}
          {isLoggedIn && pushPrefs && (
            <>
              <SectionHeader title="Notifications" />
              <View style={styles.card}>
                <ToggleRow
                  iconName="Users"
                  iconColor="#5d7c46"
                  iconBg="#e6ede0"
                  label="Friend requests"
                  hint="When someone wants to add you"
                  value={pushPrefs.friendRequests}
                  onToggle={() => togglePushPref('friendRequests')}
                />
                <ToggleRow
                  iconName="Flag"
                  iconColor="#c47a00"
                  iconBg="#f5e6cc"
                  label="Cairn activity"
                  hint="Replies and reactions on your cairns"
                  value={pushPrefs.markerReplies}
                  onToggle={() => togglePushPref('markerReplies')}
                />
                <ToggleRow
                  iconName="Mountain"
                  iconColor="#4a6b38"
                  iconBg="#e0e8d5"
                  label="Memory highlights"
                  hint="When a friend hikes near a place you've been"
                  value={pushPrefs.memoryHits}
                  onToggle={() => togglePushPref('memoryHits')}
                />
                <ToggleRow
                  iconName="Info"
                  iconColor="#4a7a8a"
                  iconBg="#e6eef0"
                  label="Announcements"
                  hint="Occasional product updates"
                  value={pushPrefs.announcements}
                  onToggle={() => togglePushPref('announcements')}
                />
              </View>
            </>
          )}

          {/* ── About & Legal ── */}
          <SectionHeader title="About & Legal" />
          <View style={styles.card}>
            <ActionRow
              iconName="Cloud"
              iconColor="#4a7a8a"
              iconBg="#e6eef0"
              label="Check the weather"
              hint="Opens MetService NZ"
              external
              onPress={() => Linking.openURL('https://www.metservice.com/rural').catch(() => Alert.alert('Cannot open link', 'Please try again later.'))}
            />
            <View style={styles.divider} />
            {/* O13 bug 5: unified in-app feedback / safety / bug row.
             *  Replaces the 3 separate mailto rows (Report / Feedback /
             *  Debug screenshot). Expands inline; sends via appLog + optional
             *  debug screenshot upload — no mail app hop. */}
            <ActionRow
              iconName="MessageSquare"
              iconColor={Colors.primary}
              iconBg={Colors.primaryLight}
              label="Send feedback"
              hint="Feedback, safety report, or bug — with optional screenshot"
              onPress={() => {
                setShowFeedbackInline(v => !v);
                setFeedbackError('');
                setFeedbackSent(false);
              }}
            />
            {showFeedbackInline && (
              <View style={inlineStyles.expand}>
                {/* Kind chips */}
                <View style={feedbackStyles.chipRow}>
                  {([
                    { id: 'feedback', label: 'Feedback', icon: 'MessageSquare' as IconName },
                    { id: 'safety', label: 'Safety report', icon: 'TriangleAlert' as IconName },
                    { id: 'bug', label: 'Bug', icon: 'Wrench' as IconName },
                  ] as const).map(k => {
                    const active = feedbackKind === k.id;
                    return (
                      <TouchableOpacity
                        key={k.id}
                        onPress={() => setFeedbackKind(k.id)}
                        style={[feedbackStyles.chip, active && feedbackStyles.chipActive]}
                      >
                        <Icon name={k.icon} size={14} color={active ? '#fff' : Colors.textSecondary} strokeWidth={2} />
                        <Text style={[feedbackStyles.chipText, active && feedbackStyles.chipTextActive]}>{k.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={pwStyles.label}>Tell us what happened</Text>
                <TextInput
                  style={feedbackStyles.textarea}
                  value={feedbackText}
                  onChangeText={setFeedbackText}
                  placeholder={
                    feedbackKind === 'safety' ? 'Where and what — hazard, missing marker, or emergency…'
                    : feedbackKind === 'bug' ? 'What did you tap? What did you expect vs see?'
                    : 'Ideas, hellos, or anything on your mind…'
                  }
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  numberOfLines={5}
                  maxLength={1000}
                />
                <Text style={feedbackStyles.counter}>{feedbackText.length} / 1000</Text>

                {/* O15 bug 3: attachment preview grid (clip.yiiling pattern).
                 *  64x64 thumbnails, ✕ button top-right, tap ✕ to remove. */}
                {feedbackAttachments.length > 0 && (
                  <View style={feedbackStyles.previewGrid}>
                    {feedbackAttachments.map((att, idx) => (
                      <View key={`${att.uri}-${idx}`} style={feedbackStyles.thumb}>
                        <Image
                          source={{ uri: att.uri }}
                          style={feedbackStyles.thumbImg}
                          resizeMode="cover"
                        />
                        <TouchableOpacity
                          style={feedbackStyles.thumbX}
                          onPress={() => setFeedbackAttachments((cur) => cur.filter((_, i) => i !== idx))}
                          accessibilityLabel={`Remove attachment ${idx + 1}`}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Text style={feedbackStyles.thumbXText}>×</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                {!!feedbackError && <Text style={pwStyles.error}>{feedbackError}</Text>}
                {feedbackSent && <Text style={pwStyles.success}>Thanks — we got it.</Text>}
                <View style={feedbackStyles.btnRow}>
                  {Platform.OS !== 'web' && feedbackAttachments.length < 5 && (
                    <PressBtn
                      style={feedbackStyles.attachBtn}
                      onPress={handlePickAttachments}
                      disabled={dbgState === 'picking'}
                      scaleTo={0.96}
                    >
                      <Icon name="Send" size={14} color={Colors.primary} strokeWidth={2} />
                      <Text style={feedbackStyles.attachText}>
                        {' '}
                        {feedbackAttachments.length > 0 ? 'Add more' : 'Attach screenshots'}
                      </Text>
                    </PressBtn>
                  )}
                  <PressBtn
                    style={[feedbackStyles.sendBtn, (feedbackSending || feedbackText.trim().length < 3) && { opacity: 0.5 }]}
                    onPress={async () => {
                      if (feedbackText.trim().length < 3) { setFeedbackError('Please write at least a few words.'); return; }
                      setFeedbackSending(true);
                      setFeedbackError('');
                      setFeedbackSent(false);
                      try {
                        // O15 bug 3: send text feedback + upload any pending
                        // attachments. Attachments go through the existing
                        // debugUpload pipeline (POST /api/debug-snapshot);
                        // the appLog carries a reference count so backend
                        // can link them if needed.
                        let attachmentUploaded = 0;
                        if (feedbackAttachments.length > 0) {
                          try {
                            const result = await uploadDebugScreenshots(
                              feedbackAttachments,
                              'settings',
                            );
                            attachmentUploaded = result.okCount;
                          } catch { /* attachments best-effort; text still sent */ }
                        }
                        log('user_feedback', {
                          kind: feedbackKind,
                          text: feedbackText.trim(),
                          user_email: user?.email ?? null,
                          user_name: user?.name ?? null,
                          ota: OTA_VERSION,
                          attachments_total: feedbackAttachments.length,
                          attachments_ok: attachmentUploaded,
                        });
                        setFeedbackSent(true);
                        setFeedbackText('');
                        setFeedbackAttachments([]);
                        setTimeout(() => {
                          if (!dbgMountedRef.current) return;
                          setShowFeedbackInline(false);
                          setFeedbackSent(false);
                        }, 2000);
                      } catch {
                        setFeedbackError('Could not send. Please try again.');
                      } finally {
                        setFeedbackSending(false);
                      }
                    }}
                    disabled={feedbackSending || feedbackText.trim().length < 3}
                    scaleTo={0.96}
                  >
                    {feedbackSending
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={feedbackStyles.sendText}>Send</Text>
                    }
                  </PressBtn>
                </View>
              </View>
            )}
            <View style={styles.divider} />
            <ActionRow
              iconName="Shield"
              iconColor="#4a6d8a"
              iconBg="#e8eef3"
              label="Privacy Policy"
              hint="How we handle your data"
              external
              onPress={() => Linking.openURL(PRIVACY_URL).catch(() => Alert.alert('Cannot open link', 'Please try again later.'))}
            />
            <View style={styles.divider} />
            <ActionRow
              iconName="FileText"
              iconColor="#7a6a4a"
              iconBg="#f0ede4"
              label="Terms of Service"
              hint="Apple's standard app terms — a Cairn-specific version is coming"
              external
              onPress={() => Linking.openURL('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/').catch(() => Alert.alert('Cannot open link', 'Please try again later.'))}
            />
            <View style={styles.divider} />
            <ActionRow
              iconName="Info"
              iconColor={Colors.textSecondary}
              iconBg="#f0ede4"
              label="About Cairn"
              value={aboutRowValue}
              onPress={handleAboutTap}
              hideChevron
            />
          </View>

          {/* ── Danger zone (destructive actions grouped) ── */}
          <SectionHeader title="Danger zone" />
          <View style={styles.card}>
            <ActionRow
              label="Reset my map memory"
              hint="Clears every place you have walked. Your hikes and cairns are kept."
              labelColor={Colors.danger}
              onPress={() => setShowResetMemoryModal(true)}
            />
            {isLoggedIn && (
              <>
                <View style={styles.dividerFlush} />
                <ActionRow
                  label="Delete account"
                  hint="Permanent — opens confirmation before we email our team"
                  labelColor={Colors.danger}
                  onPress={() => setShowDeleteAccountModal(true)}
                />
              </>
            )}
          </View>

          {/* ── Account (Sign out — grey, below danger, above footer) ── */}
          {isLoggedIn && user && (
            <View style={[styles.card, { marginTop: Spacing.xl }]}>
              <ActionRow
                label="Sign out"
                hint="Your hikes stay saved"
                labelColor={Colors.textPrimary}
                onPress={async () => {
                  // O18 AUTH-09: if a hike is active, warn that data will be
                  // lost. Users tap Settings mid-hike more often than we'd
                  // like — a silent sign-out clears the in-flight session.
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  const { useTrackingStore } = require('../store/useTrackingStore');
                  const trackingStatus = useTrackingStore.getState().status;
                  if (trackingStatus === 'tracking' || trackingStatus === 'paused') {
                    const proceed = Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function'
                      ? window.confirm("You're in the middle of a hike. Signing out will discard the current recording. Continue?")
                      : await new Promise<boolean>((resolve) =>
                          Alert.alert(
                            'Sign out mid-hike?',
                            "You're recording a hike right now. Signing out will discard this session. Save or stop first if you want to keep it.",
                            [
                              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                              { text: 'Sign out anyway', style: 'destructive', onPress: () => resolve(true) },
                            ],
                          )
                        );
                    if (!proceed) return;
                  }
                  const confirmed = Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function'
                    ? window.confirm('Your hikes stay saved. You can sign back in anytime.')
                    : await new Promise<boolean>((resolve) =>
                        Alert.alert('Sign out', 'Your hikes stay saved. You can sign back in anytime.', [
                          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                          { text: 'Sign out', style: 'destructive', onPress: () => resolve(true) },
                        ])
                      );
                  if (!confirmed) return;
                  crashLogger.breadcrumb('signout:confirmed');
                  try { await logout(); crashLogger.breadcrumb('signout:token_cleared'); }
                  catch { crashLogger.breadcrumb('signout:token_clear_failed'); }
                  crashLogger.breadcrumb('signout:before_appLogout');
                  try { await storage.removeItem('cairn_remember_me'); } catch { /* swallow */ }
                  appLogout();
                  crashLogger.breadcrumb('signout:after_appLogout');
                }}
              />
            </View>
          )}

          {/* ── Developer (hidden — unlocked via 5-tap on About Cairn) ── */}
          {debugMode && (
            <>
              <SectionHeader title="Developer" />
              <View style={styles.card}>
                <ToggleRow
                  iconName="Wrench"
                  iconColor={Colors.primary}
                  iconBg={Colors.primaryLight}
                  label="Debug mode"
                  hint="Enables sim-walker + verbose telemetry"
                  value={debugMode}
                  onToggle={() => updateSetting('debugMode', !debugMode)}
                />
                <View style={styles.divider} />
                <ActionRow
                  iconName="Settings2"
                  iconColor={Colors.textSecondary}
                  iconBg="#f0ede4"
                  label="Open Debug screen"
                  onPress={() => nav.navigate('Debug' as never)}
                />
                <View style={styles.divider} />
                <ToggleRow
                  iconName="Navigation2"
                  iconColor={Colors.primary}
                  iconBg={Colors.primaryLight}
                  label="Sim walker (fake GPS)"
                  hint="Off on next app launch"
                  value={simWalkerActive}
                  onToggle={() => setSimWalkerActive(!simWalkerActive)}
                />
              </View>
              <Text style={styles.devNote}>
                Only for development and QA.
              </Text>
            </>
          )}

          {/* ── Footer ── */}
          <Text style={styles.footer}>Thanks for using Cairn.</Text>

        </ScrollView>
      </SafeAreaView>

      {/* O13 bug 2: Units modal removed — replaced by inline expand above
       *  in the Preferences card. */}

      {/* O15 bug 1: Progress help modal — explains how the counts work. */}
      <Modal
        visible={showProgressHelp}
        transparent
        animationType="fade"
        onRequestClose={() => setShowProgressHelp(false)}
      >
        <Pressable
          style={modalStyles.backdrop}
          onPress={() => setShowProgressHelp(false)}
          accessibilityLabel="Dismiss"
        >
          <Pressable style={modalStyles.card} onPress={() => { /* absorb */ }}>
            <Text style={modalStyles.title}>How progress is counted</Text>
            <Text style={helpStyles.body}>
              <Text style={helpStyles.strong}>Places explored</Text> — the number of unique
              map cells you've walked through. The world is divided into small
              hexagon cells (about 25m across). Each time your GPS enters a
              new cell during a hike or run, it's added to your total.
            </Text>
            <Text style={helpStyles.body}>
              <Text style={helpStyles.strong}>Cairns planted</Text> — every cairn you have
              dropped on the map. Cairns you find from friends do not count here.
            </Text>
            <TouchableOpacity
              style={helpStyles.okBtn}
              onPress={() => setShowProgressHelp(false)}
            >
              <Text style={helpStyles.okText}>Got it</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Reset my map memory — type "reset memory" to confirm */}
      <TypeToConfirmModal
        visible={showResetMemoryModal}
        title="Reset your map memory?"
        body="This clears every place you have walked on your map. Your saved hikes and cairns are kept. This cannot be undone."
        keyword="reset memory"
        confirmLabel="Reset memory"
        onCancel={() => setShowResetMemoryModal(false)}
        onConfirm={async () => {
          crashLogger.breadcrumb('settings:reset_memory_confirmed');
          const ok = await deleteAllMemoryFromServer();
          // Round-2 V-N1: use explicit if/else so both breadcrumb literals
          // appear as string constants (greppable in log aggregation).
          if (ok) {
            crashLogger.breadcrumb('settings:reset_memory_ok');
          } else {
            crashLogger.breadcrumb('settings:reset_memory_failed');
          }
          setShowResetMemoryModal(false);
          if (!ok) {
            Alert.alert('Could not reset memory', 'Check your connection and try again.');
          }
        }}
      />

      {/* Delete account — type "delete account" to confirm.
       *
       * O18 AUTH-01 (2026-07-29): replaced the mailto fallback with a real
       * backend soft-delete + 7-day grace period. DELETE /api/auth/account
       * marks the row deleted_at, revokes current jti, and sends a
       * confirmation email with a restore link. The client shows the exact
       * deadline and signs the user out. If they sign in again within 7
       * days, backend returns hint='pending_deletion' and AuthScreen
       * routes to the restore modal.
       */}
      <TypeToConfirmModal
        visible={showDeleteAccountModal}
        title="Delete your account?"
        body="Your account will be scheduled for permanent deletion. You'll have 7 days to sign in and restore it before all your hikes, cairns, and memory are permanently erased."
        keyword="delete account"
        confirmLabel="Delete account"
        onCancel={() => setShowDeleteAccountModal(false)}
        onConfirm={async () => {
          crashLogger.breadcrumb('settings:delete_account_confirmed');
          setShowDeleteAccountModal(false);
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { deleteAccount } = require('../services/authService');
            const r = await deleteAccount();
            if (r.error) {
              crashLogger.breadcrumb(`settings:delete_account_error ${String(r.error).slice(0, 60)}`);
              Alert.alert('Could not delete account', r.error);
              return;
            }
            crashLogger.breadcrumb(`settings:delete_account_scheduled deadline=${r.restoreDeadline}`);
            const deadlineStr = r.restoreDeadline
              ? new Date(r.restoreDeadline).toLocaleDateString()
              : '7 days';
            // Clear stored credentials so this device does not auto-fill.
            try { await storage.removeItem('cairn_remember_me'); } catch { /* swallow */ }
            // Local logout — deleteAccount already revoked the jti server-side,
            // but we still need to clear the token locally to hit AuthScreen.
            try {
              await logout();
            } catch { /* swallow */ }
            appLogout();
            Alert.alert(
              'Account scheduled for deletion',
              `Your account will be permanently deleted on ${deadlineStr}. To restore it, sign in with your email and password before that date.`,
              [{ text: 'OK' }],
            );
          } catch (err) {
            crashLogger.breadcrumb(`settings:delete_account_threw ${String(err).slice(0, 80)}`);
            Alert.alert(
              'Could not delete account',
              'Please check your connection and try again. If the problem persists, email privacy@cairnapp.nz.',
              [{ text: 'OK' }],
            );
          }
        }}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.base, paddingTop: Spacing.lg, paddingBottom: Spacing.sm,
    backgroundColor: Colors.bg,
  },
  topBarSpacer: { width: 40 }, // balance BackButton for centred title
  topTitle: {
    flex: 1, textAlign: 'center',
    fontSize: FontSize.h3, fontWeight: '700', color: Colors.textPrimary,
  },

  scroll: { paddingBottom: Spacing.xxl },

  sectionHeader: {
    fontSize: FontSize.small, fontWeight: '700', color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1,
    marginHorizontal: Spacing.base, marginTop: Spacing.xl, marginBottom: 4,
  },

  card: {
    backgroundColor: 'rgba(255,255,255,0.92)', marginHorizontal: Spacing.base,
    borderRadius: Radius.card, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  // Default divider: skip the icon column so it visually starts under the
  // label. Rows without an icon should use `dividerFlush` to avoid an
  // unnaturally-inset line hanging in whitespace.
  divider: { height: 1, backgroundColor: Colors.border, marginLeft: 52 },
  dividerFlush: { height: 1, backgroundColor: Colors.border, marginHorizontal: Spacing.base },

  footer: {
    textAlign: 'center', fontSize: 12, color: Colors.textMuted,
    marginTop: Spacing.xl, marginBottom: Spacing.base,
    fontStyle: 'italic',
  },

  devNote: {
    marginHorizontal: Spacing.base, marginTop: 6,
    fontSize: 11, color: Colors.textMuted,
    fontStyle: 'italic',
  },
});

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
    minHeight: 64,
  },
  iconWrap: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    marginRight: Spacing.md,
  },
  content: { flex: 1 },
  label: { fontSize: FontSize.body, fontWeight: '500', color: Colors.textPrimary },
  hint: { fontSize: FontSize.small, color: Colors.textSecondary, marginTop: 2, lineHeight: 16 },
  value: { fontSize: FontSize.small, color: Colors.textSecondary, marginRight: 8 },
  actionRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
    minHeight: 64,
  },
  actionLabel: { fontSize: FontSize.body, fontWeight: '500', color: Colors.textPrimary },
});

const profileStyles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
    marginRight: Spacing.md,
  },
  avatarText: {
    fontSize: FontSize.h3, fontWeight: '700', color: Colors.primary,
  },
  name: {
    fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary,
  },
  email: {
    fontSize: FontSize.small, color: Colors.textSecondary, marginTop: 2,
  },
  // O18 HOME-05: subtle "Member for X days" line under email.
  memberFor: {
    fontSize: FontSize.tiny, color: Colors.textMuted, marginTop: 4,
  },
});

const pwStyles = StyleSheet.create({
  form: {
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing.md,
  },
  label: {
    fontSize: FontSize.small, fontWeight: '600',
    color: Colors.textSecondary, marginBottom: 4, marginTop: Spacing.sm,
  },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.card,
    paddingHorizontal: Spacing.sm, paddingVertical: 10,
    fontSize: FontSize.body, color: Colors.textPrimary,
    backgroundColor: Colors.surface,
  },
  // O13 bug 1: input with eye toggle — outer row holds input + button.
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.card,
    backgroundColor: Colors.surface,
  },
  inputFlex: {
    flex: 1,
    paddingHorizontal: Spacing.sm, paddingVertical: 10,
    fontSize: FontSize.body, color: Colors.textPrimary,
  },
  eyeBtn: {
    paddingHorizontal: Spacing.sm, paddingVertical: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  btn: {
    backgroundColor: Colors.primary, borderRadius: Radius.card,
    paddingVertical: 12, alignItems: 'center', marginTop: Spacing.md,
  },
  btnText: { fontSize: FontSize.body, fontWeight: '600', color: '#fff' },
  error: { fontSize: FontSize.small, color: Colors.danger, marginTop: Spacing.sm },
  success: { fontSize: FontSize.small, color: Colors.success, marginTop: Spacing.sm },
});

// O13 bug 2 + bug 5: inline expansion regions (Units picker, Feedback form).
// O15 bug 2: inline expansion styling harmonised with ActionRow.
// Pre-fix, pickerRow had no leading icon column, an extra background
// tint on the expand area, and pickerLabel was semi-bold whereas
// ActionRow labels are 500. Now the expand section reuses ActionRow's
// leading indent (52px, same as styles.divider) so labels align with
// the parent ActionRow above, and pickerRow inherits the same padding
// + typography as ActionRow itself.
const inlineStyles = StyleSheet.create({
  expand: {
    // No background tint — sits flush inside the card.
    paddingBottom: Spacing.xs,
  },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center',
    // Match ActionRow.paddingHorizontal = Spacing.base and add a
    // 52px leading indent so the row starts at the same x-position
    // as the parent ActionRow's label (skipping the 32px icon +
    // 16px marginRight + Spacing.base padding).
    paddingLeft: Spacing.base + 32 + Spacing.md,
    paddingRight: Spacing.base,
    paddingVertical: 12,
    minHeight: 48,
  },
  pickerRowActive: {
    // No background — use a leading dot / trailing check for state.
  },
  pickerLabel: {
    fontSize: FontSize.body,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  pickerLabelActive: {
    color: Colors.primary,
    fontWeight: '600',
  },
  pickerHint: {
    fontSize: FontSize.small,
    color: Colors.textSecondary,
    marginTop: 2,
  },
});

// O13 bug 5: unified in-app feedback form styles.
const feedbackStyles = StyleSheet.create({
  chipRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: 8,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: '#f0ede4', borderWidth: 1, borderColor: Colors.border,
  },
  chipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.textSecondary },
  chipTextActive: { color: '#fff' },
  textarea: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.card,
    paddingHorizontal: Spacing.sm, paddingVertical: 10,
    fontSize: FontSize.body, color: Colors.textPrimary,
    backgroundColor: Colors.surface,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  counter: {
    fontSize: FontSize.tiny, color: Colors.textMuted,
    textAlign: 'right', marginTop: 2, marginBottom: Spacing.xs,
  },
  // O15 bug 3: attachment preview grid (clip.yiiling pattern).
  // 64x64 thumbnails, flex-wrap so they overflow to next row after
  // ~4-5 per row on mobile widths.
  previewGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: 8,
    marginTop: 6, marginBottom: Spacing.sm,
  },
  thumb: {
    position: 'relative',
    width: 64, height: 64,
    borderRadius: 8, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  thumbImg: {
    width: '100%', height: '100%',
  },
  thumbX: {
    position: 'absolute', top: 3, right: 3,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  thumbXText: {
    color: '#fff', fontSize: 14, fontWeight: '700',
    lineHeight: 16,
    // Nudge up: the "×" glyph has extra bottom whitespace baked in
    marginTop: -1,
  },
  btnRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  attachBtn: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    borderRadius: Radius.card,
    borderWidth: 1, borderColor: Colors.primary,
  },
  attachText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.primary },
  sendBtn: {
    flex: 1,
    backgroundColor: Colors.primary, borderRadius: Radius.card,
    paddingVertical: 12, alignItems: 'center',
  },
  sendText: { fontSize: FontSize.body, fontWeight: '600', color: '#fff' },
});

// O15 bug 1: "Your progress" header row with inline ? help icon.
// sectionHeader already has marginHorizontal + marginTop, so headerRow
// just wraps flex-row without extra padding — icon sits right after text.
const progressStyles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row', alignItems: 'center',
  },
  helpBtn: {
    marginLeft: 4,
    padding: 4,
    // Vertical align with the small uppercase section header text
    marginTop: Spacing.xl - 2,
    marginBottom: 2,
  },
});

// O15 bug 1: "Your progress" help modal body text.
const helpStyles = StyleSheet.create({
  body: {
    fontSize: FontSize.body,
    color: Colors.textPrimary,
    lineHeight: 22,
    marginBottom: Spacing.md,
  },
  strong: {
    fontWeight: '700',
    color: Colors.primary,
  },
  okBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.card,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  okText: {
    color: '#fff',
    fontSize: FontSize.body,
    fontWeight: '600',
  },
});

// O13 bug 4: badge cards for "Your progress" (Memory achievement style).
const badgeStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', gap: Spacing.sm,
    paddingHorizontal: Spacing.base,
  },
  card: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  iconBadge: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  value: {
    fontSize: 24, fontWeight: '700', color: Colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  label: {
    fontSize: FontSize.small, color: Colors.textSecondary,
    marginTop: 2,
    textAlign: 'center',
  },
});

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 340,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 10,
  },
  title: {
    fontSize: FontSize.h3, fontWeight: '700', color: Colors.textPrimary,
    marginBottom: 8,
  },
  body: {
    fontSize: FontSize.small, color: Colors.textSecondary,
    marginBottom: 12, lineHeight: 20,
  },
  hint: {
    fontSize: FontSize.small, color: Colors.textSecondary, marginBottom: 6,
  },
  hintKeyword: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: Colors.textPrimary, fontWeight: '600',
  },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: FontSize.body, color: Colors.textPrimary,
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  btnCancel: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8,
  },
  btnCancelText: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textSecondary },
  btnConfirm: {
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8,
    backgroundColor: Colors.primary,
    minWidth: 96, alignItems: 'center',
  },
  btnConfirmDestructive: { backgroundColor: Colors.danger },
  btnConfirmDisabled: { opacity: 0.4 },
  btnConfirmText: { fontSize: FontSize.body, fontWeight: '700', color: '#fff' },

  pickerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: 8, marginBottom: 4,
  },
  pickerRowActive: { backgroundColor: Colors.primaryBg },
  pickerLabel: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary },
  pickerHint: { fontSize: FontSize.small, color: Colors.textSecondary, marginTop: 2 },
});
