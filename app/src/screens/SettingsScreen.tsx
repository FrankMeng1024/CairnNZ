/**
 * SettingsScreen — Sprint 26 premium redesign
 *
 * - Mode cards: LinearGradient icon badges (40×40), h3/600 title, CircleCheck badge
 * - Section headers: tiny/uppercase/muted (unchanged)
 * - Toggle rows: 32×32 icon badge with tint bg (unchanged)
 * - Save button: hidden until dirty, shimmer animation (unchanged)
 * - Sprint 12 SVG icons retained
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, Alert, Animated, TextInput, ActivityIndicator, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAppStore, UIMode } from '../store/useAppStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { logout } from '../services/authService';
import { crashLogger } from '../services/crashLogger';
import { getToken } from '../services/tokenStore';
import { storage } from '../store/storage';
import { API_BASE_URL } from '../config/api';
import { Colors, Spacing, Radius, FontSize, Shadow, IconSize } from '../components/tokens';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import { BackButton } from '../components/BackButton';
import { PressBtn } from '../components/PressBtn';
import { MemorySettingsSection } from '../components/settings/MemorySettingsSection';
import { pickDebugScreenshots, uploadDebugScreenshots } from '../services/debugUpload';
import { log } from '../services/appLog';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// ── Spring press wrapper ────────────────────────────────────────────────────
function PressCard({
  onPress, style, children, scale = 0.97,
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

// ── Mode Card ────────────────────────────────────────────────────────────────
const MODE_META: Record<UIMode, {
  icon: IconName; iconColor: string;
  gradientStart: string; gradientEnd: string;
  title: string; desc: string;
}> = {
  beginner: {
    icon: 'Mountain',
    iconColor: Colors.primary,
    gradientStart: Colors.primaryLight,
    gradientEnd: Colors.primaryLight.replace('0.15', '0.28'),
    title: 'Explorer',
    // Kept short and parallel with Navigator so the two cards render at
    // identical heights — uneven desc length used to make the right card
    // wrap to 2 lines while the left stayed at 1, producing a visible
    // size mismatch on the home of Settings.
    desc: 'Simple view · Guided',
  },
  expert: {
    icon: 'Compass',
    iconColor: Colors.flag,
    gradientStart: Colors.flagLight,
    gradientEnd: Colors.flagLight.replace('0.12', '0.24'),
    title: 'Navigator',
    desc: 'Full data · Dense view',
  },
};

function ModeCard({
  mode, selected, onSelect,
}: { mode: UIMode; selected: boolean; onSelect: () => void }) {
  const meta = MODE_META[mode];
  return (
    <PressCard onPress={onSelect} style={{ flex: 1 }}>
      <View style={[modeStyles.card, selected && modeStyles.cardSelected]}>
        <View style={modeStyles.top}>
          <LinearGradient
            colors={[meta.gradientStart, meta.gradientEnd]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={modeStyles.iconWrap}
          >
            <Icon name={meta.icon} size={20} color={meta.iconColor} strokeWidth={1.8} />
          </LinearGradient>
          {selected && (
            <View style={modeStyles.checkBadge}>
              <Icon name="CircleCheck" size={18} color={Colors.primary} strokeWidth={2} />
            </View>
          )}
        </View>
        <Text style={modeStyles.title}>{meta.title}</Text>
        <Text style={modeStyles.desc}>{meta.desc}</Text>
      </View>
    </PressCard>
  );
}

// ── Toggle Row ───────────────────────────────────────────────────────────────
function ToggleRow({
  iconName, iconColor, iconBg, label, hint, value, onToggle, pending,
}: {
  iconName: IconName; iconColor: string; iconBg: string;
  label: string; hint?: string;
  value: boolean; onToggle: () => void; pending?: boolean;
}) {
  return (
    <View style={[rowStyles.row, pending && rowStyles.rowPending]}>
      <View style={[rowStyles.iconWrap, { backgroundColor: iconBg }]}>
        <Icon name={iconName} size={16} color={iconColor} strokeWidth={1.8} />
      </View>
      <View style={rowStyles.content}>
        <Text style={rowStyles.label}>{label}</Text>
        {hint ? <Text style={rowStyles.hint} numberOfLines={1}>{hint}</Text> : null}
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

// ── Action Row ───────────────────────────────────────────────────────────────
function ActionRow({
  iconName, iconColor, iconBg, label, hint, labelColor, onPress, hideChevron, disabled,
}: {
  iconName: IconName; iconColor: string; iconBg: string;
  label: string; hint?: string; labelColor?: string;
  onPress: () => void; hideChevron?: boolean; disabled?: boolean;
}) {
  return (
    <PressBtn style={rowStyles.actionRow} onPress={onPress} scaleTo={0.97} disabled={disabled}>
      <View style={[rowStyles.iconWrap, { backgroundColor: iconBg }]}>
        <Icon name={iconName} size={16} color={iconColor} strokeWidth={1.8} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[rowStyles.actionLabel, labelColor ? { color: labelColor } : null]}>{label}</Text>
        {hint ? <Text style={rowStyles.hint} numberOfLines={2}>{hint}</Text> : null}
      </View>
      {!hideChevron && (
        <Icon name="ChevronRight" size={IconSize.sm} color={Colors.textMuted} strokeWidth={2} />
      )}
    </PressBtn>
  );
}

// ── Section Header ────────────────────────────────────────────────────────────
function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

// ── Main ─────────────────────────────────────────────────────────────────────
export function SettingsScreen() {
  const nav = useNavigation<Nav>();
  const { uiMode, setUIMode, user, isLoggedIn, logout: appLogout } = useAppStore();
  const settings = useSettingsStore();

  const [pendingMode, setPendingMode] = useState<UIMode>(uiMode);

  // Destructure for ergonomic access
  const {
    shareAfterAdd, nightMode, broadcastEnabled, locationShare,
    tripSharing, voiceBroadcasts, dangerAlerts, routeDeviation,
    hapticFeedback, soundEffects, edgeWarningGlow,
    debugMode,
    updateSetting,
  } = settings;

  // 5-tap version → toggle debug mode
  const versionTapCount = useRef(0);
  const versionTapTime = useRef(0);

  // ── Change Password ─────────────────────────────────────────────────────
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
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/auth/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: currentPw || undefined, newPassword: newPw }),
      });
      const data = await res.json();
      if (!res.ok) { setPwError(data?.error || 'Failed to update password.'); return; }
      setPwSuccess('Password updated successfully.');
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      setTimeout(() => { setShowChangePw(false); setPwSuccess(''); }, 1500);
    } catch {
      setPwError('Unable to connect. Please try again.');
    } finally {
      setPwLoading(false);
    }
  };
  // (settings toggles auto-persist via useSettingsStore.updateSetting)

  const hasChanges = pendingMode !== uiMode;

  // ── V10 · Debug screenshot upload ──────────────────────────────────────
  // User-initiated screenshot upload to /api/debug-snapshot. Allowed
  // regardless of login state — bug reports from unauthenticated users
  // are exactly the ones we miss most. Web platform hides the entry
  // because expo-file-system uploadAsync is native-only.
  const [dbgState, setDbgState] = useState<'idle' | 'picking' | 'uploading' | 'done' | 'err'>('idle');
  const [dbgLabel, setDbgLabel] = useState<string>('');
  const dbgResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // R-round B9: track mount status. If user nav away mid-upload, the
  // onProgress callback + final setState branch must NOT call setState.
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
    dbgMountedRef.current = true;
    return () => {
      dbgMountedRef.current = false;
      if (dbgResetTimer.current) clearTimeout(dbgResetTimer.current);
    };
  }, []);

  const handleDebugUpload = async () => {
    // B10: while picking/uploading, hard-guard re-entry. In done/err
    // the user may want to retry — clear any pending reset timer and
    // continue fresh.
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
          { text: 'Upload', onPress: () => resolve(true) },
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
    log('settings.debug_upload.upload_start', { count: photos.length });
    if (!dbgMountedRef.current) return;
    setDbgState('uploading');
    setDbgLabel(`Uploading 0/${photos.length}…`);
    const result = await uploadDebugScreenshots(photos, 'settings', (p) => {
      if (dbgMountedRef.current) setDbgLabel(`Uploading ${p.index}/${p.total}…`);
      log('settings.debug_upload.upload_progress', { index: p.index, total: p.total, ok: p.ok });
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
  // R-round B10: only DISABLE during active picking/uploading. done/err
  // states already auto-reset; keeping row enabled lets the user retry
  // immediately AND keeps PressBtn's reduced-opacity treatment from
  // dimming the success/danger label color.
  const dbgRowDisabled = dbgState === 'picking' || dbgState === 'uploading';

  // Hint fade animation — fades in (200ms) when hasChanges, out when not
  const hintOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(hintOpacity, {
      toValue: hasChanges ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [hasChanges]);

  // Shimmer animation — active only when hasChanges
  const shimmerX = useRef(new Animated.Value(-200)).current;
  useEffect(() => {
    if (!hasChanges) {
      shimmerX.setValue(-200);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(shimmerX, { toValue: 300, duration: 2000, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [hasChanges]);

  const handleSave = () => {
    setUIMode(pendingMode);
    Alert.alert('', 'Settings saved', [{ text: 'OK' }]);
  };

  return (
    <View style={{ flex: 1 }}>
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <BackButton variant="pill" onPress={() => nav.goBack()} />
        <Text style={styles.topTitle}>Settings</Text>
        <PressBtn
          style={[styles.saveBtn, hasChanges && styles.saveBtnActive]}
          onPress={handleSave}
          scaleTo={0.94}
          disabled={!hasChanges}
        >
          <Icon name="Save" size={14} color={hasChanges ? '#fff' : Colors.textMuted} strokeWidth={2} />
          <Text style={[styles.saveBtnText, hasChanges && styles.saveBtnTextActive]}>Save</Text>
        </PressBtn>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* ── Interface Mode ── */}
        <SectionHeader title="Activity preferences" />
        <Text style={styles.sectionNote}>Choose your preferred UI style</Text>
        <View style={styles.modeRow}>
          <ModeCard mode="beginner" selected={pendingMode === 'beginner'} onSelect={() => setPendingMode('beginner')} />
          <ModeCard mode="expert" selected={pendingMode === 'expert'} onSelect={() => setPendingMode('expert')} />
        </View>
        <Animated.View style={[styles.pendingHint, { opacity: hintOpacity }]} pointerEvents="none">
          <Icon name="ArrowUp" size={12} color={Colors.primary} strokeWidth={2.5} />
          <Text style={styles.pendingHintText}>Tap "Save" to apply</Text>
        </Animated.View>

        {/* ── Sharing ── */}
        <SectionHeader title="Sharing" />
        <View style={styles.card}>
          <ToggleRow
            iconName="Flag"
            iconColor={Colors.primary}
            iconBg={Colors.primaryLight}
            label="Share flags with new friends by default"
            hint="New friends automatically see your public flags"
            value={shareAfterAdd}
            onToggle={() => updateSetting('shareAfterAdd', !shareAfterAdd)}
            pending={shareAfterAdd !== true}
          />
          <View style={styles.divider} />
          <ToggleRow
            iconName="MapPin"
            iconColor={Colors.info}
            iconBg={Colors.infoBg}
            label="Live location sharing"
            hint="Let friends see your current location in real time"
            value={locationShare}
            onToggle={() => updateSetting('locationShare', !locationShare)}
            pending={locationShare !== false}
          />
        </View>

        {/* ── Memory ── (v0.2.6) */}
        <MemorySettingsSection />

        {/* ── Display ── */}
        <SectionHeader title="Display" />
        <View style={styles.card}>
          <ToggleRow
            iconName="Moon"
            iconColor={Colors.night}
            iconBg="rgba(90,79,207,0.1)"
            label="Night mode"
            hint="Coming soon — full dark theme rolling out next update"
            value={nightMode}
            onToggle={() => updateSetting('nightMode', !nightMode)}
            pending={nightMode !== false}
          />
        </View>

        {/* ── Audio ── */}
        <SectionHeader title="Voice Guidance" />
        <View style={styles.card}>
          <ToggleRow
            iconName="Volume2"
            iconColor={Colors.success}
            iconBg={Colors.successBg}
            label="Route announcements"
            hint="Announce distance and off-route warnings while active"
            value={broadcastEnabled}
            onToggle={() => updateSetting('broadcastEnabled', !broadcastEnabled)}
            pending={broadcastEnabled !== true}
          />
        </View>

        {/* ── Account ── */}
        <SectionHeader title="Account" />
        <View style={styles.card}>
          {isLoggedIn && user ? (
            <>
              {/* Profile row — real name + email */}
              <View style={rowStyles.actionRow}>
                <View style={profileStyles.initialsCircle}>
                  <Text style={profileStyles.initialsText}>
                    {user.name.trim().charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1, marginRight: Spacing.sm }}>
                  <Text style={{ fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary }}>{user.name}</Text>
                  <Text style={{ fontSize: FontSize.small, color: Colors.textSecondary, marginTop: 1 }}>{user.email}</Text>
                </View>
              </View>
              <View style={styles.divider} />
              {/* Change Password — email-registered users only */}
              <ActionRow
                iconName="KeyRound"
                iconColor={Colors.primary}
                iconBg={Colors.primaryLight}
                label="Change Password"
                onPress={() => { setShowChangePw(v => !v); setPwError(''); setPwSuccess(''); }}
              />
              {showChangePw && (
                <View style={pwStyles.form}>
                  {!!pwError && (
                    <Text style={pwStyles.error}>{pwError}</Text>
                  )}
                  {!!pwSuccess && (
                    <Text style={pwStyles.success}>{pwSuccess}</Text>
                  )}
                  <Text style={pwStyles.label}>Current Password</Text>
                  <TextInput
                    style={pwStyles.input}
                    value={currentPw}
                    onChangeText={setCurrentPw}
                    placeholder="Leave blank if not set yet"
                    placeholderTextColor={Colors.textMuted}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                  <Text style={pwStyles.label}>New Password</Text>
                  <TextInput
                    style={pwStyles.input}
                    value={newPw}
                    onChangeText={setNewPw}
                    placeholder="Min. 8 characters"
                    placeholderTextColor={Colors.textMuted}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                  <Text style={pwStyles.label}>Confirm New Password</Text>
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
                      : <Text style={pwStyles.btnText}>Update Password</Text>
                    }
                  </PressBtn>
                </View>
              )}
              <View style={styles.divider} />
            </>
          ) : (
            <>
              {/* Not logged in CTA */}
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
            </>
          )}
        </View>

        {/* Emergency Section */}
        <SectionHeader title="Safety" />
        <View style={styles.card}>
          <ActionRow
            iconName="Phone"
            iconColor={Colors.danger}
            iconBg={Colors.dangerBg}
            label="Emergency Contacts"
            onPress={() => Alert.alert('Emergency Contacts', 'Configure in next update')}
          />
          <View style={styles.divider} />
          <ToggleRow
            iconName="Navigation2"
            iconColor={Colors.severityWarning}
            iconBg={Colors.severityWarningBg}
            label="Trip Sharing"
            hint="Notify contacts if you don't check in"
            value={tripSharing}
            onToggle={() => updateSetting('tripSharing', !tripSharing)}
          />
        </View>

        {/* Broadcast Section */}
        <SectionHeader title="Communications" />
        <View style={styles.card}>
          <ToggleRow
            iconName="Volume2"
            iconColor={Colors.primary}
            iconBg={Colors.primaryBg}
            label="Voice Broadcasts"
            hint="TTS announcements during activity"
            value={voiceBroadcasts}
            onToggle={() => updateSetting('voiceBroadcasts', !voiceBroadcasts)}
          />
          <View style={styles.divider} />
          <ToggleRow
            iconName="TriangleAlert"
            iconColor={Colors.danger}
            iconBg={Colors.dangerBg}
            label="Danger Alerts"
            hint="Immediate voice warning near hazards"
            value={dangerAlerts}
            onToggle={() => updateSetting('dangerAlerts', !dangerAlerts)}
          />
          <View style={styles.divider} />
          <ToggleRow
            iconName="Navigation2"
            iconColor={Colors.severityWarning}
            iconBg={Colors.severityWarningBg}
            label="Route Deviation"
            hint="Alert when off planned route"
            value={routeDeviation}
            onToggle={() => updateSetting('routeDeviation', !routeDeviation)}
          />
          <View style={styles.divider} />
          <ActionRow
            iconName="Timer"
            iconColor={Colors.info}
            iconBg={Colors.infoBg}
            label="Broadcast Interval: 15s"
            onPress={() => Alert.alert('Broadcast Interval', 'Adjustable 10-30s in next update')}
          />
        </View>

        {/* Feedback Section */}
        <SectionHeader title="Feedback" />
        <View style={styles.card}>
          {/* V10 · Debug screenshot upload — native only. Web users won't
              see this row because expo-file-system uploadAsync isn't
              available on web. */}
          {Platform.OS !== 'web' && (
            <>
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
              <View style={styles.divider} />
            </>
          )}
          <ToggleRow
            iconName="Zap"
            iconColor={Colors.primary}
            iconBg={Colors.primaryBg}
            label="Haptic Feedback"
            hint="Vibration on actions"
            value={hapticFeedback}
            onToggle={() => updateSetting('hapticFeedback', !hapticFeedback)}
          />
          <View style={styles.divider} />
          <ToggleRow
            iconName="Volume2"
            iconColor={Colors.info}
            iconBg={Colors.infoBg}
            label="Sound Effects"
            hint="Audio cues on flag plant, waypoint"
            value={soundEffects}
            onToggle={() => updateSetting('soundEffects', !soundEffects)}
          />
          <View style={styles.divider} />
          <ToggleRow
            iconName="Star"
            iconColor={Colors.danger}
            iconBg={Colors.dangerBg}
            label="Edge Warning Glow"
            hint="Screen edge flash near danger"
            value={edgeWarningGlow}
            onToggle={() => updateSetting('edgeWarningGlow', !edgeWarningGlow)}
          />
        </View>

        {/* Debug section — only visible when debug mode enabled (5-tap version to toggle) */}
        {debugMode && (
          <View style={{ marginTop: Spacing.xl }}>
            <Text style={styles.sectionHeader}>DEBUG</Text>
            <TouchableOpacity
              style={{
                marginHorizontal: Spacing.base,
                backgroundColor: '#fff',
                padding: Spacing.base,
                borderRadius: Radius.card,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
              onPress={() => nav.navigate('Debug' as never)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Icon name="Settings2" size={20} color={Colors.primary} />
                <Text style={{ marginLeft: 12, color: Colors.textPrimary, fontSize: FontSize.body }}>
                  Open Debug screen
                </Text>
              </View>
              <Icon name="ChevronRight" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
            <Text style={{
              marginHorizontal: Spacing.base,
              marginTop: 6,
              fontSize: 11,
              color: Colors.textMuted,
            }}>
              Tracks debug sessions and uploads them to your backend. Tap version below 5 times to disable.
            </Text>
          </View>
        )}

        {/* Save button (bottom) with shimmer when active */}
        <PressBtn
          style={[styles.saveBtnBottom, hasChanges && styles.saveBtnBottomActive]}
          onPress={handleSave}
          scaleTo={0.97}
          disabled={!hasChanges}
        >
          <Icon name="Save" size={IconSize.sm} color={hasChanges ? '#fff' : Colors.textMuted} strokeWidth={2} />
          <Text style={[styles.saveBtnBottomText, !hasChanges && { color: Colors.textMuted }]}>Save Settings</Text>
          {hasChanges && (
            <Animated.View
              style={[styles.shimmerOverlay, { transform: [{ translateX: shimmerX }] }]}
              pointerEvents="none"
            >
              <LinearGradient
                colors={['transparent', 'rgba(255,255,255,0.25)', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ width: 100, height: '100%' }}
              />
            </Animated.View>
          )}
        </PressBtn>

        {/* Sign Out — pinned to the bottom of all settings, after Save.
            Destructive actions live at the very bottom of a settings
            screen by convention; nesting Sign Out inside Account made it
            sit visually mid-page and felt disordered. Only rendered for
            logged-in users. */}
        {isLoggedIn && user && (
          <View style={[styles.card, { marginTop: Spacing.xl }]}>
            <ActionRow
              iconName="LogOut"
              iconColor={Colors.danger}
              iconBg={Colors.dangerBg}
              label="Sign Out"
              labelColor={Colors.danger}
              hideChevron
              onPress={async () => {
                // Web uses window.confirm (Alert.alert is no-op on web).
                // React Native polyfills `window` but does NOT provide window.confirm,
                // so checking `typeof window` was a misleading bug — guard via Platform.
                const confirmed = Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function'
                  ? window.confirm('Are you sure you want to sign out?')
                  : await new Promise<boolean>((resolve) =>
                      Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
                        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                        { text: 'Sign Out', style: 'destructive', onPress: () => resolve(true) },
                      ])
                    );
                if (!confirmed) return;
                crashLogger.breadcrumb('signout:confirmed');
                // Always clear local state, even if backend logout fails (e.g. offline).
                // Otherwise user thinks they signed out but locally remain logged in.
                try {
                  await logout();
                  crashLogger.breadcrumb('signout:backend_logout_done');
                } catch {
                  crashLogger.breadcrumb('signout:backend_logout_failed');
                  /* ignore — local state must clear regardless */
                }
                crashLogger.breadcrumb('signout:before_appLogout');
                // Clear remember-me credentials so the next launch shows
                // the empty Sign In form (the user explicitly signed out).
                try { await storage.removeItem('cairn_remember_me'); } catch { /* swallow */ }
                appLogout();
                crashLogger.breadcrumb('signout:after_appLogout');
              }}
            />
          </View>
        )}

        {/* Te Reo acknowledgment — PRD3 E-014 */}
        <Text style={{
          textAlign: 'center',
          marginHorizontal: Spacing.base,
          marginTop: Spacing.base,
          color: Colors.textMuted,
          fontSize: 12,
        }}>
          Ngā mihi nui — thanks for using Cairn.
        </Text>

        <TouchableOpacity
          activeOpacity={0.6}
          onPress={() => {
            const now = Date.now();
            if (now - versionTapTime.current > 1500) {
              // Reset if tapping too slow
              versionTapCount.current = 0;
            }
            versionTapTime.current = now;
            versionTapCount.current += 1;
            if (versionTapCount.current >= 5) {
              versionTapCount.current = 0;
              const next = !debugMode;
              updateSetting('debugMode', next);
              Alert.alert(
                next ? 'Debug Mode ON' : 'Debug Mode OFF',
                next
                  ? 'Tracking sessions will record detailed logs. Open Debug screen via Settings → Debug section.'
                  : 'Logs will not be recorded for new sessions.',
              );
            }
          }}
        >
          <Text style={styles.version}>Cairn v0.1.0{debugMode ? ' · Debug ON' : ''}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
    </View>
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
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.border, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
  },
  saveBtnActive: { backgroundColor: Colors.primary },
  saveBtnText: { fontSize: FontSize.small, fontWeight: '700', color: Colors.textMuted },
  saveBtnTextActive: { color: '#fff' },

  scroll: { paddingBottom: Spacing.xxl },

  sectionHeader: {
    fontSize: FontSize.small, fontWeight: '700', color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1,
    marginHorizontal: Spacing.base, marginTop: Spacing.xl, marginBottom: 4,
  },
  sectionLabel: {
    fontSize: FontSize.small, fontWeight: '700', color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1,
    marginHorizontal: Spacing.base, marginTop: Spacing.xl, marginBottom: 4,
  },
  sectionNote: {
    fontSize: FontSize.small, color: Colors.textMuted,
    marginHorizontal: Spacing.base, marginBottom: Spacing.sm,
  },

  card: {
    backgroundColor: 'rgba(255,255,255,0.88)', marginHorizontal: Spacing.base,
    borderRadius: Radius.card, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  divider: { height: 1, backgroundColor: Colors.border, marginLeft: 52 },

  modeRow: { flexDirection: 'row', gap: Spacing.sm, marginHorizontal: Spacing.base },

  pendingHint: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginHorizontal: Spacing.base, marginTop: Spacing.xs,
    backgroundColor: 'rgba(93,124,70,0.1)', borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md, paddingVertical: 4, alignSelf: 'flex-start',
  },
  pendingHintText: { fontSize: FontSize.small, color: Colors.primary, fontWeight: '600' },

  saveBtnBottom: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, justifyContent: 'center',
    marginHorizontal: Spacing.base, marginTop: Spacing.xl,
    backgroundColor: Colors.border, borderRadius: Radius.button,
    paddingVertical: Spacing.md, overflow: 'hidden',
  },
  saveBtnBottomActive: { backgroundColor: Colors.primary },
  saveBtnBottomText: { color: '#fff', fontWeight: '700', fontSize: FontSize.body },
  shimmerOverlay: {
    position: 'absolute', top: 0, bottom: 0, left: 0,
  },

  version: {
    textAlign: 'center', fontSize: FontSize.small, color: Colors.textMuted,
    marginTop: Spacing.lg, marginBottom: Spacing.base,
  },
});

const modeStyles = StyleSheet.create({
  card: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.card,
    padding: Spacing.sm, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', gap: 4,
    // Hard minHeight to lock the two cards at identical visual size.
    // Without this, desc-line-count differences make Explorer/Navigator
    // visually unequal — see uneven heights reported on v14.
    minHeight: 110,
  },
  cardSelected: {
    borderWidth: 2, borderColor: Colors.primary, backgroundColor: Colors.primaryBg,
  },
  top: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', width: '100%', marginBottom: 2,
  },
  iconWrap: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  checkBadge: {},
  title: { fontSize: FontSize.caption, fontWeight: '600', color: Colors.textPrimary },
  desc: { fontSize: FontSize.tiny, color: Colors.textSecondary, textAlign: 'center' },
});

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
    minHeight: 64, // unified row height — same whether or not a hint is present
  },
  rowPending: { backgroundColor: 'rgba(93,124,70,0.03)' },
  iconWrap: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    marginRight: Spacing.md,
  },
  content: { flex: 1 },
  label: { fontSize: FontSize.body, fontWeight: '500', color: Colors.textPrimary },
  hint: { fontSize: FontSize.small, color: Colors.textSecondary, marginTop: 2, lineHeight: 16 },
  actionRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
    minHeight: 64, // match toggle rows
  },
  actionLabel: { fontSize: FontSize.body, fontWeight: '500', color: Colors.textPrimary },
});

const profileStyles = StyleSheet.create({
  initialsCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
    marginRight: Spacing.md, flexShrink: 0,
  },
  initialsText: {
    fontSize: FontSize.body, fontWeight: '700', color: Colors.primary,
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
  success: { fontSize: FontSize.small, color: Colors.primary, fontWeight: '600', marginTop: Spacing.sm },
});
