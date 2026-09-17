/**
 * Settings — durable account, preference, privacy/data, and help controls.
 * Contextual maps, progress, weather, Activity tuning, and QA tools have
 * explicit owners elsewhere and are deliberately absent from this surface.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { BackButton } from '../components/BackButton';
import { ContentSurface } from '../components/ContentSurface';
import { Icon, type IconName } from '../components/Icon';
import { ModalCard, ModalCardHeader } from '../components/ModalCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { SegmentedControl } from '../components/SegmentedControl';
import { TextField } from '../components/TextField';
import { FontSize, IconSize, Radius, Spacing } from '../components/tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { useScenicTimeState } from '../hooks/useScenicTimeState';
import { useAppStore } from '../store/useAppStore';
import { useSettingsStore, type AppearancePref, type UnitsPref } from '../store/useSettingsStore';
import { useMemorySettingsStore } from '../features/memory/store/useMemorySettingsStore';
import { useWeatherStore } from '../store/useWeatherStore';
import {
  changePassword,
  deleteAccount,
  fetchExportHistory,
  getMe,
  logout,
  patchName,
  requestDataExport,
  submitFeedback,
  type DataExportSummary,
} from '../services/authService';
import {
  completeDeletedAccountLocalPurge,
  scheduleDeletedAccountLocalPurge,
} from '../services/accountLocalData';
import { clearCredentials } from '../services/credentialsStore';
import { deleteAllMemoryFromServer } from '../services/memorySync';
import { haptic } from '../services/hapticService';
import { PRIVACY_URL } from '../config/api';
import { getHomeBackground, getRegisteredBackgroundLayout, getWeatherReviewBackground } from '../utils/homeBackground';

type Page = 'root' | 'account' | 'privacy' | 'help';
type FeedbackKind = 'feedback' | 'bug';
type AsyncState = 'idle' | 'sending' | 'sent' | 'failed';

const TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
const UNITS_SEGMENTS = [
  { key: 'metric', label: 'Metric' },
  { key: 'imperial', label: 'Imperial' },
] as const;
const APPEARANCE_SEGMENTS = [
  { key: 'auto', label: 'Auto' },
  { key: 'day', label: 'Day' },
  { key: 'sunset', label: 'Sunset' },
  { key: 'night', label: 'Night' },
] as const;
const FEEDBACK_SEGMENTS = [
  { key: 'feedback', label: 'Feedback' },
  { key: 'bug', label: 'Bug' },
] as const;

function SectionTitle({ children, color, shadowColor }: { children: React.ReactNode; color: string; shadowColor: string }) {
  return (
    <Text style={[styles.sectionTitle, { color, textShadowColor: shadowColor }]}>{children}</Text>
  );
}

function Divider({ color }: { color: string }) {
  return <View style={[styles.divider, { backgroundColor: color }]} />;
}

function Row({
  icon,
  title,
  detail,
  value,
  onPress,
  testID,
  destructive = false,
  external = false,
}: {
  icon: IconName;
  title: string;
  detail?: string;
  value?: string;
  onPress?: () => void;
  testID?: string;
  destructive?: boolean;
  external?: boolean;
}) {
  const theme = useVisualTheme();
  const body = (
    <>
      <View style={[styles.rowIcon, { backgroundColor: destructive ? theme.destructiveSurface : theme.controlSelected }]}>
        <Icon name={icon} size={IconSize.sm} color={destructive ? theme.destructive : theme.icon} strokeWidth={1.9} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: destructive ? theme.destructive : theme.textPrimary }]}>{title}</Text>
        {detail ? <Text style={[styles.rowDetail, { color: theme.textSecondary }]}>{detail}</Text> : null}
      </View>
      {value ? <Text style={[styles.rowValue, { color: theme.textSecondary }]} numberOfLines={1}>{value}</Text> : null}
      {onPress ? (
        <Icon name={external ? 'ExternalLink' : 'ChevronRight'} size={16} color={theme.iconInactive} strokeWidth={2} />
      ) : null}
    </>
  );
  if (!onPress) return <View testID={testID} style={styles.row}>{body}</View>;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.recordPressed }]}
    >
      {body}
    </Pressable>
  );
}

function ToggleRow({
  icon,
  title,
  detail,
  value,
  onChange,
  disabled = false,
  testID,
}: {
  icon: IconName;
  title: string;
  detail: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  testID: string;
}) {
  const theme = useVisualTheme();
  return (
    <View style={[styles.row, disabled && styles.disabled]}>
      <View style={[styles.rowIcon, { backgroundColor: theme.controlSelected }]}>
        <Icon name={icon} size={IconSize.sm} color={theme.icon} strokeWidth={1.9} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>{title}</Text>
        <Text style={[styles.rowDetail, { color: theme.textSecondary }]}>{detail}</Text>
      </View>
      <Switch
        testID={testID}
        accessibilityLabel={title}
        accessibilityState={{ disabled }}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: theme.disabledBorder, true: theme.primary }}
        thumbColor={theme.surfaceElevated}
      />
    </View>
  );
}

function formatBytes(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function providerSummary(hasPassword: boolean | undefined, providers: string[] | undefined): string {
  const names = (providers ?? []).map((provider) => provider.charAt(0).toUpperCase() + provider.slice(1));
  if (hasPassword === true) return names.length > 0 ? `Email + ${names.join(' + ')}` : 'Email + password';
  if (hasPassword === false && names.length > 0) return names.join(' + ');
  return 'Checking sign-in method…';
}

export function SettingsScreen() {
  const navigation = useNavigation();
  const theme = useVisualTheme();
  const scenicTime = useScenicTimeState();
  const condition = useWeatherStore((state) => state.condition);
  const conditionOverride = useWeatherStore((state) => state.conditionOverride);
  const effectiveCondition = conditionOverride ?? condition;
  const background = useMemo(() => (
    conditionOverride === 'cloudy' || conditionOverride === 'rain' || conditionOverride === 'snow'
      ? getWeatherReviewBackground(conditionOverride, scenicTime.timeOfDay)
      : getHomeBackground(
          effectiveCondition,
          Date.now(),
          scenicTime.timeOfDay,
          'settings',
          { sunriseMs: scenicTime.sunriseMs, sunsetMs: scenicTime.sunsetMs },
        )
  ), [conditionOverride, effectiveCondition, scenicTime.sunriseMs, scenicTime.sunsetMs, scenicTime.timeOfDay]);
  const backgroundLayout = useMemo(() => getRegisteredBackgroundLayout(background), [background]);
  const surfaceStyle = useMemo(() => ({
    backgroundColor: background.settingsCardBackgroundColor,
    borderColor: background.settingsCardBorderColor,
  }), [background.settingsCardBackgroundColor, background.settingsCardBorderColor]);

  const user = useAppStore((state) => state.user);
  const isLoggedIn = useAppStore((state) => state.isLoggedIn);
  const setUser = useAppStore((state) => state.setUser);
  const appLogout = useAppStore((state) => state.logout);
  const units = useSettingsStore((state) => state.units);
  const appearance = useSettingsStore((state) => state.appearance);
  const hapticFeedback = useSettingsStore((state) => state.hapticFeedback);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const exploreEnabled = useMemorySettingsStore((state) => state.foregroundAutoUnlockEnabled);
  const setMemorySetting = useMemorySettingsStore((state) => state.set);

  const [page, setPage] = useState<Page>('root');
  const [permissionStatus, setPermissionStatus] = useState<string>('unknown');
  const [permissionCanAskAgain, setPermissionCanAskAgain] = useState(true);
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);

  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePhrase, setDeletePhrase] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteSaving, setDeleteSaving] = useState(false);

  const [exports, setExports] = useState<DataExportSummary[]>([]);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportRequesting, setExportRequesting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [memoryDeleting, setMemoryDeleting] = useState(false);

  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>('feedback');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackState, setFeedbackState] = useState<AsyncState>('idle');
  const [feedbackError, setFeedbackError] = useState('');
  const [feedbackSubmissionId, setFeedbackSubmissionId] = useState(() => Crypto.randomUUID());
  const feedbackFlight = useRef(false);
  const exportFlight = useRef(false);
  const deleteFlight = useRef(false);

  const refreshPermission = useCallback(async () => {
    try {
      const result = await Location.getForegroundPermissionsAsync();
      setPermissionStatus(result.status);
      setPermissionCanAskAgain(result.canAskAgain !== false);
    } catch {
      setPermissionStatus('unavailable');
      setPermissionCanAskAgain(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!isLoggedIn) return;
    setProfileLoading(true);
    const fresh = await getMe();
    if (fresh) setUser(fresh);
    setProfileLoading(false);
  }, [isLoggedIn, setUser]);

  const refreshExports = useCallback(async (quiet = false) => {
    if (!quiet) setExportLoading(true);
    const result = await fetchExportHistory();
    setExports(result.exports);
    setExportError(result.error ?? '');
    if (!quiet) setExportLoading(false);
  }, []);

  useEffect(() => {
    void refreshPermission();
    void refreshProfile();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshPermission();
    });
    return () => subscription.remove();
  }, [refreshPermission, refreshProfile]);

  useEffect(() => {
    if (page !== 'privacy') return;
    void refreshExports();
  }, [page, refreshExports]);

  const hasPendingExport = exports.some((item) => item.status === 'queued' || item.status === 'building');
  useEffect(() => {
    if (page !== 'privacy' || !hasPendingExport) return;
    const timer = setInterval(() => void refreshExports(true), 4_000);
    return () => clearInterval(timer);
  }, [hasPendingExport, page, refreshExports]);

  const openPage = (next: Page) => {
    setPage(next);
    if (next === 'account') void refreshProfile();
  };

  const handleExploreChange = async (next: boolean) => {
    if (!next) {
      setMemorySetting('foregroundAutoUnlockEnabled', false);
      return;
    }
    setPermissionLoading(true);
    try {
      let result = await Location.getForegroundPermissionsAsync();
      if (result.status !== Location.PermissionStatus.GRANTED && result.canAskAgain) {
        result = await Location.requestForegroundPermissionsAsync();
      }
      setPermissionStatus(result.status);
      setPermissionCanAskAgain(result.canAskAgain !== false);
      if (result.status === Location.PermissionStatus.GRANTED) {
        setMemorySetting('foregroundAutoUnlockEnabled', true);
        haptic.selection();
      } else {
        setMemorySetting('foregroundAutoUnlockEnabled', false);
        Alert.alert(
          'Location permission is off',
          'Cairn can only update exploration while it is open when iOS location permission is allowed. Hike and Run permissions are handled separately when you record.',
          [
            { text: 'Not now', style: 'cancel' },
            ...(!result.canAskAgain ? [{ text: 'Open Settings', onPress: () => void Linking.openSettings() }] : []),
          ],
        );
      }
    } finally {
      setPermissionLoading(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign out?',
      'Your saved and recoverable Cairn data stays with this account. Explore while Cairn is open will return to Off on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          onPress: () => void (async () => {
            try {
              await appLogout();
              await logout();
            } catch {
              Alert.alert('Could not sign out', 'Cairn could not safely stop the current account session. Please try again.');
            }
          })(),
        },
      ],
    );
  };

  const latestExport = exports[0] ?? null;
  const exportExpired = latestExport?.expires_at
    ? new Date(latestExport.expires_at).getTime() <= Date.now()
    : false;

  const renderHeader = (title: string) => (
    <View style={styles.header}>
      <BackButton
        variant="inline"
        label="Back"
        onPress={() => page === 'root' ? navigation.goBack() : setPage('root')}
        testID="settings-back"
      />
      <Text style={[styles.pageTitle, { color: background.textColor, textShadowColor: background.textShadowColor }]}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );

  const renderRoot = () => (
    <>
      {renderHeader('Settings')}
      <ScrollView testID="settings-root" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <SectionTitle color={background.textColor} shadowColor={background.textShadowColor}>Account</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]} onPress={() => openPage('account')} testID="settings-account-row">
          <Row
            icon="User"
            title={user?.name || 'Your account'}
            detail={user?.email || 'Account identity and sign-in'}
            value="Account"
          />
        </ContentSurface>

        <SectionTitle color={background.textColor} shadowColor={background.textShadowColor}>Preferences</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]} testID="settings-preferences">
          <View style={styles.preferenceBlock}>
            <View style={styles.preferenceHeading}>
              <Icon name="Ruler" size={IconSize.sm} color={theme.icon} />
              <View style={styles.rowCopy}>
                <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Units</Text>
                <Text style={[styles.rowDetail, { color: theme.textSecondary }]}>Distance, elevation, speed and pace</Text>
              </View>
            </View>
            <SegmentedControl<UnitsPref>
              value={units}
              segments={UNITS_SEGMENTS}
              onChange={(value) => updateSetting('units', value)}
              testID="settings-units"
            />
          </View>
          <Divider color={background.settingsCardBorderColor} />
          <View style={styles.preferenceBlock}>
            <View style={styles.preferenceHeading}>
              <Icon name="Sun" size={IconSize.sm} color={theme.icon} />
              <View style={styles.rowCopy}>
                <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Appearance</Text>
                <Text style={[styles.rowDetail, { color: theme.textSecondary }]}>Auto follows Cairn’s local daylight rhythm</Text>
              </View>
            </View>
            <SegmentedControl<AppearancePref>
              value={appearance}
              segments={APPEARANCE_SEGMENTS}
              onChange={(value) => updateSetting('appearance', value)}
              testID="settings-appearance"
            />
          </View>
          <Divider color={background.settingsCardBorderColor} />
          <ToggleRow
            icon="Vibrate"
            title="Haptics"
            detail="Gentle feedback for Cairn actions"
            value={hapticFeedback}
            onChange={(value) => {
              updateSetting('hapticFeedback', value);
              if (value) haptic.selection();
            }}
            testID="settings-haptics"
          />
          <Divider color={background.settingsCardBorderColor} />
          <ToggleRow
            icon="Compass"
            title="Explore while Cairn is open"
            detail={permissionStatus === 'granted'
              ? 'Updates exploration outside an Activity while the app is on screen'
              : 'Needs foreground location permission; Activities are separate'}
            value={exploreEnabled}
            disabled={permissionLoading}
            onChange={(value) => void handleExploreChange(value)}
            testID="settings-explore-open"
          />
        </ContentSurface>

        <SectionTitle color={background.textColor} shadowColor={background.textShadowColor}>Privacy & Data</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]} onPress={() => openPage('privacy')} testID="settings-privacy-row">
          <Row icon="Shield" title="Privacy & Data" detail="Location, export and exploration history" value="Review" />
        </ContentSurface>

        <SectionTitle color={background.textColor} shadowColor={background.textShadowColor}>Help & About</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]} onPress={() => openPage('help')} testID="settings-help-row">
          <Row icon="MessageSquare" title="Help & About" detail="Feedback, support, terms and app information" value="Open" />
        </ContentSurface>
        <Text style={[styles.footer, { color: background.textColor }]}>Ngā mihi nui — thanks for using Cairn.</Text>
      </ScrollView>
    </>
  );

  const renderAccount = () => (
    <>
      {renderHeader('Account')}
      <ScrollView testID="settings-account" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={[styles.intro, { color: background.textColor, textShadowColor: background.textShadowColor }]}>Your identity and account actions.</Text>
        <ContentSurface style={[styles.surface, surfaceStyle]}>
          <Row icon="User" title={user?.name || 'Cairn user'} detail="Name" />
          <Divider color={background.settingsCardBorderColor} />
          <Row icon="Mail" title={user?.email || 'Email unavailable'} detail="Account email · not currently changeable in the app" />
          <Divider color={background.settingsCardBorderColor} />
          <Row
            icon="KeyRound"
            title="Sign-in method"
            detail={providerSummary(user?.hasPassword, user?.providers)}
            value={profileLoading ? 'Checking…' : undefined}
          />
        </ContentSurface>

        <SectionTitle color={background.textColor} shadowColor={background.textShadowColor}>Account actions</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]}>
          <Row
            icon="Pencil"
            title="Edit name"
            detail="Change how your name appears in Cairn"
            onPress={() => {
              setNameDraft(user?.name || '');
              setNameError('');
              setNameOpen(true);
            }}
            testID="settings-edit-name"
          />
          {user?.hasPassword === true ? (
            <>
              <Divider color={background.settingsCardBorderColor} />
              <Row
                icon="KeyRound"
                title="Change password"
                detail="Requires your current Cairn password"
                onPress={() => {
                  setCurrentPassword('');
                  setNextPassword('');
                  setPasswordConfirmation('');
                  setPasswordError('');
                  setPasswordOpen(true);
                }}
                testID="settings-change-password"
              />
            </>
          ) : user?.hasPassword === false ? (
            <>
              <Divider color={background.settingsCardBorderColor} />
              <Row
                icon={user.providers?.includes('apple') ? 'Apple' : 'KeyRound'}
                title="Password managed by your provider"
                detail={`Use ${providerSummary(false, user.providers)} to manage sign-in security`}
              />
            </>
          ) : null}
          <Divider color={background.settingsCardBorderColor} />
          <Row icon="LogOut" title="Sign out" detail="Keep this account and its saved data" onPress={handleSignOut} testID="settings-sign-out" />
        </ContentSurface>

        <SectionTitle color={background.textColor} shadowColor={background.textShadowColor}>Delete account</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]}>
          <Row
            icon="Trash2"
            title="Delete account"
            detail="Seven days to restore, then permanent deletion"
            destructive
            onPress={() => {
              setDeletePhrase('');
              setDeleteError('');
              setDeleteOpen(true);
            }}
            testID="settings-delete-account"
          />
        </ContentSurface>
      </ScrollView>
    </>
  );

  const renderExportState = () => {
    if (exportLoading) {
      return <View style={styles.asyncRow}><ActivityIndicator color={theme.primary} /><Text style={[styles.statusText, { color: theme.textSecondary }]}>Checking export status…</Text></View>;
    }
    if (!latestExport) {
      return <Text style={[styles.body, { color: theme.textSecondary }]}>No export has been requested on this account.</Text>;
    }
    if ((latestExport.status === 'ready' || latestExport.status === 'sent') && !exportExpired && latestExport.download_url) {
      return (
        <View style={styles.stackSmall}>
          <Text style={[styles.statusStrong, { color: theme.textPrimary }]}>Ready to download</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>JSON · {formatBytes(latestExport.size_bytes) || 'size unavailable'} · link expires {new Date(latestExport.expires_at || '').toLocaleString()}</Text>
          <PrimaryButton label="Open download" variant="secondary" onPress={() => void Linking.openURL(latestExport.download_url!)} testID="settings-export-download" />
        </View>
      );
    }
    if (latestExport.status === 'queued' || latestExport.status === 'building') {
      return <View style={styles.asyncRow}><ActivityIndicator color={theme.primary} /><Text style={[styles.statusText, { color: theme.textSecondary }]}>Preparing your export. You can leave this page and return later.</Text></View>;
    }
    if (latestExport.status === 'failed') {
      return <Text style={[styles.statusText, { color: theme.destructive }]}>The export could not be prepared. Your data is unchanged; request it again.</Text>;
    }
    if (exportExpired || latestExport.status === 'expired') {
      return <Text style={[styles.statusText, { color: theme.textSecondary }]}>The previous download expired. Request a fresh export when you need it.</Text>;
    }
    return <Text style={[styles.statusText, { color: theme.textSecondary }]}>Export status: {latestExport.status}</Text>;
  };

  const renderPrivacy = () => (
    <>
      {renderHeader('Privacy & Data')}
      <ScrollView testID="settings-privacy" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={[styles.intro, { color: background.textColor, textShadowColor: background.textShadowColor }]}>Clear controls and accurate status for location and your data.</Text>

        <SectionTitle color={background.textColor} shadowColor={background.textShadowColor}>Location</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]}>
          <Row
            icon="MapPin"
            title="Foreground location"
            detail={permissionStatus === 'granted'
              ? 'Allowed by iOS for features used while Cairn is open'
              : permissionStatus === 'denied'
                ? 'Off in iOS; Cairn cannot override this permission'
                : 'Permission status is unavailable'}
            value={permissionStatus === 'granted' ? 'Allowed' : 'Off'}
          />
          {permissionStatus !== 'granted' && !permissionCanAskAgain ? (
            <>
              <Divider color={background.settingsCardBorderColor} />
              <Row icon="ExternalLink" title="Open system Settings" detail="Review Cairn’s location permission in iOS" external onPress={() => void Linking.openSettings()} testID="settings-open-os-settings" />
            </>
          ) : null}
          <Divider color={background.settingsCardBorderColor} />
          <Row
            icon="Compass"
            title="Explore while Cairn is open"
            detail={exploreEnabled && permissionStatus === 'granted'
              ? 'On · updates exploration only while the app is foregrounded and no Activity is recording'
              : exploreEnabled
                ? 'On in Cairn · unavailable until foreground location is allowed in iOS'
                : 'Off · Hike and Run recording is separate'}
            value={exploreEnabled ? 'On' : 'Off'}
          />
        </ContentSurface>

        <SectionTitle color={background.textColor} shadowColor={background.textShadowColor}>Your data</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]} testID="settings-export-card">
          <View style={styles.cardHeading}>
            <Icon name="Download" size={IconSize.md} color={theme.icon} />
            <View style={styles.rowCopy}>
              <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Export your data</Text>
              <Text style={[styles.body, { color: theme.textSecondary }]}>Request a JSON copy, track preparation here, then open the download when it is ready.</Text>
            </View>
          </View>
          {renderExportState()}
          {exportError ? <Text accessibilityLiveRegion="polite" style={[styles.error, { color: theme.destructive }]}>{exportError}</Text> : null}
          {latestExport?.status !== 'queued' && latestExport?.status !== 'building' ? (
            <PrimaryButton
              label={latestExport?.status === 'failed' || exportExpired ? 'Request fresh export' : 'Request export'}
              loading={exportRequesting}
              onPress={() => void (async () => {
                if (exportFlight.current) return;
                exportFlight.current = true;
                setExportRequesting(true);
                setExportError('');
                try {
                  const result = await requestDataExport();
                  if (result.error) setExportError(result.error);
                  await refreshExports(true);
                } finally {
                  exportFlight.current = false;
                  setExportRequesting(false);
                }
              })()}
              testID="settings-export-request"
            />
          ) : null}
        </ContentSurface>

        <ContentSurface style={[styles.surface, surfaceStyle]}>
          <Row
            icon="Trash2"
            title="Delete exploration history"
            detail="Deletes Memory points and derived explored regions; keeps Activities, Routes and Cairns"
            destructive
            onPress={() => Alert.alert(
              'Delete exploration history?',
              'This permanently removes your Memory points and explored-region progress from Cairn and this device. Activities, Routes and Cairns stay.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete history',
                  style: 'destructive',
                  onPress: () => void (async () => {
                    setMemoryDeleting(true);
                    const ok = await deleteAllMemoryFromServer();
                    setMemoryDeleting(false);
                    Alert.alert(ok ? 'Exploration history deleted' : 'Could not delete history', ok
                      ? 'Your Activities, Routes and Cairns were not changed.'
                      : 'Nothing was removed. Check your connection and try again.');
                  })(),
                },
              ],
            )}
            testID="settings-delete-exploration"
          />
          {memoryDeleting ? <ActivityIndicator style={styles.inlineLoader} color={theme.destructive} /> : null}
        </ContentSurface>

        <SectionTitle color={background.textColor} shadowColor={background.textShadowColor}>Privacy</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]}>
          <Row
            icon="Info"
            title="How Cairn uses data"
            detail="Activities use location while recording. Optional foreground exploration uses location only while Cairn is open. Limited operational diagnostics support reliability; internal QA telemetry is separately gated."
          />
          <Divider color={background.settingsCardBorderColor} />
          <Row icon="Shield" title="Privacy Policy" detail="Read the full current policy" external onPress={() => void Linking.openURL(PRIVACY_URL)} testID="settings-privacy-policy" />
        </ContentSurface>
      </ScrollView>
    </>
  );

  const renderHelp = () => (
    <>
      {renderHeader('Help & About')}
      <ScrollView testID="settings-help" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={[styles.intro, { color: background.textColor, textShadowColor: background.textShadowColor }]}>Send a message, find support, or review Cairn’s legal information.</Text>

        <SectionTitle color={background.textColor} shadowColor={background.textShadowColor}>Feedback</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]} testID="settings-feedback-card">
          <SegmentedControl<FeedbackKind>
            value={feedbackKind}
            segments={FEEDBACK_SEGMENTS}
            onChange={(value) => {
              setFeedbackKind(value);
              if (feedbackState === 'sent') setFeedbackState('idle');
            }}
            testID="settings-feedback-kind"
          />
          <TextField
            testID="settings-feedback-input"
            label={feedbackKind === 'bug' ? 'What went wrong?' : 'Your message'}
            value={feedbackText}
            onChangeText={(value) => {
              setFeedbackText(value.slice(0, 2000));
              if (feedbackState === 'sent') setFeedbackState('idle');
            }}
            multiline
            textAlignVertical="top"
            inputStyle={styles.feedbackInput}
            placeholder={feedbackKind === 'bug' ? 'Tell us what happened and what you expected.' : 'What would make Cairn better for you?'}
            error={feedbackState === 'failed' ? feedbackError : undefined}
          />
          <Text style={[styles.counter, { color: theme.textMuted }]}>{feedbackText.trim().length}/2000</Text>
          {feedbackState === 'sent' ? (
            <View accessibilityLiveRegion="polite" style={[styles.deliveryStatus, { backgroundColor: theme.recordSelected, borderColor: theme.borderStrong }]}>
              <Icon name="CircleCheck" size={IconSize.sm} color={theme.primary} />
              <Text style={[styles.statusStrong, { color: theme.textPrimary }]}>Delivered to Cairn</Text>
            </View>
          ) : null}
          <PrimaryButton
            label={feedbackState === 'failed' ? 'Retry delivery' : 'Send feedback'}
            loading={feedbackState === 'sending'}
            disabled={feedbackText.trim().length < 3}
            renderIcon={(color) => <Icon name="Send" size={IconSize.sm} color={color} />}
            onPress={() => void (async () => {
              if (feedbackFlight.current) return;
              feedbackFlight.current = true;
              setFeedbackState('sending');
              setFeedbackError('');
              try {
                const result = await submitFeedback({
                  submissionId: feedbackSubmissionId,
                  kind: feedbackKind,
                  message: feedbackText,
                  appVersion: Application.nativeApplicationVersion,
                });
                if (result.acknowledged) {
                  setFeedbackState('sent');
                  setFeedbackText('');
                  setFeedbackSubmissionId(Crypto.randomUUID());
                  haptic.notification('success');
                } else {
                  setFeedbackState('failed');
                  setFeedbackError(result.error || 'Feedback was not delivered. Try again.');
                }
              } finally {
                feedbackFlight.current = false;
              }
            })()}
            testID="settings-feedback-send"
          />
          <Text style={[styles.body, { color: theme.textMuted }]}>Feedback is not an emergency or monitored safety service.</Text>
        </ContentSurface>

        <SectionTitle color={background.textColor} shadowColor={background.textShadowColor}>Support & legal</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]}>
          <Row icon="Mail" title="Contact support" detail="support@cairnapp.nz" external onPress={() => void Linking.openURL('mailto:support@cairnapp.nz')} testID="settings-support" />
          <Divider color={background.settingsCardBorderColor} />
          <Row icon="Shield" title="Privacy Policy" external onPress={() => void Linking.openURL(PRIVACY_URL)} />
          <Divider color={background.settingsCardBorderColor} />
          <Row icon="FileText" title="Terms" detail="Apple Standard EULA" external onPress={() => void Linking.openURL(TERMS_URL)} testID="settings-terms" />
        </ContentSurface>

        <SectionTitle color={background.textColor} shadowColor={background.textShadowColor}>About</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]} testID="settings-about">
          <Row
            icon="Info"
            title="Cairn"
            detail="A quiet record of the places you have moved through."
            value={`v${Application.nativeApplicationVersion || '—'}${Application.nativeBuildVersion ? ` (${Application.nativeBuildVersion})` : ''}`}
          />
        </ContentSurface>
      </ScrollView>
    </>
  );

  return (
    <View style={[styles.root, { backgroundColor: background.settingsBackgroundColor }]}>
      <Image source={background.bgAsset} style={[styles.backgroundImage, backgroundLayout]} resizeMode="cover" />
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: background.settingsVeilColor }]} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {page === 'root' ? renderRoot() : page === 'account' ? renderAccount() : page === 'privacy' ? renderPrivacy() : renderHelp()}
      </SafeAreaView>

      <ModalCard visible={nameOpen} onDismiss={() => !nameSaving && setNameOpen(false)} dismissible={!nameSaving} testID="settings-name-modal">
        <ModalCardHeader title="Edit name" body="This is how your name appears in Cairn." onClose={() => setNameOpen(false)} />
        <TextField
          label="Name"
          value={nameDraft}
          onChangeText={(value) => { setNameDraft(value.slice(0, 32)); setNameError(''); }}
          autoCapitalize="words"
          error={nameError || undefined}
          testID="settings-name-input"
        />
        <View style={styles.modalActions}>
          <PrimaryButton label="Cancel" variant="secondary" disabled={nameSaving} onPress={() => setNameOpen(false)} style={styles.flexButton} />
          <PrimaryButton
            label="Save"
            loading={nameSaving}
            disabled={!nameDraft.trim()}
            onPress={() => void (async () => {
              setNameSaving(true);
              const result = await patchName(nameDraft.trim());
              if (result.user) {
                setUser(user ? { ...user, ...result.user } : result.user);
                setNameOpen(false);
              } else setNameError(result.error || 'Name could not be saved.');
              setNameSaving(false);
            })()}
            style={styles.flexButton}
            testID="settings-name-save"
          />
        </View>
      </ModalCard>

      <ModalCard visible={passwordOpen} onDismiss={() => !passwordSaving && setPasswordOpen(false)} dismissible={!passwordSaving} testID="settings-password-modal">
        <ModalCardHeader title="Change password" body="Other signed-in devices will be signed out." onClose={() => setPasswordOpen(false)} />
        <View style={styles.stackSmall}>
          <TextField label="Current password" value={currentPassword} onChangeText={(value) => { setCurrentPassword(value); setPasswordError(''); }} secureTextEntry autoCapitalize="none" testID="settings-current-password" />
          <TextField label="New password" value={nextPassword} onChangeText={(value) => { setNextPassword(value); setPasswordError(''); }} secureTextEntry autoCapitalize="none" testID="settings-new-password" />
          <TextField label="Confirm new password" value={passwordConfirmation} onChangeText={(value) => { setPasswordConfirmation(value); setPasswordError(''); }} secureTextEntry autoCapitalize="none" error={passwordError || undefined} testID="settings-confirm-password" />
        </View>
        <View style={styles.modalActions}>
          <PrimaryButton label="Cancel" variant="secondary" disabled={passwordSaving} onPress={() => setPasswordOpen(false)} style={styles.flexButton} />
          <PrimaryButton
            label="Update"
            loading={passwordSaving}
            disabled={!currentPassword || nextPassword.length < 8 || passwordConfirmation.length < 8}
            onPress={() => void (async () => {
              if (nextPassword !== passwordConfirmation) {
                setPasswordError('New passwords do not match.');
                return;
              }
              setPasswordSaving(true);
              const result = await changePassword(currentPassword, nextPassword);
              if (result.error) setPasswordError(result.error);
              else {
                setPasswordOpen(false);
                void refreshProfile();
                Alert.alert('Password updated', 'This device remains signed in. Other sessions have been revoked.');
              }
              setPasswordSaving(false);
            })()}
            style={styles.flexButton}
            testID="settings-password-save"
          />
        </View>
      </ModalCard>

      <ModalCard visible={deleteOpen} onDismiss={() => !deleteSaving && setDeleteOpen(false)} dismissible={!deleteSaving} testID="settings-delete-modal">
        <ModalCardHeader
          title="Delete your account?"
          body="Your account will be disabled now. You can restore server-backed data by signing in during the next seven days. After that, Cairn permanently deletes your profile, Activities, Routes, Cairns, Memory, friendships, exports, feedback and account-linked diagnostics. Account data on this device is cleared now; unsynced device-only data cannot be restored."
          onClose={() => setDeleteOpen(false)}
        />
        <TextField
          label="Type delete account to confirm"
          value={deletePhrase}
          onChangeText={(value) => { setDeletePhrase(value); setDeleteError(''); }}
          autoCapitalize="none"
          error={deleteError || undefined}
          testID="settings-delete-phrase"
        />
        <View style={styles.stackSmall}>
          <PrimaryButton label="Keep account" variant="secondary" disabled={deleteSaving} onPress={() => setDeleteOpen(false)} />
          <PrimaryButton
            label="Delete account"
            variant="destructive"
            loading={deleteSaving}
            disabled={deletePhrase.trim().toLowerCase() !== 'delete account' || !user?.id}
            onPress={() => void (async () => {
              if (!user?.id || deleteFlight.current) return;
              deleteFlight.current = true;
              const ownerId = String(user.id);
              setDeleteSaving(true);
              setDeleteError('');
              const result = await deleteAccount();
              if (result.error) {
                setDeleteError(result.error === 'not_signed_in' ? 'Your session ended. Sign in again before deleting your account.' : result.error);
                setDeleteSaving(false);
                deleteFlight.current = false;
                return;
              }
              let purgeScheduled = true;
              try {
                await scheduleDeletedAccountLocalPurge(ownerId);
              } catch {
                // Continue with the immediate purge even if both durable marker
                // stores are unavailable. If that purge also fails, the user is
                // told that this installation is not safe for another account.
                purgeScheduled = false;
              }
              const deadline = result.restoreDeadline ? new Date(result.restoreDeadline).toLocaleString() : 'seven days from now';
              let localCleanupDeferred = false;
              try {
                await appLogout();
                await completeDeletedAccountLocalPurge(ownerId);
                await clearCredentials();
                await logout();
              } catch (error) {
                // The server transaction has already accepted deletion. Keep
                // moving to signed-out state. When it was written successfully,
                // the durable purge marker retries owner-scoped cleanup before
                // the next account can hydrate.
                localCleanupDeferred = true;
                useAppStore.setState({ isLoggedIn: false, user: null });
                await clearCredentials().catch(() => undefined);
                await logout().catch(() => undefined);
              }
              setDeleteOpen(false);
              setDeleteSaving(false);
              deleteFlight.current = false;
              if (localCleanupDeferred && !purgeScheduled) {
                Alert.alert(
                  'Account deletion accepted',
                  'Cairn could not confirm that all account data was cleared from this installation. Do not sign another account into this installation; reinstall Cairn first.',
                );
              } else if (localCleanupDeferred) {
                Alert.alert(
                  'Account scheduled for deletion',
                  `You can restore server-backed data by signing in before ${deadline}. Cairn will retry clearing this device before another account is loaded.`,
                );
              } else {
                Alert.alert('Account scheduled for deletion', `You can restore server-backed data by signing in before ${deadline}. After that it cannot be recovered.`);
              }
            })()}
            testID="settings-delete-confirm"
          />
        </View>
      </ModalCard>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  backgroundImage: { position: 'absolute' },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
  },
  headerSpacer: { width: 54 },
  pageTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: FontSize.h2,
    fontWeight: '700',
    letterSpacing: -0.3,
    textShadowRadius: 5,
    textShadowOffset: { width: 0, height: 1 },
  },
  scroll: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl + Spacing.xl,
  },
  sectionTitle: {
    marginTop: Spacing.xl,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    fontSize: FontSize.small,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
  intro: {
    fontSize: FontSize.body,
    lineHeight: 22,
    fontWeight: '600',
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
  surface: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    overflow: 'hidden',
  },
  row: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: { flex: 1 },
  rowTitle: { fontSize: FontSize.body, fontWeight: '700', lineHeight: 20 },
  rowDetail: { fontSize: FontSize.caption, lineHeight: 18, marginTop: 2 },
  rowValue: { maxWidth: 92, fontSize: FontSize.caption, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 62 },
  disabled: { opacity: 0.58 },
  preferenceBlock: { padding: Spacing.base, gap: Spacing.md },
  preferenceHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  footer: { textAlign: 'center', fontSize: FontSize.caption, fontWeight: '600', marginTop: Spacing.xxl, opacity: 0.82 },
  cardHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, padding: Spacing.base, paddingBottom: Spacing.sm },
  cardTitle: { fontSize: FontSize.h3, fontWeight: '700', lineHeight: 23 },
  body: { fontSize: FontSize.caption, lineHeight: 19 },
  statusText: { flex: 1, fontSize: FontSize.caption, lineHeight: 19, fontWeight: '600' },
  statusStrong: { fontSize: FontSize.body, lineHeight: 20, fontWeight: '700' },
  asyncRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.base },
  stackSmall: { gap: Spacing.md, padding: Spacing.base },
  error: { fontSize: FontSize.caption, lineHeight: 18, fontWeight: '600', marginHorizontal: Spacing.base, marginBottom: Spacing.md },
  inlineLoader: { position: 'absolute', right: Spacing.base, top: Spacing.xl },
  feedbackInput: { minHeight: 116, paddingTop: Spacing.md },
  counter: { textAlign: 'right', fontSize: FontSize.small, marginTop: -Spacing.sm },
  deliveryStatus: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderWidth: 1, borderRadius: Radius.button, padding: Spacing.md },
  modalActions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.lg },
  flexButton: { flex: 1 },
});
