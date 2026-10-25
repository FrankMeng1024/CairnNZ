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
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { BackButton } from '../components/BackButton';
import { ContentSurface } from '../components/ContentSurface';
import { Icon, type IconName } from '../components/Icon';
import { ModalCard, ModalCardHeader } from '../components/ModalCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { SegmentedControl } from '../components/SegmentedControl';
import { TextField } from '../components/TextField';
import { PasswordField } from '../components/PasswordField';
import { FontSize, IconSize, Radius, Spacing } from '../components/tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { useScenicTimeState } from '../hooks/useScenicTimeState';
import { useAppStore } from '../store/useAppStore';
import { useSettingsStore, type AppearancePref, type UnitsPref } from '../store/useSettingsStore';
import {
  AUTOMATIC_EXPLORATION_DISCLOSURE_VERSION,
  PASSIVE_BACKGROUND_CONSENT_VERSION,
  useMemorySettingsStore,
} from '../features/memory/store/useMemorySettingsStore';
import { passiveBackgroundMemoryCapability } from '../features/memory/services/passiveMemoryCapability';
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
import { deleteAllMemoryFromServer } from '../services/memorySync';
import { authenticatedFetch } from '../services/apiService';
import { haptic } from '../services/hapticService';
import { PRIVACY_URL } from '../config/api';
import { getHomeBackground, getRegisteredBackgroundLayout, getWeatherReviewBackground } from '../utils/homeBackground';
import { PASSWORD_RULES, passwordPolicyError, passwordRuleState } from '../utils/passwordPolicy';
import { activitySimulatorBuildCapable } from '../features/activitySimulator/capability';
import { exportLatestActivityStageLedger } from '../features/activity/activityStageLedger';
import { exportActivityDiagnosticReplayIfPresent } from '../features/activity/activityDiagnosticReplay';
import {
  buildActivityNativeCrossLedgerReport,
  exportNativeGpsEvidence,
} from '../features/activity/nativeGpsEvidence';
import { offlineMapsFeatureEnabled } from '../features/offlineMaps/offlineMapContracts';
import {
  getEncounterNotificationState,
  setEncounterNotificationsEnabled,
  type EncounterNotificationState,
} from '../features/cairns/cairnEncounterNotifications';
import { cairnText, formatCairnDate } from '../i18n/runtime';

type Page = 'root' | 'account' | 'privacy' | 'content-review' | 'help';
type FeedbackKind = 'feedback' | 'bug';
type AsyncState = 'idle' | 'sending' | 'sent' | 'failed';
type Nav = NativeStackNavigationProp<RootStackParamList>;

interface MyReviewCase {
  id: number;
  case_type: 'report' | 'appeal';
  marker_id: number;
  cairn_revision_id: number | null;
  content_revision: number | null;
  category: string;
  state: 'pending' | 'reviewed' | 'dismissed' | 'actioned';
  content_state: 'available' | 'under_review' | 'unavailable' | 'removed';
  created_at: string;
  disposition_note: string | null;
  owner_case: boolean;
}

interface AffectedCairnRevision {
  revision_id: number;
  marker_id: number;
  content_revision: number;
  content_state: 'under_review' | 'unavailable';
  changed_at: string;
  appeal_pending: boolean;
}

const TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
const UNITS_SEGMENTS = [
  { key: 'metric', get label() { return cairnText('settings-screen.metric'); } },
  { key: 'imperial', get label() { return cairnText('settings-screen.imperial'); } },
] as const;
const APPEARANCE_SEGMENTS = [
  { key: 'auto', get label() { return cairnText('settings-screen.auto'); } },
  { key: 'day', get label() { return cairnText('settings-screen.day'); } },
  { key: 'sunset', get label() { return cairnText('settings-screen.sunset'); } },
  { key: 'night', get label() { return cairnText('settings-screen.night'); } },
] as const;
const FEEDBACK_SEGMENTS = [
  { key: 'feedback', get label() { return cairnText('settings-screen.feedback'); } },
  { key: 'bug', get label() { return cairnText('settings-screen.bug'); } },
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
  disabled = false,
  busy = false,
}: {
  icon: IconName;
  title: string;
  detail?: string;
  value?: string;
  onPress?: () => void;
  testID?: string;
  destructive?: boolean;
  external?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  const theme = useVisualTheme();
  const body = (
    <>
      <View style={[styles.rowIcon, { backgroundColor: destructive ? theme.destructiveSurface : theme.controlSelected }]}>
        <Icon name={icon} size={IconSize.sm} color={destructive ? theme.destructive : theme.icon} strokeWidth={1.9} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: destructive ? theme.destructive : theme.textPrimary }]}>{title}</Text>
        {detail ? (
          <Text
            accessibilityLabel={detail}
            style={[
              styles.rowDetail,
              { color: theme.textSecondary },
              Platform.OS === 'web' ? ({ wordBreak: 'break-all', overflowWrap: 'anywhere' } as any) : null,
            ]}
          >
            {detail}
          </Text>
        ) : null}
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
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, disabled && styles.disabled, pressed && { backgroundColor: theme.recordPressed }]}
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
  if (hasPassword === true) return names.length > 0 ? cairnText('settings-screen.email-value', { value1: names.join(' + ') }) : cairnText('settings-screen.email-password');
  if (hasPassword === false && names.length > 0) return names.join(' + ');
  return cairnText('settings-screen.checking-sign-in-method');
}

function currentOwnerId(): string | null {
  const state = useAppStore.getState();
  return state.isLoggedIn && state.user?.id ? String(state.user.id) : null;
}

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
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
  const renderedOwnerId = isLoggedIn && user?.id ? String(user.id) : null;
  const setUser = useAppStore((state) => state.setUser);
  const units = useSettingsStore((state) => state.units);
  const appearance = useSettingsStore((state) => state.appearance);
  const hapticFeedback = useSettingsStore((state) => state.hapticFeedback);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const exploreEnabled = useMemorySettingsStore((state) => state.passiveExplorationEnabled);
  const memoryLocationTransitionRequired = useMemorySettingsStore((state) => state.memoryLocationTransitionRequired);
  const automaticExplorationDisclosureVersion = useMemorySettingsStore(
    (state) => state.automaticExplorationDisclosureVersion,
  );
  const passiveBackgroundConsent = useMemorySettingsStore((state) => state.passiveBackgroundConsent);
  const passiveBackgroundEducationDismissed = useMemorySettingsStore(
    (state) => state.passiveBackgroundEducationDismissed,
  );
  const setMemorySetting = useMemorySettingsStore((state) => state.set);
  const passiveBackgroundCapability = passiveBackgroundMemoryCapability();
  const automaticExplorationEnabled = exploreEnabled
    && !memoryLocationTransitionRequired
    && automaticExplorationDisclosureVersion >= AUTOMATIC_EXPLORATION_DISCLOSURE_VERSION;

  const [page, setPage] = useState<Page>('root');
  const [permissionStatus, setPermissionStatus] = useState<string>('unknown');
  const [backgroundPermissionStatus, setBackgroundPermissionStatus] = useState<string>('unknown');
  const [permissionCanAskAgain, setPermissionCanAskAgain] = useState(true);
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [encounterNotifications, setEncounterNotifications] = useState<EncounterNotificationState>({
    supported: false,
    enabled: false,
    permission: 'unavailable',
    detail: cairnText('settings-screen.checking-this-installed-app'),
  });
  const [encounterNotificationsBusy, setEncounterNotificationsBusy] = useState(false);

  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameOwnerId, setNameOwnerId] = useState<string | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordOwnerId, setPasswordOwnerId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePhrase, setDeletePhrase] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteOwnerId, setDeleteOwnerId] = useState<string | null>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const qaTapCount = useRef(0);
  const qaTapReset = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [exports, setExports] = useState<DataExportSummary[]>([]);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportRequesting, setExportRequesting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportStateOwnerId, setExportStateOwnerId] = useState<string | null>(null);
  const [memoryDeleting, setMemoryDeleting] = useState(false);
  const [memoryDeleteOpen, setMemoryDeleteOpen] = useState(false);
  const [memoryDeleteResult, setMemoryDeleteResult] = useState('');
  const [activityDiagnosticsCopying, setActivityDiagnosticsCopying] = useState(false);
  const [reviewCases, setReviewCases] = useState<MyReviewCase[]>([]);
  const [affectedRevisions, setAffectedRevisions] = useState<AffectedCairnRevision[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [appealSubmittingRevisionId, setAppealSubmittingRevisionId] = useState<number | null>(null);

  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>('feedback');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackState, setFeedbackState] = useState<AsyncState>('idle');
  const [feedbackError, setFeedbackError] = useState('');
  const [feedbackSubmissionId, setFeedbackSubmissionId] = useState(() => Crypto.randomUUID());
  const feedbackFlight = useRef(false);
  const feedbackGeneration = useRef(0);
  const nameFlight = useRef(false);
  const nameGeneration = useRef(0);
  const passwordFlight = useRef(false);
  const passwordGeneration = useRef(0);
  const exportFlight = useRef(false);
  const exportGeneration = useRef(0);
  const deleteFlight = useRef(false);
  const deleteGeneration = useRef(0);
  const memoryDeleteFlight = useRef(false);
  const memoryDeleteGeneration = useRef(0);
  const settingsMounted = useRef(true);
  const priorRenderedOwnerId = useRef(renderedOwnerId);
  const profileRefreshGeneration = useRef(0);
  const reviewGeneration = useRef(0);

  useEffect(() => {
    settingsMounted.current = true;
    return () => {
      settingsMounted.current = false;
      profileRefreshGeneration.current += 1;
      memoryDeleteGeneration.current += 1;
      nameGeneration.current += 1;
      passwordGeneration.current += 1;
      deleteGeneration.current += 1;
      exportGeneration.current += 1;
      reviewGeneration.current += 1;
      exportFlight.current = false;
      feedbackGeneration.current += 1;
      feedbackFlight.current = false;
      if (qaTapReset.current) clearTimeout(qaTapReset.current);
    };
  }, []);

  useEffect(() => {
    if (priorRenderedOwnerId.current === renderedOwnerId) return;
    priorRenderedOwnerId.current = renderedOwnerId;
    // The old owner's request may still settle, but its local busy state and
    // single-flight lock must not become the newly rendered account's state.
    memoryDeleteGeneration.current += 1;
    memoryDeleteFlight.current = false;
    setMemoryDeleting(false);
    nameGeneration.current += 1;
    nameFlight.current = false;
    setNameSaving(false);
    setNameOpen(false);
    setNameDraft('');
    setNameError('');
    setNameOwnerId(null);
    passwordGeneration.current += 1;
    passwordFlight.current = false;
    setPasswordSaving(false);
    setPasswordOpen(false);
    setCurrentPassword('');
    setNextPassword('');
    setPasswordConfirmation('');
    setPasswordError('');
    setPasswordOwnerId(null);
    deleteFlight.current = false;
    deleteGeneration.current += 1;
    setDeleteSaving(false);
    setDeleteOpen(false);
    setDeletePhrase('');
    setDeleteError('');
    setDeleteOwnerId(null);
    setSignOutOpen(false);
    exportGeneration.current += 1;
    exportFlight.current = false;
    setExports([]);
    setExportLoading(false);
    setExportRequesting(false);
    setExportError('');
    setExportStateOwnerId(renderedOwnerId);
    setMemoryDeleteOpen(false);
    setMemoryDeleteResult('');
    reviewGeneration.current += 1;
    setReviewCases([]);
    setAffectedRevisions([]);
    setReviewLoading(false);
    setReviewError('');
    setAppealSubmittingRevisionId(null);
    feedbackGeneration.current += 1;
    feedbackFlight.current = false;
    setFeedbackKind('feedback');
    setFeedbackText('');
    setFeedbackState('idle');
    setFeedbackError('');
    setFeedbackSubmissionId(Crypto.randomUUID());
    setEncounterNotifications({ supported: false, enabled: false, permission: 'unavailable', detail: cairnText('settings-screen.checking-this-installed-app') });
    setEncounterNotificationsBusy(false);
  }, [renderedOwnerId]);

  const refreshPermission = useCallback(async () => {
    try {
      const [result, backgroundResult] = await Promise.all([
        Location.getForegroundPermissionsAsync(),
        Location.getBackgroundPermissionsAsync(),
      ]);
      setPermissionStatus(result.status);
      setBackgroundPermissionStatus(backgroundResult.status);
      setPermissionCanAskAgain(result.canAskAgain !== false);
    } catch {
      setPermissionStatus('unavailable');
      setBackgroundPermissionStatus('unavailable');
      setPermissionCanAskAgain(false);
    }
  }, []);

  const refreshEncounterNotifications = useCallback(async () => {
    const ownerId = currentOwnerId();
    if (!ownerId) return;
    const result = await getEncounterNotificationState(ownerId);
    if (settingsMounted.current && currentOwnerId() === ownerId) setEncounterNotifications(result);
  }, []);

  const refreshProfile = useCallback(async () => {
    const ownerId = currentOwnerId();
    if (!isLoggedIn || !ownerId) return;
    const generation = ++profileRefreshGeneration.current;
    setProfileLoading(true);
    const fresh = await getMe(ownerId);
    if (generation !== profileRefreshGeneration.current) return;
    if (fresh && String(fresh.id) === ownerId && currentOwnerId() === ownerId) setUser(fresh);
    setProfileLoading(false);
  }, [isLoggedIn, setUser]);

  const refreshExports = useCallback(async (quiet = false) => {
    const ownerId = currentOwnerId();
    if (!settingsMounted.current || !ownerId) return;
    const generation = ++exportGeneration.current;
    setExportStateOwnerId(ownerId);
    if (!quiet) setExportLoading(true);
    try {
      const result = await fetchExportHistory();
      if (!settingsMounted.current
        || generation !== exportGeneration.current
        || currentOwnerId() !== ownerId) return;
      setExports(result.exports);
      setExportError(result.error ?? '');
    } finally {
      if (settingsMounted.current
        && generation === exportGeneration.current
        && currentOwnerId() === ownerId) {
        setExportLoading(false);
      }
    }
  }, []);

  const refreshReviewCases = useCallback(async () => {
    const ownerId = currentOwnerId();
    if (!settingsMounted.current || !ownerId) return;
    const generation = ++reviewGeneration.current;
    setReviewLoading(true);
    setReviewError('');
    try {
      const response = await authenticatedFetch('/api/cairn-memory/review-cases/mine', {
        expectedUserId: ownerId,
      });
      const body = await response.json().catch(() => null);
      if (!settingsMounted.current || generation !== reviewGeneration.current
        || currentOwnerId() !== ownerId) return;
      if (!response.ok) throw new Error('review_cases_unavailable');
      setReviewCases(Array.isArray(body?.cases) ? body.cases : []);
      setAffectedRevisions(Array.isArray(body?.affected_revisions) ? body.affected_revisions : []);
    } catch {
      if (settingsMounted.current && generation === reviewGeneration.current
        && currentOwnerId() === ownerId) {
        setReviewError(cairnText('settings-screen.connect-to-review-content-issues-and-appeals'));
      }
    } finally {
      if (settingsMounted.current && generation === reviewGeneration.current
        && currentOwnerId() === ownerId) setReviewLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPermission();
    void refreshEncounterNotifications();
    void refreshProfile();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshPermission();
        void refreshEncounterNotifications();
      }
    });
    return () => subscription.remove();
  }, [refreshEncounterNotifications, refreshPermission, refreshProfile]);

  useEffect(() => {
    if (page !== 'privacy') return;
    void refreshExports();
  }, [page, refreshExports, renderedOwnerId]);

  useEffect(() => {
    if (page !== 'content-review') return;
    void refreshReviewCases();
  }, [page, refreshReviewCases, renderedOwnerId]);

  const exportStateIsCurrentOwner = !!renderedOwnerId && exportStateOwnerId === renderedOwnerId;
  const visibleExports = exportStateIsCurrentOwner ? exports : [];
  const visibleExportLoading = exportStateIsCurrentOwner && exportLoading;
  const visibleExportRequesting = exportStateIsCurrentOwner && exportRequesting;
  const visibleExportError = exportStateIsCurrentOwner ? exportError : '';
  const hasPendingExport = visibleExports.some((item) => item.status === 'queued' || item.status === 'building');
  useEffect(() => {
    if (page !== 'privacy' || !hasPendingExport) return;
    const timer = setInterval(() => void refreshExports(true), 4_000);
    return () => clearInterval(timer);
  }, [hasPendingExport, page, refreshExports]);

  const openPage = (next: Page) => {
    setPage(next);
    if (next === 'account') void refreshProfile();
  };

  const enableAutomaticExplorationAndEncounters = async () => {
    setPermissionLoading(true);
    try {
      let result = await Location.getForegroundPermissionsAsync();
      if (result.status !== Location.PermissionStatus.GRANTED && result.canAskAgain) {
        result = await Location.requestForegroundPermissionsAsync();
      }
      setPermissionStatus(result.status);
      setPermissionCanAskAgain(result.canAskAgain !== false);
      if (result.status === Location.PermissionStatus.GRANTED) {
        setMemorySetting(
          'automaticExplorationDisclosureVersion',
          AUTOMATIC_EXPLORATION_DISCLOSURE_VERSION,
        );
        setMemorySetting('passiveExplorationEnabled', true);
        setMemorySetting('memoryLocationTransitionRequired', false);
        haptic.selection();
        if (passiveBackgroundCapability.supported
          && passiveBackgroundConsent !== 'granted'
          && !passiveBackgroundEducationDismissed) {
          Alert.alert(
            cairnText('settings-screen.continue-in-the-background'),
            cairnText('settings-screen.automatic-exploration-and-encounters-work-in-the'),
            [
              { text: cairnText('settings-screen.not-now'), style: 'cancel' },
              {
                text: cairnText('settings-screen.don-t-show-again'),
                onPress: () => {
                  setMemorySetting('passiveBackgroundConsent', 'declined');
                  setMemorySetting('passiveBackgroundEducationDismissed', true);
                },
              },
              {
                text: cairnText('common.continue'),
                onPress: () => {
                  void (async () => {
                    const background = await Location.requestBackgroundPermissionsAsync();
                    setBackgroundPermissionStatus(background.status);
                    if (background.status === Location.PermissionStatus.GRANTED) {
                      setMemorySetting('passiveBackgroundConsent', 'granted');
                      setMemorySetting('passiveBackgroundConsentVersion', PASSIVE_BACKGROUND_CONSENT_VERSION);
                    } else {
                      setMemorySetting('passiveBackgroundConsent', 'declined');
                    }
                  })();
                },
              },
            ],
          );
        }
      } else {
        setMemorySetting('passiveExplorationEnabled', false);
        setMemorySetting('memoryLocationTransitionRequired', false);
        Alert.alert(
          cairnText('settings-screen.location-permission-is-off'),
          cairnText('settings-screen.cairn-needs-foreground-location-permission-for-automatic'),
          [
            { text: cairnText('settings-screen.not-now'), style: 'cancel' },
            ...(!result.canAskAgain ? [{ text: cairnText('settings-screen.open-settings'), onPress: () => void Linking.openSettings() }] : []),
          ],
        );
      }
    } finally {
      setPermissionLoading(false);
    }
  };

  const requestAutomaticExplorationChange = (next: boolean) => {
    const ownerId = currentOwnerId();
    if (!ownerId || permissionLoading) return;
    if (!next) {
      setMemorySetting('passiveExplorationEnabled', false);
      setMemorySetting('memoryLocationTransitionRequired', false);
      // Turning this preference off must not replay an earlier ordinary-walk
      // scan later. Activity evidence is retained because Hike/Run is
      // explicitly independent of this switch.
      void import('../features/public/services/walkingEncounterEvidence').then(service => (
        service.dropPassiveWalkingEncounterEvidence(ownerId)
      )).catch(() => undefined);
      return;
    }
    Alert.alert(
      cairnText('settings-screen.automatic-exploration-encounters'),
      cairnText('settings-screen.when-this-is-on-eligible-real-walking'),
      [
        { text: cairnText('settings-screen.keep-off'), style: 'cancel' },
        { text: cairnText('common.continue'), onPress: () => void enableAutomaticExplorationAndEncounters() },
      ],
    );
  };

  const copyActivityDiagnostics = async () => {
    const ownerId = currentOwnerId();
    if (!ownerId || activityDiagnosticsCopying) return;
    setActivityDiagnosticsCopying(true);
    try {
      const ledger = await exportLatestActivityStageLedger(ownerId);
      const nativeGpsEvidence = await exportNativeGpsEvidence(ownerId, ledger.clientActivityId);
      const nativeCrossLedgerReport = buildActivityNativeCrossLedgerReport(ledger, nativeGpsEvidence);
      const diagnosticReplay = ledger.clientActivityId
        ? await exportActivityDiagnosticReplayIfPresent({
          ownerUserId: ownerId,
          clientActivityId: ledger.clientActivityId,
          stageLedger: ledger,
        })
        : null;
      if (currentOwnerId() !== ownerId) return;
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(JSON.stringify({
        schema: 'cairn-activity-forensic-export',
        version: 3,
        stageLedger: ledger,
        nativeGpsEvidence,
        nativeCrossLedgerReport,
        diagnosticReplay,
      }, null, 2));
      if (currentOwnerId() !== ownerId) return;
      Alert.alert(
        cairnText('settings-screen.activity-diagnostics-copied'),
        diagnosticReplay
          ? cairnText('settings-screen.the-latest-opted-in-activity-replay-is')
          : ledger.clientActivityId
          ? cairnText('settings-screen.the-latest-local-timing-ledger-is-on')
          : cairnText('settings-screen.no-activity-timing-events-are-stored-on'),
      );
    } catch {
      if (currentOwnerId() === ownerId) {
        Alert.alert(cairnText('settings-screen.could-not-copy-diagnostics'), cairnText('settings-screen.try-again-after-reopening-cairnnz'));
      }
    } finally {
      if (currentOwnerId() === ownerId) setActivityDiagnosticsCopying(false);
    }
  };

  const handleSignOut = () => setSignOutOpen(true);

  const handleOwnerQaUnlock = () => {
    qaTapCount.current += 1;
    if (qaTapReset.current) clearTimeout(qaTapReset.current);
    qaTapReset.current = setTimeout(() => { qaTapCount.current = 0; }, 1800);
    if (qaTapCount.current < 5) return;
    qaTapCount.current = 0;
    if (qaTapReset.current) clearTimeout(qaTapReset.current);
    updateSetting('debugMode', true);
    haptic.notification('success');
    navigation.navigate(activitySimulatorBuildCapable ? 'Debug' : 'RouteDrawingDiagnostics');
  };

  const scrollContentStyle = useMemo(() => [
    styles.scroll,
    { paddingBottom: Spacing.xxl + Spacing.xl + Spacing.md },
  ], []);
  const subpageScrollContentStyle = useMemo(() => [
    styles.scroll,
    styles.subpageScroll,
    { paddingBottom: Spacing.xxl + Spacing.xl + Spacing.md },
  ], []);
  const scrollIndicatorInsets = useMemo(() => ({ bottom: 0 }), []);
  const latestExport = visibleExports[0] ?? null;
  const exportExpired = latestExport?.expires_at
    ? new Date(latestExport.expires_at).getTime() <= Date.now()
    : false;

  const renderHeader = (title: string) => (
    <View style={styles.header}>
      <BackButton
        variant="inline"
        label={cairnText('navigation.back')}
        onPress={() => page === 'root' ? navigation.goBack() : setPage('root')}
        testID="settings-back"
      />
      <Text style={[styles.pageTitle, { color: theme.foreground, textShadowColor: theme.surfaceElevated }]}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );

  const renderRoot = () => (
    <>
      {renderHeader(cairnText('settings-screen.settings'))}
      <ScrollView style={styles.pageScroll} testID="settings-root" showsVerticalScrollIndicator={false} scrollIndicatorInsets={scrollIndicatorInsets} contentContainerStyle={scrollContentStyle}>
        <SectionTitle color={theme.foreground} shadowColor={theme.surfaceElevated}>{cairnText('settings-screen.account')}</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]}>
          <Row
            icon="User"
            title={user?.name || cairnText('settings-screen.your-account')}
            detail={user?.email || cairnText('settings-screen.account-identity-and-sign-in')}
            value={cairnText('settings-screen.manage')}
            onPress={() => openPage('account')}
            testID="settings-account-row"
          />
        </ContentSurface>

        <SectionTitle color={theme.foreground} shadowColor={theme.surfaceElevated}>{cairnText('settings-screen.preferences')}</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]} testID="settings-preferences">
          <View style={styles.preferenceBlock}>
            <View style={styles.preferenceHeading}>
              <Icon name="Ruler" size={IconSize.sm} color={theme.icon} />
              <View style={styles.rowCopy}>
                <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>{cairnText('settings-screen.units')}</Text>
                <Text style={[styles.rowDetail, { color: theme.textSecondary }]}>{cairnText('settings-screen.distance-elevation-speed-and-pace')}</Text>
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
                <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>{cairnText('settings-screen.appearance')}</Text>
                <Text style={[styles.rowDetail, { color: theme.textSecondary }]}>{cairnText('settings-screen.auto-follows-cairn-s-local-daylight-rhythm')}</Text>
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
            title={cairnText('settings-screen.haptics')}
            detail={cairnText('settings-screen.gentle-feedback-for-cairn-actions')}
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
            title={cairnText('settings-screen.automatic-exploration')}
            detail={!automaticExplorationEnabled
              ? memoryLocationTransitionRequired
                ? cairnText('settings-screen.review-how-ordinary-eligible-walking-feeds-memory')
                : cairnText('settings-screen.off-ordinary-app-use-does-not-record')
              : permissionStatus === 'granted'
              ? passiveBackgroundCapability.supported
                && passiveBackgroundConsent === 'granted'
                && backgroundPermissionStatus === 'granted'
                ? cairnText('settings-screen.eligible-walks-update-memory-and-scan-for')
                : passiveBackgroundCapability.supported
                  ? cairnText('settings-screen.eligible-walks-update-memory-and-scan-for-6303fa5')
                  : cairnText('settings-screen.eligible-walks-update-memory-and-scan-for-a12baa6')
              : cairnText('settings-screen.on-but-waiting-for-foreground-location-permission')}
            value={automaticExplorationEnabled}
            disabled={permissionLoading}
            onChange={requestAutomaticExplorationChange}
            testID="settings-explore-open"
          />
          <Divider color={background.settingsCardBorderColor} />
          <ToggleRow
            icon="MapPin"
            title={cairnText('settings-screen.encounter-notifications')}
            detail={encounterNotifications.detail}
            value={encounterNotifications.enabled}
            disabled={!encounterNotifications.supported || encounterNotificationsBusy}
            onChange={(next) => {
              const ownerId = currentOwnerId();
              if (!ownerId || encounterNotificationsBusy) return;
              setEncounterNotificationsBusy(true);
              void setEncounterNotificationsEnabled(ownerId, next).then(result => {
                if (!settingsMounted.current || currentOwnerId() !== ownerId) return;
                setEncounterNotifications(result);
                if (next && !result.enabled && result.permission === 'denied') {
                  Alert.alert(
                    cairnText('settings-screen.notifications-are-off'),
                    cairnText('settings-screen.open-system-settings-to-allow-encounter-notifications'),
                    [
                      { text: cairnText('settings-screen.not-now'), style: 'cancel' },
                      { text: cairnText('settings-screen.open-settings'), onPress: () => void Linking.openSettings() },
                    ],
                  );
                }
              }).finally(() => {
                if (settingsMounted.current && currentOwnerId() === ownerId) setEncounterNotificationsBusy(false);
              });
            }}
            testID="settings-encounter-notifications"
          />
        </ContentSurface>

        <SectionTitle color={theme.foreground} shadowColor={theme.surfaceElevated}>{cairnText('settings-screen.privacy-data')}</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]}>
          <Row icon="Shield" title={cairnText('settings-screen.privacy-data')} detail={cairnText('settings-screen.location-export-and-exploration-history')} value={cairnText('settings-screen.review')} onPress={() => openPage('privacy')} testID="settings-privacy-row" />
          <Divider color={background.settingsCardBorderColor} />
          <Row icon="FileText" title={cairnText('settings-screen.content-issue-appeal')} detail={cairnText('settings-screen.track-reports-and-request-review-of-an')} value={cairnText('settings-screen.review')} onPress={() => openPage('content-review')} testID="settings-content-review-row" />
          {offlineMapsFeatureEnabled() ? (
            <>
              <Divider color={background.settingsCardBorderColor} />
              <Row icon="Download" title={cairnText('settings-screen.offline-maps')} detail={cairnText('settings-screen.download-basemap-areas-to-this-device')} value={cairnText('settings-screen.pilot')} onPress={() => navigation.navigate('OfflineMaps')} testID="settings-offline-maps-row" />
            </>
          ) : null}
        </ContentSurface>

        <SectionTitle color={theme.foreground} shadowColor={theme.surfaceElevated}>{cairnText('settings-screen.help-about')}</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]}>
          <Row icon="MessageSquare" title={cairnText('settings-screen.help-about')} detail={cairnText('settings-screen.feedback-support-terms-and-app-information')} value={cairnText('settings-screen.open')} onPress={() => openPage('help')} testID="settings-help-row" />
        </ContentSurface>
        <Pressable
          onPress={handleOwnerQaUnlock}
          accessibilityRole="text"
          testID="settings-owner-qa-unlock"
          style={styles.footerPressable}
        >
          <Text style={[styles.footer, { color: theme.foreground }]}>{cairnText('settings-screen.ng-mihi-nui-thanks-for-using-cairn')}</Text>
        </Pressable>
      </ScrollView>
    </>
  );

  const renderAccount = () => (
    <>
      {renderHeader(cairnText('settings-screen.account'))}
      <ScrollView style={styles.pageScroll} testID="settings-account" showsVerticalScrollIndicator={false} scrollIndicatorInsets={scrollIndicatorInsets} contentContainerStyle={scrollContentStyle}>
        <Text style={[styles.intro, { color: theme.foreground, textShadowColor: theme.surfaceElevated }]}>{cairnText('settings-screen.your-identity-and-account-actions')}</Text>
        <ContentSurface style={[styles.surface, surfaceStyle]}>
          <Row icon="User" title={user?.name || cairnText('settings-screen.cairn-user')} detail={cairnText('settings-screen.name-a93fc9a')} />
          <Divider color={background.settingsCardBorderColor} />
          <Row icon="Mail" title={user?.email || cairnText('settings-screen.email-unavailable')} detail={cairnText('settings-screen.account-email-not-currently-changeable-in-the')} />
          <Divider color={background.settingsCardBorderColor} />
          <Row
            icon="KeyRound"
            title={cairnText('settings-screen.sign-in-method')}
            detail={providerSummary(user?.hasPassword, user?.providers)}
            value={profileLoading ? cairnText('settings-screen.checking') : undefined}
          />
        </ContentSurface>

        <SectionTitle color={theme.foreground} shadowColor={theme.surfaceElevated}>{cairnText('settings-screen.account-actions')}</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]}>
          <Row
            icon="Pencil"
            title={cairnText('settings-screen.edit-name')}
            detail={cairnText('settings-screen.change-how-your-name-appears-in-cairn')}
            onPress={() => {
              setNameOwnerId(currentOwnerId());
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
                title={cairnText('settings-screen.change-password')}
                detail={cairnText('settings-screen.requires-your-current-cairn-password')}
                onPress={() => {
                  setPasswordOwnerId(currentOwnerId());
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
                title={cairnText('settings-screen.password-managed-by-your-provider')}
                detail={cairnText('settings-screen.use-value-to-manage-sign-in-security', { value1: providerSummary(false, user.providers) })}
              />
            </>
          ) : null}
          <Divider color={background.settingsCardBorderColor} />
          <Row icon="LogOut" title={cairnText('settings-screen.sign-out')} detail={cairnText('settings-screen.keep-this-account-and-its-saved-data')} onPress={handleSignOut} testID="settings-sign-out" />
        </ContentSurface>

        <SectionTitle color={theme.foreground} shadowColor={theme.surfaceElevated}>{cairnText('settings-screen.delete-account')}</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]}>
          <Row
            icon="Trash2"
            title={cairnText('settings-screen.delete-account')}
            detail={cairnText('settings-screen.seven-days-to-restore-then-permanent-deletion')}
            destructive
            onPress={() => {
              setDeleteOwnerId(currentOwnerId());
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
    if (visibleExportLoading) {
      return <View style={styles.asyncRow}><ActivityIndicator color={theme.primary} /><Text style={[styles.statusText, { color: theme.textSecondary }]}>{cairnText('settings-screen.checking-export-status')}</Text></View>;
    }
    if (!latestExport) {
      return <Text style={[styles.body, { color: theme.textSecondary }]}>{cairnText('settings-screen.no-export-has-been-requested-on-this')}</Text>;
    }
    if ((latestExport.status === 'ready' || latestExport.status === 'sent') && !exportExpired && latestExport.download_url) {
      return (
        <View style={styles.stackSmall}>
          <Text style={[styles.statusStrong, { color: theme.textPrimary }]}>{cairnText('settings-screen.ready-to-download')}</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>{cairnText('settings-screen.json-value-link-expires-value', { value1: formatBytes(latestExport.size_bytes) || cairnText('settings-screen.size-unavailable'), value2: formatCairnDate(new Date(latestExport.expires_at || ''), { dateStyle: 'medium', timeStyle: 'short' }) })}</Text>
          <PrimaryButton
            label={cairnText('settings-screen.open-download')}
            variant="secondary"
            onPress={() => {
              if (!settingsMounted.current
                || currentOwnerId() !== renderedOwnerId
                || exportStateOwnerId !== renderedOwnerId) return;
              void Linking.openURL(latestExport.download_url!);
            }}
            testID="settings-export-download"
          />
        </View>
      );
    }
    if (latestExport.status === 'queued' || latestExport.status === 'building') {
      return <View style={styles.asyncRow}><ActivityIndicator color={theme.primary} /><Text style={[styles.statusText, { color: theme.textSecondary }]}>{cairnText('settings-screen.preparing-your-export-you-can-leave-this')}</Text></View>;
    }
    if (latestExport.status === 'failed') {
      return <Text style={[styles.statusText, { color: theme.destructive }]}>{cairnText('settings-screen.the-export-could-not-be-prepared-your')}</Text>;
    }
    if (exportExpired || latestExport.status === 'expired') {
      return <Text style={[styles.statusText, { color: theme.textSecondary }]}>{cairnText('settings-screen.the-previous-download-expired-request-a-fresh')}</Text>;
    }
    return <Text style={[styles.statusText, { color: theme.textSecondary }]}>{cairnText('settings-screen.export-status-value', { status: latestExport.status })}</Text>;
  };

  const renderPrivacy = () => (
    <>
      {renderHeader(cairnText('settings-screen.privacy-data'))}
      <ScrollView style={styles.pageScroll} testID="settings-privacy" showsVerticalScrollIndicator={false} scrollIndicatorInsets={scrollIndicatorInsets} contentContainerStyle={subpageScrollContentStyle}>
        <ContentSurface style={[styles.surface, styles.infoHero, surfaceStyle]}>
          <View style={[styles.heroIcon, { backgroundColor: theme.controlSelected }]}><Icon name="Shield" size={IconSize.md} color={theme.primary} /></View>
          <View style={styles.rowCopy}>
            <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{cairnText('settings-screen.your-location-stays-under-your-control')}</Text>
            <Text style={[styles.body, { color: theme.textSecondary }]}>{cairnText('settings-screen.review-permissions-export-your-records-or-remove')}</Text>
          </View>
        </ContentSurface>

        <SectionTitle color={theme.foreground} shadowColor={theme.surfaceElevated}>{cairnText('settings-screen.location')}</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]}>
          <Row
            icon="MapPin"
            title={cairnText('settings-screen.foreground-location')}
            detail={permissionStatus === 'granted'
              ? cairnText('settings-screen.allowed-by-ios-for-features-used-while')
              : permissionStatus === 'denied'
                ? cairnText('settings-screen.off-in-ios-cairn-cannot-override-this')
                : cairnText('settings-screen.permission-status-is-unavailable')}
            value={permissionStatus === 'granted' ? cairnText('settings-screen.allowed') : cairnText('settings-screen.off')}
          />
          {permissionStatus !== 'granted' && !permissionCanAskAgain ? (
            <>
              <Divider color={background.settingsCardBorderColor} />
              <Row icon="ExternalLink" title={cairnText('settings-screen.open-system-settings')} detail={cairnText('settings-screen.review-cairn-s-location-permission-in-ios')} external onPress={() => void Linking.openSettings()} testID="settings-open-os-settings" />
            </>
          ) : null}
          <Divider color={background.settingsCardBorderColor} />
          <ToggleRow
            icon="Compass"
            title={cairnText('settings-screen.automatic-exploration')}
            detail={automaticExplorationEnabled && permissionStatus === 'granted'
              ? passiveBackgroundCapability.supported
                && passiveBackgroundConsent === 'granted'
                && backgroundPermissionStatus === 'granted'
                ? cairnText('settings-screen.on-ordinary-eligible-walks-feed-memory-and')
                : passiveBackgroundCapability.supported
                  ? cairnText('settings-screen.on-in-foreground-background-walking-was-not')
                  : cairnText('settings-screen.on-in-foreground-background-walking-needs-a', { value1: passiveBackgroundCapability.nativeBuild ?? cairnText('settings-screen.this-build') })
              : automaticExplorationEnabled
                ? cairnText('settings-screen.on-in-cairn-waiting-for-foreground-location')
                : memoryLocationTransitionRequired
                  ? cairnText('settings-screen.review-required-existing-off-choices-stay-off')
                  : cairnText('settings-screen.off-no-ordinary-use-exploration-or-encounter')}
            value={automaticExplorationEnabled}
            disabled={permissionLoading}
            onChange={requestAutomaticExplorationChange}
            testID="settings-privacy-automatic-exploration"
          />
        </ContentSurface>

        <SectionTitle color={theme.foreground} shadowColor={theme.surfaceElevated}>{cairnText('settings-screen.your-data')}</SectionTitle>
        <ContentSurface style={[styles.surface, styles.dataActionSurface, surfaceStyle]} testID="settings-export-card">
          <View style={styles.cardHeading}>
            <Icon name="Download" size={IconSize.md} color={theme.icon} />
            <View style={styles.rowCopy}>
              <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{cairnText('settings-screen.export-your-data')}</Text>
              <Text style={[styles.body, { color: theme.textSecondary }]}>{cairnText('settings-screen.request-a-json-copy-track-preparation-here')}</Text>
            </View>
          </View>
          <View style={styles.cardBody}>
            {renderExportState()}
            {visibleExportError ? <Text accessibilityLiveRegion="polite" style={[styles.cardError, { color: theme.destructive }]}>{visibleExportError}</Text> : null}
            {latestExport?.status !== 'queued' && latestExport?.status !== 'building' ? (
              <PrimaryButton
                label={latestExport?.status === 'failed' || exportExpired ? cairnText('settings-screen.request-fresh-export') : cairnText('settings-screen.request-export')}
                variant="secondary"
                renderIcon={(color) => <Icon name="Download" size={IconSize.sm} color={color} />}
                loading={visibleExportRequesting}
                onPress={() => void (async () => {
                const ownerId = currentOwnerId();
                if (exportFlight.current) return;
                if (!settingsMounted.current
                  || !ownerId
                  || ownerId !== renderedOwnerId) return;
                const generation = ++exportGeneration.current;
                exportFlight.current = true;
                setExportStateOwnerId(ownerId);
                setExportLoading(false);
                setExportRequesting(true);
                setExportError('');
                try {
                  const result = await requestDataExport();
                  if (!settingsMounted.current
                    || generation !== exportGeneration.current
                    || currentOwnerId() !== ownerId) return;
                  if (result.error) setExportError(result.error);
                  const history = await fetchExportHistory();
                  if (!settingsMounted.current
                    || generation !== exportGeneration.current
                    || currentOwnerId() !== ownerId) return;
                  setExports(history.exports);
                  setExportError(history.error ?? '');
                } finally {
                  if (settingsMounted.current
                    && generation === exportGeneration.current
                    && currentOwnerId() === ownerId) {
                    exportFlight.current = false;
                    setExportRequesting(false);
                  }
                }
                })()}
                testID="settings-export-request"
              />
            ) : null}
          </View>
        </ContentSurface>

        <ContentSurface style={[styles.surface, surfaceStyle]}>
          <Row
            icon="FileText"
            title={cairnText('settings-screen.copy-activity-diagnostics')}
            detail={cairnText('settings-screen.owner-debug-recordings-include-precise-coordinates-for')}
            onPress={() => void copyActivityDiagnostics()}
            disabled={activityDiagnosticsCopying}
            busy={activityDiagnosticsCopying}
            testID="settings-copy-activity-diagnostics"
          />
          <Divider color={background.settingsCardBorderColor} />
          <Row
            icon="Trash2"
            title={cairnText('settings-screen.delete-exploration-history')}
            detail={cairnText('settings-screen.deletes-memory-points-and-derived-explored-regions')}
            onPress={() => { setMemoryDeleteResult(''); setMemoryDeleteOpen(true); }}
            disabled={memoryDeleting}
            busy={memoryDeleting}
            testID="settings-delete-exploration"
          />
          {memoryDeleting ? <ActivityIndicator style={styles.inlineLoader} color={theme.destructive} /> : null}
          {memoryDeleteResult ? <Text accessibilityLiveRegion="polite" style={[styles.deleteResult, { color: memoryDeleteResult.startsWith('Deleted') ? theme.textSecondary : theme.destructive }]}>{memoryDeleteResult}</Text> : null}
        </ContentSurface>

        <SectionTitle color={theme.foreground} shadowColor={theme.surfaceElevated}>{cairnText('settings-screen.privacy')}</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]}>
          <Row
            icon="Info"
            title={cairnText('settings-screen.how-cairn-uses-data')}
            detail={cairnText('settings-screen.activities-use-location-while-recording-automatic-exploration')}
          />
          <Divider color={background.settingsCardBorderColor} />
          <Row icon="Shield" title={cairnText('settings-screen.privacy-policy')} detail={cairnText('settings-screen.read-the-full-current-policy')} external onPress={() => void Linking.openURL(PRIVACY_URL)} testID="settings-privacy-policy" />
        </ContentSurface>
      </ScrollView>
    </>
  );

  const renderHelp = () => (
    <>
      {renderHeader(cairnText('settings-screen.help-about'))}
      <ScrollView style={styles.pageScroll} testID="settings-help" showsVerticalScrollIndicator={false} scrollIndicatorInsets={scrollIndicatorInsets} contentContainerStyle={subpageScrollContentStyle} keyboardShouldPersistTaps="handled">
        <ContentSurface style={[styles.surface, styles.infoHero, surfaceStyle]}>
          <View style={[styles.heroIcon, { backgroundColor: theme.controlSelected }]}><Icon name="MessageSquare" size={IconSize.md} color={theme.primary} /></View>
          <View style={styles.rowCopy}>
            <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{cairnText('settings-screen.how-can-we-help')}</Text>
            <Text style={[styles.body, { color: theme.textSecondary }]}>{cairnText('settings-screen.send-feedback-contact-support-or-review-cairn')}</Text>
          </View>
        </ContentSurface>

        <SectionTitle color={theme.foreground} shadowColor={theme.surfaceElevated}>{cairnText('settings-screen.feedback')}</SectionTitle>
        <ContentSurface style={[styles.surface, styles.formSurface, surfaceStyle]} testID="settings-feedback-card">
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
            label={feedbackKind === 'bug' ? cairnText('settings-screen.what-went-wrong') : cairnText('settings-screen.your-message')}
            value={feedbackText}
            onChangeText={(value) => {
              setFeedbackText(value.slice(0, 2000));
              if (feedbackState === 'sent') setFeedbackState('idle');
            }}
            multiline
            textAlignVertical="top"
            inputStyle={styles.feedbackInput}
            placeholder={feedbackKind === 'bug' ? cairnText('settings-screen.tell-us-what-happened-and-what-you') : cairnText('settings-screen.what-would-make-cairn-better-for-you')}
            error={feedbackState === 'failed' ? feedbackError : undefined}
          />
          <Text style={[styles.counter, { color: theme.textMuted }]}>{cairnText('settings-screen.value-2000', { length: feedbackText.trim().length })}</Text>
          {feedbackState === 'sent' ? (
            <View accessibilityLiveRegion="polite" style={[styles.deliveryStatus, { backgroundColor: theme.recordSelected, borderColor: theme.borderStrong }]}>
              <Icon name="CircleCheck" size={IconSize.sm} color={theme.primary} />
              <Text style={[styles.statusStrong, { color: theme.textPrimary }]}>{cairnText('settings-screen.delivered-to-cairn')}</Text>
            </View>
          ) : null}
          <PrimaryButton
            label={feedbackState === 'failed' ? cairnText('settings-screen.retry-delivery') : cairnText('settings-screen.send-feedback')}
            loading={feedbackState === 'sending'}
            disabled={feedbackText.trim().length < 3}
            renderIcon={(color) => <Icon name="Send" size={IconSize.sm} color={color} />}
            onPress={() => void (async () => {
              const ownerId = renderedOwnerId;
              if (!settingsMounted.current
                || !ownerId
                || currentOwnerId() !== ownerId
                || feedbackFlight.current) return;
              const generation = ++feedbackGeneration.current;
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
                if (!settingsMounted.current
                  || currentOwnerId() !== ownerId
                  || generation !== feedbackGeneration.current) return;
                if (result.acknowledged) {
                  setFeedbackState('sent');
                  setFeedbackText('');
                  setFeedbackSubmissionId(Crypto.randomUUID());
                  haptic.notification('success');
                } else {
                  setFeedbackState('failed');
                  setFeedbackError(result.error || cairnText('settings-screen.feedback-was-not-delivered-try-again'));
                }
              } finally {
                if (settingsMounted.current
                  && currentOwnerId() === ownerId
                  && generation === feedbackGeneration.current) {
                  feedbackFlight.current = false;
                }
              }
            })()}
            testID="settings-feedback-send"
          />
          <Text style={[styles.body, { color: theme.textMuted }]}>{cairnText('settings-screen.feedback-is-not-an-emergency-or-monitored')}</Text>
        </ContentSurface>

        <SectionTitle color={theme.foreground} shadowColor={theme.surfaceElevated}>{cairnText('settings-screen.support-legal')}</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]}>
          <Row icon="Mail" title={cairnText('settings-screen.contact-support')} detail="support@cairnapp.nz" external onPress={() => void Linking.openURL('mailto:support@cairnapp.nz')} testID="settings-support" />
          <Divider color={background.settingsCardBorderColor} />
          <Row icon="Shield" title={cairnText('settings-screen.privacy-policy')} external onPress={() => void Linking.openURL(PRIVACY_URL)} />
          <Divider color={background.settingsCardBorderColor} />
          <Row icon="FileText" title={cairnText('settings-screen.terms')} detail="Apple Standard EULA" external onPress={() => void Linking.openURL(TERMS_URL)} testID="settings-terms" />
        </ContentSurface>

        <SectionTitle color={theme.foreground} shadowColor={theme.surfaceElevated}>{cairnText('settings-screen.about')}</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]} testID="settings-about">
          <Row
            icon="Info"
            title={cairnText('settings-screen.cairn')}
            detail={cairnText('settings-screen.a-quiet-record-of-the-places-you')}
            value={cairnText('settings-screen.v-value-value', { value1: Application.nativeApplicationVersion || '—', value2: Application.nativeBuildVersion ? ` (${Application.nativeBuildVersion})` : '' })}
          />
        </ContentSurface>
      </ScrollView>
    </>
  );

  const submitAppeal = async (revision: AffectedCairnRevision) => {
    const ownerId = currentOwnerId();
    if (!ownerId || appealSubmittingRevisionId != null) return;
    setAppealSubmittingRevisionId(revision.revision_id);
    setReviewError('');
    try {
      const response = await authenticatedFetch(
        `/api/cairn-memory/revisions/${revision.revision_id}/cases`,
        {
          method: 'POST',
          expectedUserId: ownerId,
          body: JSON.stringify({
            client_submission_id: Crypto.randomUUID(),
            case_type: 'appeal',
            category: 'other',
            detail: cairnText('settings-screen.author-requested-review-from-cairn-settings'),
          }),
        },
      );
      if (!response.ok) throw new Error('appeal_failed');
      await refreshReviewCases();
    } catch {
      if (currentOwnerId() === ownerId) setReviewError(cairnText('settings-screen.the-appeal-was-not-sent-connect-and'));
    } finally {
      if (currentOwnerId() === ownerId) setAppealSubmittingRevisionId(null);
    }
  };

  const renderContentReview = () => (
    <>
      {renderHeader(cairnText('settings-screen.content-issue-appeal'))}
      <ScrollView style={styles.pageScroll} testID="settings-content-review" showsVerticalScrollIndicator={false} scrollIndicatorInsets={scrollIndicatorInsets} contentContainerStyle={subpageScrollContentStyle}>
        <ContentSurface style={[styles.surface, styles.infoHero, surfaceStyle]}>
          <View style={[styles.heroIcon, { backgroundColor: theme.controlSelected }]}><Icon name="Shield" size={IconSize.md} color={theme.primary} /></View>
          <View style={styles.rowCopy}>
            <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{cairnText('settings-screen.review-states-are-separate-from-editing')}</Text>
            <Text style={[styles.body, { color: theme.textSecondary }]}>{cairnText('settings-screen.reports-enter-a-manual-queue-if-one')}</Text>
          </View>
        </ContentSurface>

        {reviewLoading ? <View style={styles.asyncRow}><ActivityIndicator color={theme.primary} /><Text style={[styles.statusText, { color: theme.textSecondary }]}>{cairnText('settings-screen.checking-content-review-status')}</Text></View> : null}
        {reviewError ? <Text accessibilityLiveRegion="polite" style={[styles.error, { color: theme.destructive }]}>{reviewError}</Text> : null}

        <SectionTitle color={theme.foreground} shadowColor={theme.surfaceElevated}>{cairnText('settings-screen.affected-cairns')}</SectionTitle>
        {affectedRevisions.length === 0 && !reviewLoading ? (
          <ContentSurface style={[styles.surface, surfaceStyle]}>
            <Row icon="CircleCheck" title={cairnText('settings-screen.no-affected-cairn-revisions')} detail={cairnText('settings-screen.nothing-on-this-account-currently-needs-an')} />
          </ContentSurface>
        ) : affectedRevisions.map(revision => (
          <ContentSurface key={revision.revision_id} style={[styles.surface, surfaceStyle]}>
            <Row
              icon="FileText"
              title={cairnText('settings-screen.cairn-value-revision-value', { marker_id: revision.marker_id, content_revision: revision.content_revision })}
              detail={revision.content_state === 'under_review'
                ? cairnText('settings-screen.under-review-content-is-hidden-while-the')
                : cairnText('settings-screen.unavailable-request-review-if-you-believe-this')}
              value={revision.appeal_pending ? cairnText('settings-screen.appeal-pending') : undefined}
            />
            {!revision.appeal_pending ? (
              <View style={styles.stackSmall}>
                <PrimaryButton
                  label={cairnText('settings-screen.request-review')}
                  variant="secondary"
                  loading={appealSubmittingRevisionId === revision.revision_id}
                  onPress={() => void submitAppeal(revision)}
                  testID={`settings-appeal-${revision.revision_id}`}
                />
              </View>
            ) : null}
          </ContentSurface>
        ))}

        <SectionTitle color={theme.foreground} shadowColor={theme.surfaceElevated}>{cairnText('settings-screen.your-submitted-cases')}</SectionTitle>
        <ContentSurface style={[styles.surface, surfaceStyle]}>
          {reviewCases.length === 0 && !reviewLoading ? (
            <Row icon="FileText" title={cairnText('settings-screen.no-submitted-cases')} detail={cairnText('settings-screen.reports-can-be-sent-from-acquired-cairn')} />
          ) : reviewCases.map((reviewCase, index) => (
            <React.Fragment key={reviewCase.id}>
              {index > 0 ? <Divider color={background.settingsCardBorderColor} /> : null}
              <Row
                icon="FileText"
                title={cairnText('settings-screen.value-cairn-value', { value1: reviewCase.case_type === 'appeal' ? cairnText('common.action.appeal') : cairnText('common.action.report'), marker_id: reviewCase.marker_id })}
                detail={cairnText('settings-screen.revision-value-value', { value1: reviewCase.content_revision ?? 'unavailable', value2: reviewCase.content_state.replace('_', ' ') })}
                value={reviewCase.state}
              />
            </React.Fragment>
          ))}
        </ContentSurface>

        <ContentSurface style={[styles.surface, surfaceStyle]}>
          <Row icon="Mail" title={cairnText('settings-screen.contact-support')} detail={cairnText('settings-screen.for-rights-requests-or-a-content-issue')} external onPress={() => void Linking.openURL('mailto:support@cairnapp.nz')} />
        </ContentSurface>
      </ScrollView>
    </>
  );

  return (
    <View style={[styles.root, { backgroundColor: background.settingsBackgroundColor }]}>
      <Image source={background.bgAsset} style={[styles.backgroundImage, backgroundLayout]} resizeMode="cover" />
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: background.settingsVeilColor }]} />
      {page !== 'root' ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, styles.subpageReadabilityVeil, { backgroundColor: theme.background }]} />
      ) : null}
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {page === 'root'
          ? renderRoot()
          : page === 'account'
            ? renderAccount()
            : page === 'privacy'
              ? renderPrivacy()
              : page === 'content-review'
                ? renderContentReview()
                : renderHelp()}
      </SafeAreaView>

      <ModalCard visible={nameOpen} onDismiss={() => !nameSaving && setNameOpen(false)} dismissible={!nameSaving} testID="settings-name-modal">
        <ModalCardHeader title={cairnText('settings-screen.edit-name')} body={cairnText('settings-screen.this-is-how-your-name-appears-in')} onClose={nameSaving ? undefined : () => setNameOpen(false)} />
        <TextField
          label={cairnText('settings-screen.name')}
          value={nameDraft}
          onChangeText={(value) => { setNameDraft(value.slice(0, 32)); setNameError(''); }}
          autoCapitalize="words"
          error={nameError || undefined}
          testID="settings-name-input"
        />
        <View style={styles.modalActions}>
          <PrimaryButton label={cairnText('common.cancel')} variant="secondary" disabled={nameSaving} onPress={() => setNameOpen(false)} style={styles.flexButton} />
          <PrimaryButton
            label={cairnText('common.save')}
            loading={nameSaving}
            disabled={!nameDraft.trim() || !nameOwnerId || currentOwnerId() !== nameOwnerId}
            onPress={() => void (async () => {
              const ownerId = nameOwnerId;
              if (nameFlight.current) return;
              if (!ownerId || currentOwnerId() !== ownerId) {
                setNameError(cairnText('settings-screen.the-signed-in-account-changed-close-this'));
                return;
              }
              nameFlight.current = true;
              const generation = ++nameGeneration.current;
              setNameSaving(true);
              const result = await patchName(nameDraft.trim(), ownerId);
              const currentUser = useAppStore.getState().user;
              if (generation === nameGeneration.current
                && currentOwnerId() === ownerId
                && currentUser
                && result.user
                && String(result.user.id) === ownerId) {
                setUser({ ...currentUser, ...result.user });
                setNameOpen(false);
              } else if (generation === nameGeneration.current && currentOwnerId() === ownerId) {
                setNameError(result.error || cairnText('settings-screen.name-could-not-be-saved'));
              }
              if (generation === nameGeneration.current) {
                nameFlight.current = false;
                setNameSaving(false);
              }
            })()}
            style={styles.flexButton}
            testID="settings-name-save"
          />
        </View>
      </ModalCard>

      <ModalCard visible={passwordOpen} onDismiss={() => !passwordSaving && setPasswordOpen(false)} dismissible={!passwordSaving} testID="settings-password-modal">
        <ModalCardHeader title={cairnText('settings-screen.change-password')} body={cairnText('settings-screen.other-signed-in-devices-will-be-signed')} onClose={passwordSaving ? undefined : () => setPasswordOpen(false)} />
        <View style={styles.stackSmall}>
          <PasswordField label={cairnText('settings-screen.current-password')} value={currentPassword} onChangeText={(value) => { setCurrentPassword(value); setPasswordError(''); }} testID="settings-current-password" />
          <PasswordField label={cairnText('settings-screen.new-password')} value={nextPassword} onChangeText={(value) => { setNextPassword(value); setPasswordError(''); }} testID="settings-new-password" isNew />
          <PasswordField label={cairnText('settings-screen.confirm-new-password')} value={passwordConfirmation} onChangeText={(value) => { setPasswordConfirmation(value); setPasswordError(''); }} error={passwordError || undefined} testID="settings-confirm-password" isNew />
          <View style={styles.passwordRules} testID="settings-password-rules">
            {PASSWORD_RULES.map((rule) => {
              const met = passwordRuleState(nextPassword)[rule.key];
              return (
                <View key={rule.key} style={styles.passwordRuleRow}>
                  <Icon name="Check" size={14} color={met ? theme.primary : theme.textMuted} strokeWidth={met ? 3 : 2} />
                  <Text style={[styles.passwordRuleText, { color: met ? theme.textPrimary : theme.textMuted }]}>{rule.label}</Text>
                </View>
              );
            })}
          </View>
        </View>
        <View style={styles.stackSmall}>
          <PrimaryButton
            label={cairnText('settings-screen.update')}
            loading={passwordSaving}
            disabled={!currentPassword || Boolean(passwordPolicyError(nextPassword)) || passwordConfirmation.length < 8}
            onPress={() => void (async () => {
              if (passwordFlight.current) return;
              const ownerId = passwordOwnerId;
              if (!ownerId || currentOwnerId() !== ownerId) {
                setPasswordError(cairnText('settings-screen.the-signed-in-account-changed-close-this-5bfa4f2'));
                return;
              }
              if (nextPassword !== passwordConfirmation) {
                setPasswordError(cairnText('settings-screen.new-passwords-do-not-match'));
                return;
              }
              const policyError = passwordPolicyError(nextPassword);
              if (policyError) {
                setPasswordError(policyError);
                return;
              }
              passwordFlight.current = true;
              const generation = ++passwordGeneration.current;
              setPasswordSaving(true);
              const result = await changePassword(currentPassword, nextPassword, ownerId);
              const ownerIsCurrent = settingsMounted.current
                && currentOwnerId() === ownerId
                && generation === passwordGeneration.current;
              if (!ownerIsCurrent) return;
              if (result.commitState === 'unknown') {
                setPasswordError(result.error || cairnText('settings-screen.the-result-is-unknown-check-which-password'));
              } else if (result.commitState !== 'committed') {
                setPasswordError(result.error || cairnText('settings-screen.password-could-not-be-updated'));
              }
              if (generation === passwordGeneration.current) {
                passwordFlight.current = false;
                setPasswordSaving(false);
              }
            })()}
            testID="settings-password-save"
          />
        </View>
      </ModalCard>

      <ModalCard visible={deleteOpen} onDismiss={() => !deleteSaving && setDeleteOpen(false)} dismissible={!deleteSaving} testID="settings-delete-modal">
        <ModalCardHeader
          title={cairnText('settings-screen.delete-your-account')}
          body={cairnText('settings-screen.your-account-will-be-disabled-now-you')}
          onClose={deleteSaving ? undefined : () => setDeleteOpen(false)}
        />
        <TextField
          label={cairnText('settings-screen.type-delete-account-to-confirm')}
          value={deletePhrase}
          onChangeText={(value) => { setDeletePhrase(value); setDeleteError(''); }}
          autoCapitalize="none"
          error={deleteError || undefined}
          testID="settings-delete-phrase"
        />
        <View style={styles.stackSmall}>
          <PrimaryButton
            label={cairnText('settings-screen.delete-account')}
            variant="destructive"
            loading={deleteSaving}
            disabled={deletePhrase.trim().toLowerCase() !== 'delete account' || !user?.id}
            onPress={() => void (async () => {
              const ownerId = deleteOwnerId;
              if (!ownerId || currentOwnerId() !== ownerId || deleteFlight.current) return;
              deleteFlight.current = true;
              const generation = ++deleteGeneration.current;
              setDeleteSaving(true);
              setDeleteError('');
              const result = await deleteAccount(ownerId);
              if (!settingsMounted.current
                || generation !== deleteGeneration.current
                || currentOwnerId() !== ownerId) return;
              if (result.commitState !== 'committed') {
                setDeleteError(result.error === 'not_signed_in'
                  ? cairnText('settings-screen.your-session-ended-sign-in-again-before')
                  : (result.error || cairnText('settings-screen.the-deletion-result-could-not-be-confirmed')));
                setDeleteSaving(false);
                deleteFlight.current = false;
                return;
              }
              const deadline = result.restoreDeadline ? formatCairnDate(new Date(result.restoreDeadline), { dateStyle: 'medium', timeStyle: 'short' }) : cairnText('settings.deletion.seven-days-from-now');
              if (generation === deleteGeneration.current) {
                setDeleteOpen(false);
                setDeleteSaving(false);
                deleteFlight.current = false;
              }
              if (result.localCleanup !== 'complete' && result.durableCleanupScheduled === false) {
                Alert.alert(
                  cairnText('settings-screen.account-deletion-accepted'),
                  cairnText('settings-screen.cairn-could-not-confirm-that-all-account'),
                );
              } else if (result.localCleanup !== 'complete') {
                Alert.alert(
                  cairnText('settings-screen.account-scheduled-for-deletion'),
                  cairnText('settings-screen.the-account-that-started-this-request-was', { deadline: deadline }),
                );
              } else {
                Alert.alert(cairnText('settings-screen.account-scheduled-for-deletion'), cairnText('settings-screen.you-can-restore-server-backed-data-by', { deadline: deadline }));
              }
            })()}
            testID="settings-delete-confirm"
          />
        </View>
      </ModalCard>

      <ModalCard visible={signOutOpen} onDismiss={() => setSignOutOpen(false)} testID="settings-signout-modal">
        <ModalCardHeader
          title={cairnText('settings-screen.sign-out-1d3ce19')}
          body={cairnText('settings-screen.your-saved-and-recoverable-cairn-data-stays')}
          onClose={() => setSignOutOpen(false)}
        />
        <View style={styles.stackSmall}>
          <PrimaryButton
            label={cairnText('settings-screen.sign-out')}
            variant="destructive"
            onPress={() => void (async () => {
              const ownerId = currentOwnerId();
              if (!ownerId) return;
              setSignOutOpen(false);
              try {
                const tokenResult = await logout({ expectedUserId: ownerId });
                if (tokenResult.ownerChanged || !tokenResult.cleared) {
                  Alert.alert(cairnText('settings-screen.account-changed'), cairnText('settings-screen.sign-out-did-not-act-on-the'));
                }
              } catch {
                Alert.alert(cairnText('settings-screen.could-not-sign-out'), cairnText('settings-screen.cairn-could-not-safely-stop-the-current'));
              }
            })()}
            testID="settings-signout-confirm"
          />
        </View>
      </ModalCard>

      <ModalCard visible={memoryDeleteOpen} onDismiss={() => !memoryDeleting && setMemoryDeleteOpen(false)} dismissible={!memoryDeleting} testID="settings-delete-exploration-modal">
        <ModalCardHeader
          title={cairnText('settings-screen.delete-exploration-history-dc25a37')}
          body={cairnText('settings-screen.this-permanently-removes-your-memory-points-and')}
        />
        <View style={styles.modalActions}>
          <PrimaryButton label={cairnText('settings-screen.keep-history')} variant="secondary" disabled={memoryDeleting} onPress={() => setMemoryDeleteOpen(false)} style={styles.flexButton} />
          <PrimaryButton
            label={cairnText('settings-screen.delete-history')}
            variant="destructive"
            loading={memoryDeleting}
            style={styles.flexButton}
            onPress={() => void (async () => {
              if (memoryDeleteFlight.current) return;
              const ownerId = currentOwnerId();
              if (!ownerId) return;
              memoryDeleteFlight.current = true;
              const generation = ++memoryDeleteGeneration.current;
              setMemoryDeleting(true);
              try {
                const ok = await deleteAllMemoryFromServer(ownerId);
                if (generation !== memoryDeleteGeneration.current || currentOwnerId() !== ownerId) return;
                setMemoryDeleteOpen(false);
                setMemoryDeleteResult(ok
                  ? 'Deleted. Activities, Routes and Cairns were not changed.'
                  : 'Nothing was removed. Check your connection and try again.');
              } finally {
                if (generation === memoryDeleteGeneration.current) {
                  memoryDeleteFlight.current = false;
                  setMemoryDeleting(false);
                }
              }
            })()}
            testID="settings-delete-exploration-confirm"
          />
        </View>
      </ModalCard>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  pageScroll: { flex: 1 },
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
  subpageScroll: { paddingTop: Spacing.base },
  subpageReadabilityVeil: { opacity: 0.54 },
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
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: FontSize.body, fontWeight: '700', lineHeight: 20 },
  rowDetail: { flexShrink: 1, fontSize: FontSize.caption, lineHeight: 18, marginTop: 2 },
  rowValue: { maxWidth: 92, fontSize: FontSize.caption, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 62 },
  disabled: { opacity: 0.58 },
  preferenceBlock: { padding: Spacing.base, gap: Spacing.md },
  preferenceHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  footer: { textAlign: 'center', fontSize: FontSize.caption, fontWeight: '600', marginTop: Spacing.xxl, opacity: 0.82 },
  footerPressable: { alignSelf: 'center', paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xl },
  passwordRules: { gap: Spacing.xs, paddingHorizontal: Spacing.xs },
  passwordRuleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  passwordRuleText: { fontSize: FontSize.caption, fontWeight: '600' },
  cardHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, padding: Spacing.base, paddingBottom: Spacing.sm },
  dataActionSurface: { marginBottom: Spacing.xs },
  cardBody: { gap: Spacing.md, paddingHorizontal: Spacing.base, paddingBottom: Spacing.base },
  cardError: { fontSize: FontSize.caption, lineHeight: 18, fontWeight: '600' },
  formSurface: { padding: Spacing.base, gap: Spacing.base },
  infoHero: { padding: Spacing.lg, flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  heroIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: FontSize.h3, fontWeight: '700', lineHeight: 23 },
  body: { fontSize: FontSize.caption, lineHeight: 19 },
  statusText: { flex: 1, fontSize: FontSize.caption, lineHeight: 19, fontWeight: '600' },
  statusStrong: { fontSize: FontSize.body, lineHeight: 20, fontWeight: '700' },
  asyncRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.base },
  stackSmall: { gap: Spacing.md, padding: Spacing.base },
  error: { fontSize: FontSize.caption, lineHeight: 18, fontWeight: '600', marginHorizontal: Spacing.base, marginBottom: Spacing.md },
  inlineLoader: { position: 'absolute', right: Spacing.base, top: Spacing.xl },
  deleteResult: { paddingHorizontal: Spacing.base, paddingBottom: Spacing.base, fontSize: FontSize.caption, lineHeight: 18, fontWeight: '600' },
  feedbackInput: { minHeight: 116, paddingTop: Spacing.md },
  counter: { textAlign: 'right', fontSize: FontSize.small },
  deliveryStatus: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderWidth: 1, borderRadius: Radius.button, padding: Spacing.md },
  modalActions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.lg },
  flexButton: { flex: 1 },
});
