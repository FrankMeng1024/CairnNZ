import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { BackButton } from '../components/BackButton';
import { Icon } from '../components/Icon';
import { PrimaryButton } from '../components/PrimaryButton';
import { ModalCard, ModalCardHeader } from '../components/ModalCard';
import { StateSurface } from '../components/StateSurface';
import { Colors, FontSize, Radius, Spacing } from '../components/tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { useMapTheme } from '../hooks/useMapTheme';
import { getMapStyleForTheme, themeToStandardPreset, buildStandardConfig } from '../config/mapbox';
import { MAP_ORNAMENTS_EDGE } from '../config/mapOrnaments';
import { CairnPin } from '../features/memory/components/CairnPinsLayer';
import { MARKER_TYPES } from '../config/markerTypes';
import { cairnDisplayTitle, splitTitleBody } from '../features/plant/services/noteEncoding';
import {
  capturePublicCairnAccountAuthority,
  publicCairnAccountAuthorityIsCurrent,
  usePublicCairnStore,
  type PublicCairnAccountAuthority,
  type PublicCairnDetail,
} from '../features/public/services/publicCairns';
import { cairnText } from '../i18n/runtime';

let MapView: any = null;
let Camera: any = null;
let MarkerView: any = null;
let StyleImport: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mapbox = Platform.OS === 'web'
    ? require('../features/memory/services/mapboxAdapter.web').makeWebMapboxAdapter()
    : require('@rnmapbox/maps');
  if (mapbox?.available !== false) {
    MapView = mapbox.MapView;
    Camera = mapbox.Camera;
    MarkerView = mapbox.MarkerView ?? mapbox.PointAnnotation;
    StyleImport = mapbox.StyleImport;
  }
} catch { /* explicit fallback below */ }

type DetailRoute = RouteProp<RootStackParamList, 'PublicCairnDetail'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;
type ReportCategory = 'spam' | 'unsafe' | 'harassment' | 'other';
interface ScreenActionTicket {
  attempt: number;
  resourceId: string;
  authority: PublicCairnAccountAuthority;
}

interface ScreenDetailBinding {
  resourceId: string;
  authority: PublicCairnAccountAuthority;
  detail: PublicCairnDetail;
}

interface ScreenLoadState {
  attempt: number;
  resourceId: string;
  authority: PublicCairnAccountAuthority;
  loading: boolean;
  error: string | null;
}

function detailLoadCode(caught: unknown): string {
  return String((caught as { code?: unknown } | null)?.code || '');
}

function detailLoadError(caught: unknown): string {
  const code = detailLoadCode(caught);
  return code.includes('expired')
    ? 'This downloaded copy has expired. Connect to check whether it is still available.'
    : code.includes('offline')
      ? 'Connect to download this Cairn.'
      : 'This Public Cairn is no longer available.';
}

export function showPublicActionFeedback(title: string, body: string): void {
  if (Platform.OS === 'web') {
    const browserGlobal = globalThis as typeof globalThis & { alert: (message?: string) => void };
    browserGlobal.alert(`${title}\n\n${body}`);
    return;
  }
  Alert.alert(title, body);
}

export function PublicCairnDetailScreen() {
  const route = useRoute<DetailRoute>();
  const nav = useNavigation<Nav>();
  const theme = useVisualTheme();
  const mapTheme = useMapTheme();
  const id = route.params.cairnId;
  const cached = usePublicCairnStore(state => state.details[id]);
  const publicEnabled = usePublicCairnStore(state => state.enabled);
  const loadDetail = usePublicCairnStore(state => state.loadDetail);
  const thank = usePublicCairnStore(state => state.thanks);
  const hide = usePublicCairnStore(state => state.hide);
  const blockAuthor = usePublicCairnStore(state => state.blockAuthor);
  const report = usePublicCairnStore(state => state.report);
  const publicViewerId = usePublicCairnStore(state => state.viewerId);
  const liveAuthority = publicEnabled
    ? capturePublicCairnAccountAuthority(publicViewerId)
    : null;
  const liveAuthorityGeneration = liveAuthority?.generation ?? null;
  const [boundDetail, setBoundDetail] = useState<ScreenDetailBinding | null>(() => {
    if (!liveAuthority || !cached || cached.id !== id) return null;
    return { resourceId: id, authority: liveAuthority, detail: cached };
  });
  const [loadState, setLoadState] = useState<ScreenLoadState | null>(null);
  const [thanked, setThanked] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportCategory, setReportCategory] = useState<ReportCategory>('other');
  const [reportDetail, setReportDetail] = useState('');
  const [reportFeedback, setReportFeedback] = useState<string | null>(null);
  const [reportCompleted, setReportCompleted] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'hide' | 'block' | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const hadAuthorizedDetail = useRef(Boolean(cached));
  const mounted = useRef(false);
  const routeId = useRef(id);
  const viewerId = useRef(publicViewerId);
  const enabled = useRef(publicEnabled);
  const loadAttempt = useRef(0);
  const actionAttempt = useRef(0);
  routeId.current = id;
  viewerId.current = publicViewerId;
  enabled.current = publicEnabled;
  const style = getMapStyleForTheme('outdoors', mapTheme);
  const lightPreset = themeToStandardPreset(mapTheme);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      loadAttempt.current += 1;
      actionAttempt.current += 1;
    };
  }, []);

  const bindingIsLive = (binding: Pick<ScreenDetailBinding, 'resourceId' | 'authority'>): boolean => (
    enabled.current
    && routeId.current === binding.resourceId
    && viewerId.current === binding.authority.viewerId
    && publicCairnAccountAuthorityIsCurrent(binding.authority)
  );

  const beginScreenAction = (binding: ScreenDetailBinding): ScreenActionTicket | null => {
    if (!bindingIsLive(binding)) return null;
    return {
      attempt: ++actionAttempt.current,
      resourceId: binding.resourceId,
      authority: binding.authority,
    };
  };

  const screenActionIsCurrent = (ticket: ScreenActionTicket): boolean => (
    mounted.current
    && enabled.current
    && actionAttempt.current === ticket.attempt
    && routeId.current === ticket.resourceId
    && viewerId.current === ticket.authority.viewerId
    && publicCairnAccountAuthorityIsCurrent(ticket.authority)
  );

  const loadAuthorizedDetail = useCallback((
    resourceId: string,
    authority: PublicCairnAccountAuthority,
    retained: ScreenDetailBinding | null,
  ) => {
    const attempt = ++loadAttempt.current;
    const ticket = { attempt, resourceId, authority };
    const attemptIsCurrent = () => mounted.current
      && enabled.current
      && loadAttempt.current === ticket.attempt
      && routeId.current === ticket.resourceId
      && viewerId.current === ticket.authority.viewerId
      && publicCairnAccountAuthorityIsCurrent(ticket.authority);
    setLoadState({ ...ticket, loading: true, error: null });
    void loadDetail(resourceId).then(next => {
      if (!attemptIsCurrent()) return;
      if (next.id !== ticket.resourceId) {
        throw Object.assign(new Error('Detail identity changed.'), { code: 'superseded' });
      }
      const nextBinding = { resourceId: ticket.resourceId, authority: ticket.authority, detail: next };
      hadAuthorizedDetail.current = true;
      setBoundDetail(nextBinding);
      setLoadState({ ...ticket, loading: true, error: null });
    }).catch((caught: unknown) => {
      if (!attemptIsCurrent()) return;
      const invalidated = detailLoadCode(caught) === 'superseded';
      if (invalidated || !retained) {
        setBoundDetail(current => (
          current
          && current.resourceId === ticket.resourceId
          && current.authority.viewerId === ticket.authority.viewerId
          && current.authority.generation === ticket.authority.generation
            ? null
            : current
        ));
      }
      setLoadState({
        ...ticket,
        loading: true,
        error: invalidated ? cairnText('public-cairn-detail-screen.this-public-cairn-is-no-longer-available-e1eea8f') : detailLoadError(caught),
      });
    }).finally(() => {
      if (!attemptIsCurrent()) return;
      setLoadState(current => (
        current
        && current.attempt === ticket.attempt
        && current.resourceId === ticket.resourceId
        && current.authority.viewerId === ticket.authority.viewerId
        && current.authority.generation === ticket.authority.generation
          ? { ...current, loading: false }
          : current
      ));
    });
  }, [loadDetail]);

  useEffect(() => {
    loadAttempt.current += 1;
    actionAttempt.current += 1;
    setThanked(false);
    setActionPending(false);
    setReportOpen(false);
    setReportCategory('other');
    setReportDetail('');
    setReportFeedback(null);
    setReportCompleted(false);
    setConfirmAction(null);
    setActionFeedback(null);
    if (!publicEnabled || !publicViewerId) {
      hadAuthorizedDetail.current = false;
      setBoundDetail(null);
      setLoadState(null);
      return undefined;
    }
    const authority = capturePublicCairnAccountAuthority(publicViewerId);
    if (!authority) {
      hadAuthorizedDetail.current = false;
      setBoundDetail(null);
      setLoadState(null);
      return undefined;
    }
    const retained = cached?.id === id ? { resourceId: id, authority, detail: cached } : null;
    hadAuthorizedDetail.current = Boolean(retained);
    setBoundDetail(retained);
    loadAuthorizedDetail(id, authority, retained);
    return () => { loadAttempt.current += 1; };
  }, [id, liveAuthorityGeneration, loadAuthorizedDetail, publicEnabled, publicViewerId]);

  useEffect(() => {
    if (!publicEnabled || !publicViewerId) {
      setBoundDetail(null);
      return;
    }
    const authority = capturePublicCairnAccountAuthority(publicViewerId);
    if (!authority) {
      setBoundDetail(null);
      return;
    }
    if (cached?.id === id) {
      hadAuthorizedDetail.current = true;
      setBoundDetail({ resourceId: id, authority, detail: cached });
      return;
    }
    if (hadAuthorizedDetail.current) {
      setBoundDetail(null);
      setLoadState(current => (
        current
        && current.resourceId === id
        && current.authority.viewerId === authority.viewerId
        && current.authority.generation === authority.generation
          ? { ...current, loading: false, error: cairnText('public-cairn-detail-screen.this-public-cairn-is-no-longer-available-e1eea8f') }
          : current
      ));
    }
  }, [cached, id, liveAuthorityGeneration, publicEnabled, publicViewerId]);

  const visibleBinding = boundDetail
    && publicEnabled
    && boundDetail.resourceId === id
    && boundDetail.detail.id === id
    && boundDetail.authority.viewerId === publicViewerId
    && publicCairnAccountAuthorityIsCurrent(boundDetail.authority)
    ? boundDetail
    : null;
  const currentLoadState = loadState
    && publicEnabled
    && loadState.resourceId === id
    && loadState.authority.viewerId === publicViewerId
    && publicCairnAccountAuthorityIsCurrent(loadState.authority)
    ? loadState
    : null;
  const detail = visibleBinding?.detail ?? null;
  const loading = publicEnabled && Boolean(publicViewerId) && !detail
    && (currentLoadState?.loading ?? true);
  const unavailableError = publicEnabled
    ? currentLoadState?.error ?? cairnText('public-cairn-detail-screen.this-public-cairn-is-no-longer-available-e1eea8f')
    : cairnText('public-cairn-detail-screen.public-cairns-are-not-available-in-this');
  const detailStatus = actionFeedback ?? currentLoadState?.error ?? null;

  const words = useMemo(() => detail ? splitTitleBody(detail.text) : { title: '', body: '' }, [detail]);
  const title = detail ? cairnDisplayTitle(words.title, words.body, detail.createdAt) : cairnText('public-cairn-detail-screen.public-cairn');
  const markerType = detail ? (MARKER_TYPES as any)[detail.type] ?? MARKER_TYPES.cairn : MARKER_TYPES.cairn;

  const retryDetail = () => {
    const authority = capturePublicCairnAccountAuthority(publicViewerId);
    if (!publicEnabled || !authority || routeId.current !== id || viewerId.current !== authority.viewerId) return;
    loadAuthorizedDetail(id, authority, null);
  };

  const commitConfirmedAction = async () => {
    if (!confirmAction || !visibleBinding) return;
    const ticket = beginScreenAction(visibleBinding);
    if (!ticket) return;
    const selected = confirmAction;
    setConfirmAction(null);
    setActionPending(true);
    try {
      const result = await (selected === 'hide' ? hide(ticket.resourceId) : blockAuthor(ticket.resourceId));
      if (!screenActionIsCurrent(ticket) || result.status === 'superseded') return;
      if (result.status === 'queued_offline') {
        showPublicActionFeedback(
          selected === 'hide' ? cairnText('public-cairn-detail-screen.hidden-here') : cairnText('public-cairn-detail-screen.blocked-here'),
          cairnText('public-cairn-detail-screen.this-change-is-saved-on-this-device'),
        );
      } else if (result.status === 'queued_retry') {
        showPublicActionFeedback(
          selected === 'hide' ? cairnText('public-cairn-detail-screen.hidden-here') : cairnText('public-cairn-detail-screen.blocked-here'),
          cairnText('public-cairn-detail-screen.this-change-is-saved-on-this-device-7b87de2'),
        );
      } else if (result.status === 'auth_required') {
        showPublicActionFeedback(
          selected === 'hide' ? cairnText('public-cairn-detail-screen.hidden-here') : cairnText('public-cairn-detail-screen.blocked-here'),
          cairnText('public-cairn-detail-screen.this-change-is-saved-on-this-device-df95334'),
        );
      } else if (result.status === 'rejected') {
        setActionFeedback(cairnText('public-cairn-detail-screen.the-service-rejected-this-change-it-remains'));
      } else if (result.status === 'unavailable') {
        Alert.alert(cairnText('public-cairn-detail-screen.no-longer-available'), cairnText('public-cairn-detail-screen.this-public-cairn-is-no-longer-available'));
      }
      nav.goBack();
    } catch {
      if (!screenActionIsCurrent(ticket)) return;
      setActionFeedback(cairnText('public-cairn-detail-screen.could-not-save-that-change-on-this'));
    } finally {
      if (screenActionIsCurrent(ticket)) setActionPending(false);
    }
  };

  const sendThanks = async () => {
    if (thanked || actionPending || !visibleBinding) return;
    const ticket = beginScreenAction(visibleBinding);
    if (!ticket) return;
    setActionPending(true);
    try {
      const result = await thank(ticket.resourceId);
      if (!screenActionIsCurrent(ticket) || result.status === 'superseded') return;
      if (result.status === 'confirmed') setThanked(true);
      else if (result.status === 'queued_offline') {
        showPublicActionFeedback(cairnText('public-cairn-detail-screen.thanks-saved'), cairnText('public-cairn-detail-screen.your-thanks-will-retry-when-you-are'));
      } else if (result.status === 'queued_retry') {
        showPublicActionFeedback(cairnText('public-cairn-detail-screen.thanks-saved'), cairnText('public-cairn-detail-screen.the-service-did-not-accept-it-yet'));
      } else if (result.status === 'auth_required') {
        showPublicActionFeedback(cairnText('public-cairn-detail-screen.thanks-saved'), cairnText('public-cairn-detail-screen.sign-in-again-to-send-your-thanks'));
      } else if (result.status === 'rejected') {
        setActionFeedback(cairnText('public-cairn-detail-screen.the-service-rejected-this-thanks'));
      } else {
        setActionFeedback(cairnText('public-cairn-detail-screen.this-public-cairn-is-no-longer-available-e1eea8f'));
      }
    } catch {
      if (screenActionIsCurrent(ticket)) setActionFeedback(cairnText('public-cairn-detail-screen.could-not-save-your-thanks-please-try'));
    } finally {
      if (screenActionIsCurrent(ticket)) setActionPending(false);
    }
  };

  const submitReport = async () => {
    if (!visibleBinding) return;
    const ticket = beginScreenAction(visibleBinding);
    if (!ticket) return;
    setActionPending(true);
    setReportFeedback(null);
    try {
      const result = await report(ticket.resourceId, reportCategory, reportDetail);
      if (!screenActionIsCurrent(ticket) || result.status === 'superseded') return;
      if (result.status === 'confirmed') {
        setReportCompleted(true);
        setReportFeedback(cairnText('public-cairn-detail-screen.report-received'));
      } else if (result.status === 'queued_offline') {
        setReportCompleted(true);
        setReportFeedback(cairnText('public-cairn-detail-screen.saved-to-retry-when-you-are-connected'));
      } else if (result.status === 'queued_retry') {
        setReportCompleted(true);
        setReportFeedback(cairnText('public-cairn-detail-screen.saved-the-service-did-not-accept-it'));
      } else if (result.status === 'auth_required') {
        setReportCompleted(true);
        setReportFeedback(cairnText('public-cairn-detail-screen.saved-on-this-device-sign-in-again'));
      } else if (result.status === 'rejected') {
        setReportCompleted(false);
        setReportFeedback(cairnText('public-cairn-detail-screen.the-service-rejected-this-report-check-the'));
      } else {
        setReportCompleted(false);
        setReportFeedback(cairnText('public-cairn-detail-screen.this-public-cairn-is-no-longer-available-e1eea8f'));
      }
    } catch {
      if (!screenActionIsCurrent(ticket)) return;
      setReportCompleted(false);
      setReportFeedback(cairnText('public-cairn-detail-screen.could-not-save-this-report-on-your'));
    } finally {
      if (screenActionIsCurrent(ticket)) setActionPending(false);
    }
  };

  if (!detail && loading) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
        <View style={styles.plainHeader}><BackButton variant="inline" /></View>
        <StateSurface
          variant="loading"
          title={cairnText('public-cairn-detail-screen.loading-public-cairn')}
          material="embedded"
          alignment="center"
          style={styles.empty}
        />
      </SafeAreaView>
    );
  }

  if (!detail) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
        <View style={styles.plainHeader}><BackButton variant="inline" /></View>
        <View style={styles.empty}>
          <Icon name="CloudOff" size={26} color={theme.iconInactive} />
          <Text style={[styles.emptyTitle, { color: theme.foreground }]}>{cairnText('public-cairn-detail-screen.public-cairn-unavailable')}</Text>
          <Text style={[styles.emptyBody, { color: theme.foregroundSecondary }]}>{unavailableError}</Text>
          {publicEnabled ? <PrimaryButton label={cairnText('public-cairn-detail-screen.try-again')} onPress={retryDetail} /> : null}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top', 'bottom']} testID="public-cairn-detail">
      <View style={styles.mapWrap}>
        {detail && MapView ? (
          <MapView
            style={StyleSheet.absoluteFill}
            {...(style.kind === 'url' ? { styleURL: style.url } : { styleJSON: style.json })}
            compassEnabled={false}
            logoEnabled
            attributionEnabled
            logoPosition={MAP_ORNAMENTS_EDGE.logoPosition}
            attributionPosition={MAP_ORNAMENTS_EDGE.attributionPosition}
          >
            {StyleImport ? <StyleImport id="basemap" existing config={buildStandardConfig(mapTheme) as any} /> : null}
            <Camera defaultSettings={{ centerCoordinate: [detail.lng, detail.lat], zoomLevel: 15, pitch: 0 }} />
            {MarkerView ? (
              <MarkerView id={`public-${detail.id}`} coordinate={[detail.lng, detail.lat]} anchor={{ x: 0.5, y: 0.5 }}>
                <CairnPin tier="public" type={detail.type as any} size="detail" />
              </MarkerView>
            ) : null}
          </MapView>
        ) : (
          <View style={[styles.mapFallback, { backgroundColor: theme.surface }]}>
            <Icon name="Map" size={24} color={theme.iconInactive} />
            <Text style={[styles.mapFallbackTitle, { color: theme.foreground }]}>{cairnText('public-cairn-detail-screen.map-unavailable')}</Text>
            <Text style={[styles.mapFallbackBody, { color: theme.foregroundSecondary }]}>{cairnText('public-cairn-detail-screen.the-cairn-text-remains-available')}</Text>
          </View>
        )}
        <View style={styles.back}><BackButton variant="inline" /></View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <Text style={[styles.eyebrow, { color: theme.foregroundSecondary }]}>{cairnText('public-cairn-detail-screen.public-cairn-read-only')}</Text>
        <Text style={[styles.title, { color: theme.foreground }]}>{title}</Text>
        {words.body ? <Text style={[styles.body, { color: theme.foregroundSecondary }]}>{words.body}</Text> : null}
        {!words.title && !words.body ? <Text style={[styles.body, { color: theme.foregroundSecondary }]}>{detail?.displayText || cairnText('public-cairn-detail-screen.a-moment-here')}</Text> : null}
        <View style={styles.metaRow}>
          <View style={[styles.badge, { borderColor: markerType.color, backgroundColor: markerType.bg }]}>
            <Text style={[styles.badgeText, { color: markerType.color }]}>{markerType.label}</Text>
          </View>
          <Text style={[styles.author, { color: theme.foregroundSecondary }]}>{cairnText('public-cairn-detail-screen.left-anonymously')}</Text>
        </View>
        {detailStatus ? <Text style={[styles.status, { color: theme.foregroundSecondary }]}>{detailStatus}</Text> : null}
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <View style={styles.actions}>
          <PrimaryButton
            label={thanked ? cairnText('public-cairn-detail-screen.thanks-sent') : cairnText('public-cairn-detail-screen.thanks')}
            onPress={() => void sendThanks()}
            disabled={thanked || actionPending}
            style={styles.action}
            testID="public-thanks"
          />
          <PrimaryButton label={cairnText('public-cairn-detail-screen.hide')} variant="secondary" onPress={() => setConfirmAction('hide')} disabled={actionPending} style={styles.action} testID="public-hide" />
        </View>
        <View style={styles.secondaryActions}>
          <TouchableOpacity style={styles.safetyAction} onPress={() => setConfirmAction('block')} disabled={actionPending} accessibilityRole="button" accessibilityLabel={cairnText('public-cairn-detail-screen.block-author')}>
            <Text style={[styles.link, { color: theme.destructive }]}>{cairnText('public-cairn-detail-screen.block-author')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.safetyAction} onPress={() => setReportOpen(true)} disabled={actionPending} accessibilityRole="button" accessibilityLabel={cairnText('public-cairn-detail-screen.report-cairn')}>
            <Text style={[styles.link, { color: theme.foregroundSecondary }]}>{cairnText('public-cairn-detail-screen.report')}</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.safety, { color: theme.muted }]}>{cairnText('public-cairn-detail-screen.reports-are-reviewed-this-is-not-an')}</Text>
      </ScrollView>

      <ModalCard visible={reportOpen} onDismiss={() => !actionPending && setReportOpen(false)} testID="public-report-sheet">
        <ModalCardHeader title={cairnText('public-cairn-detail-screen.report-this-cairn')} body={cairnText('public-cairn-detail-screen.choose-the-closest-reason-your-precise-visit')} onClose={() => setReportOpen(false)} />
        <View style={styles.reportBody}>
          <View style={styles.reportChoices}>
            {(['spam', 'unsafe', 'harassment', 'other'] as ReportCategory[]).map(category => (
              <TouchableOpacity
                key={category}
                style={[styles.reportChoice, { borderColor: reportCategory === category ? theme.primary : theme.border, backgroundColor: theme.surface }]}
                onPress={() => setReportCategory(category)}
                accessibilityRole="button"
                accessibilityState={{ selected: reportCategory === category }}
              >
                <Text style={{ color: reportCategory === category ? theme.primary : theme.foregroundSecondary }}>{category}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            value={reportDetail}
            onChangeText={setReportDetail}
            placeholder={cairnText('public-cairn-detail-screen.optional-context')}
            placeholderTextColor={theme.muted}
            maxLength={500}
            multiline
            style={[styles.reportInput, { color: theme.foreground, borderColor: theme.border, backgroundColor: theme.inputSurface }]}
            accessibilityLabel={cairnText('public-cairn-detail-screen.report-context')}
          />
          {reportFeedback ? <Text style={[styles.status, { color: theme.foregroundSecondary }]}>{reportFeedback}</Text> : null}
          <PrimaryButton label={actionPending ? cairnText('public-cairn-detail-screen.sending') : reportCompleted ? cairnText('public-cairn-detail-screen.report-saved') : cairnText('public-cairn-detail-screen.submit-report')} onPress={() => void submitReport()} disabled={actionPending || reportCompleted} testID="public-report-submit" />
        </View>
      </ModalCard>

      <ModalCard visible={confirmAction !== null} onDismiss={() => !actionPending && setConfirmAction(null)} testID="public-confirm-action">
        <ModalCardHeader
          title={confirmAction === 'block' ? cairnText('public-cairn-detail-screen.block-this-author') : cairnText('public-cairn-detail-screen.hide-this-cairn')}
          body={confirmAction === 'block'
            ? cairnText('public-cairn-detail-screen.their-public-cairns-and-any-friend-access')
            : cairnText('public-cairn-detail-screen.it-will-disappear-for-you-immediately-this')}
          onClose={() => setConfirmAction(null)}
        />
        <View style={styles.confirmBody}>
          <PrimaryButton label={cairnText('common.cancel')} variant="secondary" onPress={() => setConfirmAction(null)} disabled={actionPending} />
          <PrimaryButton
            label={confirmAction === 'block' ? cairnText('public-cairn-detail-screen.block-author') : cairnText('public-cairn-detail-screen.hide-cairn')}
            onPress={() => void commitConfirmedAction()}
            disabled={actionPending}
            testID="public-confirm-submit"
          />
        </View>
      </ModalCard>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  plainHeader: { padding: Spacing.md },
  mapWrap: { height: 260, overflow: 'hidden' },
  mapFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  mapFallbackTitle: { fontSize: FontSize.body, fontWeight: '700' },
  mapFallbackBody: { fontSize: FontSize.caption },
  back: { position: 'absolute', top: Spacing.md, left: Spacing.md },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { fontSize: 25, lineHeight: 31, fontWeight: '700', marginTop: 8 },
  body: { fontSize: FontSize.body, lineHeight: 23, marginTop: 10 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, flexWrap: 'wrap' },
  badge: { borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { fontSize: FontSize.small, fontWeight: '700' },
  author: { fontSize: FontSize.caption },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.lg },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  action: { flex: 1 },
  secondaryActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.lg, paddingHorizontal: Spacing.sm },
  safetyAction: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  link: { fontSize: FontSize.caption, fontWeight: '700', paddingHorizontal: 8 },
  safety: { textAlign: 'center', fontSize: FontSize.small, marginTop: Spacing.md },
  status: { fontSize: FontSize.caption, marginTop: Spacing.sm },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 36, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700' },
  emptyBody: { fontSize: FontSize.body, textAlign: 'center', lineHeight: 22 },
  reportBody: { padding: Spacing.lg, gap: Spacing.md },
  reportChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reportChoice: { borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  reportInput: { minHeight: 88, borderWidth: 1, borderRadius: Radius.button, padding: Spacing.md, textAlignVertical: 'top' },
  confirmBody: { padding: Spacing.lg, gap: Spacing.sm },
});
