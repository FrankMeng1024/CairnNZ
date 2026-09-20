import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { Colors, FontSize, Radius, Spacing } from '../components/tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { useMapTheme } from '../hooks/useMapTheme';
import { getMapStyleForTheme, themeToStandardPreset, buildStandardConfig } from '../config/mapbox';
import { CairnPin } from '../features/memory/components/CairnPinsLayer';
import { MARKER_TYPES } from '../config/markerTypes';
import { cairnDisplayTitle, splitTitleBody } from '../features/plant/services/noteEncoding';
import {
  usePublicCairnStore,
  type PublicCairnDetail,
} from '../features/public/services/publicCairns';

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

export function PublicCairnDetailScreen() {
  const route = useRoute<DetailRoute>();
  const nav = useNavigation<Nav>();
  const theme = useVisualTheme();
  const mapTheme = useMapTheme();
  const id = route.params.cairnId;
  const cached = usePublicCairnStore(state => state.details[id]);
  const loadDetail = usePublicCairnStore(state => state.loadDetail);
  const thank = usePublicCairnStore(state => state.thanks);
  const hide = usePublicCairnStore(state => state.hide);
  const blockAuthor = usePublicCairnStore(state => state.blockAuthor);
  const report = usePublicCairnStore(state => state.report);
  const [detail, setDetail] = useState<PublicCairnDetail | null>(cached ?? null);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [thanked, setThanked] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportCategory, setReportCategory] = useState<ReportCategory>('other');
  const [reportDetail, setReportDetail] = useState('');
  const [reportFeedback, setReportFeedback] = useState<string | null>(null);
  const [reportCompleted, setReportCompleted] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'hide' | 'block' | null>(null);
  const hadAuthorizedDetail = useRef(Boolean(cached));
  const style = getMapStyleForTheme('outdoors', mapTheme);
  const lightPreset = themeToStandardPreset(mapTheme);

  useEffect(() => {
    let active = true;
    hadAuthorizedDetail.current = Boolean(cached);
    setDetail(cached ?? null);
    setLoading(!cached);
    void loadDetail(id).then(next => {
      if (!active) return;
      setDetail(next);
      setError(null);
    }).catch((caught: any) => {
      if (!active) return;
      const code = String(caught?.code || '');
      setError(code.includes('expired')
        ? 'This downloaded copy has expired. Connect to check whether it is still available.'
        : code.includes('offline')
          ? 'Connect to download this Cairn.'
          : 'This Public Cairn is no longer available.');
      if (!cached) setDetail(null);
    }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [id, loadDetail]);

  useEffect(() => {
    if (cached) {
      hadAuthorizedDetail.current = true;
      setDetail(cached);
      return;
    }
    if (hadAuthorizedDetail.current) {
      setDetail(null);
      setError('This Public Cairn is no longer available.');
    }
  }, [cached]);

  const words = useMemo(() => detail ? splitTitleBody(detail.text) : { title: '', body: '' }, [detail]);
  const title = detail ? cairnDisplayTitle(words.title, words.body, detail.createdAt) : 'Public Cairn';
  const markerType = detail ? (MARKER_TYPES as any)[detail.type] ?? MARKER_TYPES.cairn : MARKER_TYPES.cairn;

  const commitConfirmedAction = async () => {
    if (!confirmAction || !detail) return;
    const selected = confirmAction;
    setConfirmAction(null);
    setActionPending(true);
    try {
      const confirmed = await (selected === 'hide' ? hide(id) : blockAuthor(detail.author.id));
      if (!confirmed) {
        Alert.alert(
          selected === 'hide' ? 'Hidden here' : 'Blocked here',
          'This change is saved on this device and will retry when you are connected.',
        );
      }
      nav.goBack();
    } catch {
      setError('Could not save that change on this device. Nothing was sent; please try again.');
    } finally {
      setActionPending(false);
    }
  };

  const submitReport = async () => {
    setActionPending(true);
    setReportFeedback(null);
    try {
      const confirmed = await report(id, reportCategory, reportDetail);
      setReportCompleted(true);
      setReportFeedback(confirmed ? 'Report received.' : 'Saved to retry when you are connected.');
    } catch {
      setReportCompleted(false);
      setReportFeedback('Could not save this report on your device. Your draft is still here; please try again.');
    } finally {
      setActionPending(false);
    }
  };

  if (!detail && !loading) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
        <View style={styles.plainHeader}><BackButton variant="inline" /></View>
        <View style={styles.empty}>
          <Icon name="CloudOff" size={26} color={theme.iconInactive} />
          <Text style={[styles.emptyTitle, { color: theme.foreground }]}>Public Cairn unavailable</Text>
          <Text style={[styles.emptyBody, { color: theme.foregroundSecondary }]}>{error}</Text>
          <PrimaryButton label="Try again" onPress={() => {
            setLoading(true);
            void loadDetail(id).then(setDetail).catch(() => {}).finally(() => setLoading(false));
          }} />
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
            <Text style={[styles.mapFallbackTitle, { color: theme.foreground }]}>Map unavailable</Text>
            <Text style={[styles.mapFallbackBody, { color: theme.foregroundSecondary }]}>The Cairn text remains available.</Text>
          </View>
        )}
        <View style={styles.back}><BackButton variant="pill" /></View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <Text style={[styles.eyebrow, { color: theme.foregroundSecondary }]}>PUBLIC CAIRN · READ ONLY</Text>
        <Text style={[styles.title, { color: theme.foreground }]}>{title}</Text>
        {words.body ? <Text style={[styles.body, { color: theme.foregroundSecondary }]}>{words.body}</Text> : null}
        {!words.title && !words.body ? <Text style={[styles.body, { color: theme.foregroundSecondary }]}>{detail?.displayText || 'A moment here'}</Text> : null}
        <View style={styles.metaRow}>
          <View style={[styles.badge, { borderColor: markerType.color, backgroundColor: markerType.bg }]}> 
            <Text style={[styles.badgeText, { color: markerType.color }]}>{markerType.label}</Text>
          </View>
          <Text style={[styles.author, { color: theme.foregroundSecondary }]}>Left by {detail?.author.name}</Text>
        </View>
        {error ? <Text style={[styles.status, { color: theme.foregroundSecondary }]}>{error}</Text> : null}
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <View style={styles.actions}>
          <PrimaryButton
            label={thanked ? 'Thanks sent' : 'Thanks'}
            onPress={() => {
              if (thanked) return;
              setActionPending(true);
              void thank(id).then(ok => setThanked(ok)).finally(() => setActionPending(false));
            }}
            disabled={thanked || actionPending}
            style={styles.action}
            testID="public-thanks"
          />
          <PrimaryButton label="Hide" variant="secondary" onPress={() => setConfirmAction('hide')} disabled={actionPending} style={styles.action} testID="public-hide" />
        </View>
        <View style={styles.secondaryActions}>
          <TouchableOpacity onPress={() => setConfirmAction('block')} disabled={actionPending} accessibilityRole="button" accessibilityLabel="Block author">
            <Text style={[styles.link, { color: theme.destructive }]}>Block author</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setReportOpen(true)} disabled={actionPending} accessibilityRole="button" accessibilityLabel="Report Cairn">
            <Text style={[styles.link, { color: theme.foregroundSecondary }]}>Report</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.safety, { color: theme.muted }]}>Reports are reviewed; this is not an emergency service.</Text>
      </ScrollView>

      <ModalCard visible={reportOpen} onDismiss={() => !actionPending && setReportOpen(false)} testID="public-report-sheet">
        <ModalCardHeader title="Report this Cairn" body="Choose the closest reason. Your precise visit location is not sent to the author." onClose={() => setReportOpen(false)} />
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
            placeholder="Optional context"
            placeholderTextColor={theme.muted}
            maxLength={500}
            multiline
            style={[styles.reportInput, { color: theme.foreground, borderColor: theme.border, backgroundColor: theme.inputSurface }]}
            accessibilityLabel="Report context"
          />
          {reportFeedback ? <Text style={[styles.status, { color: theme.foregroundSecondary }]}>{reportFeedback}</Text> : null}
          <PrimaryButton label={actionPending ? 'Sending…' : reportCompleted ? 'Report saved' : 'Submit report'} onPress={() => void submitReport()} disabled={actionPending || reportCompleted} testID="public-report-submit" />
        </View>
      </ModalCard>

      <ModalCard visible={confirmAction !== null} onDismiss={() => !actionPending && setConfirmAction(null)} testID="public-confirm-action">
        <ModalCardHeader
          title={confirmAction === 'block' ? `Block ${detail?.author.name ?? 'this author'}?` : 'Hide this Cairn?'}
          body={confirmAction === 'block'
            ? 'Their Public Cairns and any friend access will no longer be available. Your own data is unchanged.'
            : 'It will disappear for you immediately. This does not punish the author.'}
          onClose={() => setConfirmAction(null)}
        />
        <View style={styles.confirmBody}>
          <PrimaryButton label="Cancel" variant="secondary" onPress={() => setConfirmAction(null)} disabled={actionPending} />
          <PrimaryButton
            label={confirmAction === 'block' ? 'Block author' : 'Hide Cairn'}
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
  link: { fontSize: FontSize.caption, fontWeight: '700', padding: 8 },
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
