/**
 * SettingsScreen — O12 MVP redesign (2026-07-27)
 *
 * Structure (per Mockup 5 Option A):
 *   1. Profile card (letter avatar + name + email + inline Change password)
 *   2. Preferences   — Units / Night mode / Haptic feedback
 *   3. Memory        — readonly stats
 *   4. About & Legal — MetService / Report safety / Feedback / Privacy / Terms / About Cairn
 *   5. Danger zone   — Reset my map memory (type "clear track") + Delete account (type "delete account")
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
  KeyboardAvoidingView, Pressable, Keyboard,
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

/**
 * Open a mailto: URL and, if it fails (no mail app configured), show a
 * fallback Alert instructing the user to send the email manually.
 *
 * O12 Round-3 R3-M7: pre-fix, all mailto call sites silently swallowed
 * failures with `.catch(() => {})` — users who tapped "Report safety issue"
 * on a phone without a mail app got zero feedback and thought the button
 * was broken.
 */
function openMailWithFallback(url: string, fallbackAddress: string): void {
  const addr = fallbackAddress?.trim() || 'support@cairnapp.nz';
  Linking.openURL(url).catch(() => {
    Alert.alert(
      'Email app not available',
      `We could not open your email app. Please email ${addr} manually.`,
      [{ text: 'OK' }],
    );
  });
}

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
  const debugMode = useSettingsStore((s) => s.debugMode);
  const updateSetting = useSettingsStore((s) => s.updateSetting);

  // Memory stats (readonly display)
  const memoryPointCount = useMemoryStore((s) => s.points.length);
  const allMarkers = useMarkerStore((s) => s.markers);
  const myCairnCount = user?.id ? allMarkers.filter((m) => m.authorId === user.id).length : 0;

  // Change Password
  const [showChangePw, setShowChangePw] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

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
        body: JSON.stringify({ currentPassword: currentPw || undefined, newPassword: newPw }),
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
      setPwSuccess('Password updated successfully.');
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      // Round-2 N2-H1: guard setState after unmount. dbgMountedRef is the
      // existing mount-tracker (see line 299). Reuse it so we don't leak
      // a setTimeout writing to state on an unmounted screen.
      setTimeout(() => {
        if (!dbgMountedRef.current) return;
        setShowChangePw(false);
        setPwSuccess('');
      }, 1500);
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
  const [showUnitsModal, setShowUnitsModal] = useState(false);

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

  const handleDebugUpload = async () => {
    if (dbgState === 'picking' || dbgState === 'uploading') return;
    if (dbgResetTimer.current) {
      clearTimeout(dbgResetTimer.current);
      dbgResetTimer.current = null;
    }
    log('settings.debug_upload.pick_open', { logged_in: isLoggedIn });
    if (!dbgMountedRef.current) return;
    setDbgState('picking');
    setDbgLabel('Opening Photos…');
    const outcome = await pickDebugScreenshots({ selectionLimit: 3 });
    if (!dbgMountedRef.current) return;
    if (outcome.kind === 'permission_denied') {
      log('settings.debug_upload.pick_perm_denied');
      dbgFlashAndReset('err', 'Photo permission denied', 4000);
      return;
    }
    if (outcome.kind === 'canceled') {
      log('settings.debug_upload.pick_canceled');
      if (!dbgMountedRef.current) return;
      setDbgState('idle');
      setDbgLabel('');
      return;
    }
    if (outcome.kind === 'error') {
      log('settings.debug_upload.pick_err', { error: outcome.message });
      dbgFlashAndReset('err', outcome.message, 4000);
      return;
    }
    const photos = outcome.photos;
    log('settings.debug_upload.pick_done', { count: photos.length });
    const noun = photos.length === 1 ? 'screenshot' : 'screenshots';
    const confirmed = await new Promise<boolean>((resolve) =>
      Alert.alert(
        'Send to dev team?',
        `${photos.length} ${noun} will be uploaded for debugging.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Send', onPress: () => resolve(true) },
        ],
      ),
    );
    if (!confirmed) {
      log('settings.debug_upload.confirm_canceled');
      if (!dbgMountedRef.current) return;
      setDbgState('idle');
      setDbgLabel('');
      return;
    }
    if (!dbgMountedRef.current) return;
    setDbgState('uploading');
    setDbgLabel(`Uploading 0/${photos.length}…`);
    log('settings.debug_upload.upload_start', { count: photos.length });
    const result = await uploadDebugScreenshots(photos, 'settings', (p) => {
      if (!dbgMountedRef.current) return;
      setDbgLabel(`Uploading ${p.index}/${p.total}…`);
    });
    log('settings.debug_upload.upload_done', {
      ok_count: result.okCount,
      total: result.total,
      partial: result.okCount > 0 && result.okCount < result.total,
      last_error: result.lastError ?? undefined,
    });
    if (result.okCount === result.total) {
      dbgFlashAndReset('done', `Sent ${result.okCount} — thanks!`);
    } else if (result.okCount === 0) {
      dbgFlashAndReset('err', result.lastError ?? 'All uploads failed');
    } else {
      dbgFlashAndReset('err', `${result.okCount}/${result.total} ok · ${result.lastError ?? ''}`);
    }
  };

  const dbgRowLabel = dbgState === 'idle' ? 'Send screenshot to dev team' : dbgLabel;
  const dbgRowDisabled = dbgState === 'picking' || dbgState === 'uploading';

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
                  <TextInput
                    style={pwStyles.input}
                    value={currentPw}
                    onChangeText={setCurrentPw}
                    placeholder="Leave blank if not set yet"
                    placeholderTextColor={Colors.textMuted}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                  <Text style={pwStyles.label}>New password</Text>
                  <TextInput
                    style={pwStyles.input}
                    value={newPw}
                    onChangeText={setNewPw}
                    placeholder="Min. 8 characters"
                    placeholderTextColor={Colors.textMuted}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                  <Text style={pwStyles.label}>Confirm new password</Text>
                  <TextInput
                    style={pwStyles.input}
                    value={confirmPw}
                    onChangeText={setConfirmPw}
                    placeholder="Re-enter new password"
                    placeholderTextColor={Colors.textMuted}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                  <PressBtn
                    style={[pwStyles.btn, pwLoading && { opacity: 0.6 }]}
                    onPress={handleChangePassword}
                    disabled={pwLoading}
                    scaleTo={0.96}
                  >
                    {pwLoading
                      ? <ActivityIndicator size="small" color="#fff" />
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
              onPress={() => setShowUnitsModal(true)}
            />
            {/*
             * O12 subagent audit removed the Night mode toggle from the UI.
             * The `nightMode` store field remains as-is so a future Dark Theme
             * Sprint can surface it — but shipping a toggle whose flip changes
             * nothing violates the very rule O12 introduced (no placebo toggles).
             * Bring the toggle back only when Colors token + screen-by-screen
             * dark styling are ready.
             */}
            <View style={styles.divider} />
            <ToggleRow
              iconName="Vibrate"
              iconColor="#8a6e3b"
              iconBg="#f2ece0"
              label="Haptic feedback"
              hint="Little buzz when you tap buttons"
              value={hapticFeedback}
              onToggle={() => updateSetting('hapticFeedback', !hapticFeedback)}
            />
          </View>

          {/* ── Memory ── */}
          <SectionHeader title="Memory" />
          <View style={styles.card}>
            <View style={rowStyles.row}>
              <View style={[rowStyles.iconWrap, { backgroundColor: '#eef3e6' }]}>
                <Icon name="Map" size={16} color={Colors.primary} strokeWidth={1.8} />
              </View>
              <View style={rowStyles.content}>
                <Text style={rowStyles.label}>Your trail memory</Text>
                <Text style={rowStyles.hint} numberOfLines={2}>
                  {memoryPointCount} {memoryPointCount === 1 ? 'place' : 'places'} explored · {myCairnCount} {myCairnCount === 1 ? 'cairn' : 'cairns'} planted
                </Text>
              </View>
            </View>
          </View>

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
              onPress={() => Linking.openURL('https://www.metservice.com/rural').catch(() => {})}
            />
            <View style={styles.divider} />
            <ActionRow
              iconName="TriangleAlert"
              iconColor="#a67a3a"
              iconBg="#f5eee0"
              label="Report a safety issue"
              hint="Track hazard, missing marker, or emergency"
              external
              onPress={() => openMailWithFallback(
                'mailto:incident@doc.govt.nz?subject=Cairn%20safety%20report',
                'incident@doc.govt.nz',
              )}
            />
            <View style={styles.divider} />
            <ActionRow
              iconName="MessageSquare"
              iconColor={Colors.primary}
              iconBg={Colors.primaryLight}
              label="Send feedback"
              hint="Ideas, bugs, or a hello"
              onPress={() => openMailWithFallback(
                'mailto:support@cairnapp.nz?subject=Cairn%20feedback',
                'support@cairnapp.nz',
              )}
            />
            {Platform.OS !== 'web' && (
              <>
                <View style={styles.divider} />
                <ActionRow
                  iconName="Send"
                  iconColor={Colors.info}
                  iconBg={Colors.infoBg}
                  label={dbgRowLabel}
                  hint="Help us debug by sending a screenshot of any issue you've seen"
                  onPress={handleDebugUpload}
                  hideChevron={dbgRowDisabled}
                  disabled={dbgRowDisabled}
                  labelColor={
                    dbgState === 'done' ? Colors.success
                    : dbgState === 'err' ? Colors.danger
                    : undefined
                  }
                />
              </>
            )}
            <View style={styles.divider} />
            <ActionRow
              iconName="Shield"
              iconColor="#4a6d8a"
              iconBg="#e8eef3"
              label="Privacy Policy"
              hint="How we handle your data"
              external
              onPress={() => Linking.openURL(PRIVACY_URL).catch(() => {})}
            />
            <View style={styles.divider} />
            <ActionRow
              iconName="FileText"
              iconColor="#7a6a4a"
              iconBg="#f0ede4"
              label="Terms of Service"
              hint="Apple's standard app terms — a Cairn-specific version is coming"
              external
              onPress={() => Linking.openURL('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/').catch(() => {})}
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
              labelColor="#b25a48"
              onPress={() => setShowResetMemoryModal(true)}
            />
            {isLoggedIn && (
              <>
                <View style={styles.dividerFlush} />
                <ActionRow
                  label="Delete account"
                  hint="Permanent — opens confirmation before we email our team"
                  labelColor="#b25a48"
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
                hint="Your walks stay saved"
                labelColor={Colors.textSecondary}
                onPress={async () => {
                  const confirmed = Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function'
                    ? window.confirm('Are you sure you want to sign out?')
                    : await new Promise<boolean>((resolve) =>
                        Alert.alert('Sign out', 'Are you sure you want to sign out?', [
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
          <Text style={styles.footer}>Ngā mihi nui — thanks for using Cairn.</Text>

        </ScrollView>
      </SafeAreaView>

      {/* Units picker modal
       *
       * Round-2 N2-M1: backdrop tap dismisses (matches TypeToConfirmModal
       * behavior for iOS/HIG consistency). Inner card absorbs the tap so
       * users don't accidentally close by tapping between rows.
       */}
      <Modal visible={showUnitsModal} transparent animationType="fade" onRequestClose={() => setShowUnitsModal(false)}>
        <Pressable style={modalStyles.backdrop} onPress={() => setShowUnitsModal(false)}>
          <Pressable style={modalStyles.card} onPress={() => { /* absorb */ }}>
            <Text style={modalStyles.title}>Units</Text>
            <TouchableOpacity
              style={[modalStyles.pickerRow, units === 'metric' && modalStyles.pickerRowActive]}
              onPress={() => { updateSetting('units', 'metric'); setShowUnitsModal(false); }}
            >
              <View>
                <Text style={modalStyles.pickerLabel}>Metric</Text>
                <Text style={modalStyles.pickerHint}>Kilometres, metres</Text>
              </View>
              {units === 'metric' && <Icon name="Check" size={20} color={Colors.primary} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={[modalStyles.pickerRow, units === 'imperial' && modalStyles.pickerRowActive]}
              onPress={() => { updateSetting('units', 'imperial'); setShowUnitsModal(false); }}
            >
              <View>
                <Text style={modalStyles.pickerLabel}>Imperial</Text>
                <Text style={modalStyles.pickerHint}>Miles, feet</Text>
              </View>
              {units === 'imperial' && <Icon name="Check" size={20} color={Colors.primary} />}
            </TouchableOpacity>
            <TouchableOpacity style={modalStyles.btnCancel} onPress={() => setShowUnitsModal(false)}>
              <Text style={modalStyles.btnCancelText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Reset my map memory — type "clear track" to confirm */}
      <TypeToConfirmModal
        visible={showResetMemoryModal}
        title="Reset your map memory?"
        body="This clears every place you have walked on your map. Your saved hikes and cairns are kept. This cannot be undone."
        keyword="clear track"
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
       * O12: honest implementation. Backend does not yet expose a delete
       * endpoint with a real cool-off / cancel flow, so shipping a modal
       * that promises "7 days to change your mind" would be a lie (there
       * is no server-side scheduled deletion table nor a cancel endpoint,
       * and the client has no UI to invoke a cancel path). Until the
       * backend + legal copy are ready, deletion is a manual request
       * routed to privacy@cairnapp.nz. This still satisfies Apple App
       * Store Guideline 5.1.1(v) — an in-app path exists — and it does
       * not misrepresent the mechanism to the user.
       */}
      <TypeToConfirmModal
        visible={showDeleteAccountModal}
        title="Delete your account?"
        body="This signs you out on this device and emails our privacy team to permanently delete your account. Your hikes, cairns, and memory will be removed. This cannot be undone."
        keyword="delete account"
        confirmLabel="Send deletion request"
        onCancel={() => setShowDeleteAccountModal(false)}
        onConfirm={async () => {
          crashLogger.breadcrumb('settings:delete_account_confirmed');
          setShowDeleteAccountModal(false);
          // Open the user's mail app with a pre-filled deletion request.
          // Subject includes the account email so the team can act on it
          // without a manual lookup step.
          const subject = encodeURIComponent('Delete my Cairn account');
          const body = encodeURIComponent(
            `Please permanently delete my Cairn account and all associated data.\n\n` +
              `Account email: ${user?.email ?? '(unknown)'}\n` +
              `Account name: ${user?.name ?? '(unknown)'}\n` +
              `Request date: ${new Date().toISOString()}\n`,
          );
          // Round-2 V-N2 + N2-M5: breadcrumb every branch so support can
          // diagnose "why didn't privacy@cairnapp.nz get my email" reports.
          crashLogger.breadcrumb('settings:delete_account_mailto_attempt');
          // Round-3 R3-H3: track mailto success vs failure so we can show
          // a different Alert. Pre-fix, mailto failure silently continued
          // and the Alert lied ("we've opened an email...") — users could
          // not tell if the request had actually been sent.
          let mailtoOpened = false;
          try {
            await Linking.openURL(`mailto:privacy@cairnapp.nz?subject=${subject}&body=${body}`);
            crashLogger.breadcrumb('settings:delete_account_mailto_opened');
            mailtoOpened = true;
          } catch {
            crashLogger.breadcrumb('settings:delete_account_mailto_failed');
            // Mail app unavailable — fall through, still sign out. User will
            // see a distinct alert below.
          }
          // Clear stored credentials so this device does not auto-fill the
          // deleted account on next launch (subagent audit — H-N5).
          try { await storage.removeItem('cairn_remember_me'); } catch { /* swallow */ }
          // Round-5 R5-C1: clear the stored auth token locally. Prior comments
          // implied this REVOKES the backend session (cross-device sign-out),
          // but authService.logout() only does clearToken() — no HTTP call.
          // Other devices keep their valid JWT until natural expiry. If/when
          // backend adds a real POST /api/auth/logout that server-side
          // invalidates tokens, hook it in here.
          try {
            await logout();
            crashLogger.breadcrumb('settings:delete_account_token_cleared');
          } catch {
            crashLogger.breadcrumb('settings:delete_account_token_clear_failed');
          }
          // Round-2 V-N4: sign out LOCALLY before showing the Alert. If the
          // user dismisses the Alert by other means (background+kill etc)
          // we still guarantee the sign-out. Pre-fix this depended on the
          // user tapping OK — an easily-missed edge case.
          appLogout();
          if (mailtoOpened) {
            Alert.alert(
              'Deletion request opened',
              'We\'ve opened an email to privacy@cairnapp.nz. Please send it — our team will delete your account within 5 business days. You have been signed out on this device.',
              [{ text: 'OK' }],
            );
          } else {
            Alert.alert(
              'Email app not available',
              'We could not open your email app. To request deletion, please email privacy@cairnapp.nz manually — include your account email so we can process it. You have been signed out on this device.',
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
  btn: {
    backgroundColor: Colors.primary, borderRadius: Radius.card,
    paddingVertical: 12, alignItems: 'center', marginTop: Spacing.md,
  },
  btnText: { fontSize: FontSize.body, fontWeight: '600', color: '#fff' },
  error: { fontSize: FontSize.small, color: Colors.danger, marginTop: Spacing.sm },
  success: { fontSize: FontSize.small, color: Colors.success, marginTop: Spacing.sm },
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
  btnConfirmDestructive: { backgroundColor: '#c44545' },
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
