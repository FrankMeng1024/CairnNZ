import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Svg, { Polyline } from 'react-native-svg';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { BackButton } from '../components/BackButton';
import { ContentSurface } from '../components/ContentSurface';
import { Icon } from '../components/Icon';
import { ModalCard, ModalCardHeader } from '../components/ModalCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { StateSurface } from '../components/StateSurface';
import { FontSize, Radius, Spacing } from '../components/tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { cairnDisplayTitle, splitTitleBody } from '../features/plant/services/noteEncoding';
import {
  fetchFriendCairn, fetchFriendContent, fetchFriendRoute, hideFriendContent, prepareFriendRouteUse,
  type FriendCairn, type FriendRoute,
} from '../features/friends/services/friendContent';
import { cairnText, formatCairnDate } from '../i18n/runtime';

type ScreenRoute = RouteProp<RootStackParamList, 'FriendContent'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

function RoutePreview({ points }: { points: Array<{ lat: number; lng: number }> }) {
  const theme = useVisualTheme();
  const path = useMemo(() => {
    if (points.length < 2) return '';
    const lats = points.map(point => point.lat);
    const lngs = points.map(point => point.lng);
    const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs);
    const latSpan = Math.max(maxLat - minLat, 0.000001);
    const lngSpan = Math.max(maxLng - minLng, 0.000001);
    return points.map(point => `${12 + ((point.lng - minLng) / lngSpan) * 276},${128 - ((point.lat - minLat) / latSpan) * 116}`).join(' ');
  }, [points]);
  return (
    <View style={[styles.preview, { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle }]}>
      {path ? <Svg width="100%" height={140} viewBox="0 0 300 140"><Polyline points={path} fill="none" stroke={theme.primary} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" /></Svg> : <Text style={{ color: theme.muted }}>{cairnText('friend-content-screen.route-geometry-unavailable')}</Text>}
    </View>
  );
}

export function FriendContentScreen() {
  const theme = useVisualTheme();
  const nav = useNavigation<Nav>();
  const route = useRoute<ScreenRoute>();
  const { friendId, friendName } = route.params;
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [cairns, setCairns] = useState<FriendCairn[]>([]);
  const [routes, setRoutes] = useState<FriendRoute[]>([]);
  const [selectedCairn, setSelectedCairn] = useState<FriendCairn | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<FriendRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [leaseLoading, setLeaseLoading] = useState<'hike' | 'run' | null>(null);
  const [actionError, setActionError] = useState('');
  const [offlineContext, setOfflineContext] = useState<{ checkedAt: number; expiresAt: number } | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const content = await fetchFriendContent(friendId);
      setCairns(content.cairns); setRoutes(content.routes);
      setOfflineContext(content.source === 'offline-cache'
        ? { checkedAt: content.lastCheckedAt, expiresAt: content.expiresAt }
        : null);
      setState('ready');
    } catch { setState('unavailable'); }
  }, [friendId]);
  useEffect(() => { void load(); }, [load]);

  const openRoute = async (summary: FriendRoute) => {
    setSelectedRoute(summary); setRouteLoading(true); setActionError('');
    try {
      const detail = await fetchFriendRoute(summary.id, friendId);
      setSelectedRoute(detail.content);
      if (detail.source === 'offline-cache') {
        setActionError(cairnText('friend-content-screen.offline-copy-authorization-last-checked-value', { value1: formatCairnDate(detail.expiresAt - 24 * 60 * 60 * 1000, { dateStyle: 'medium', timeStyle: 'short' }) }));
      }
    } catch (error: any) {
      setActionError(error?.code === 'revoked'
        ? cairnText('friend-content-screen.this-route-is-no-longer-shared-with')
        : cairnText('friend-content-screen.this-route-is-unavailable-offline-connect-and'));
    }
    finally { setRouteLoading(false); }
  };

  const openCairn = async (summary: FriendCairn) => {
    setActionError('');
    try {
      const detail = await fetchFriendCairn(summary.id, friendId);
      setSelectedCairn(detail.content);
      if (detail.source === 'offline-cache') {
        setActionError(cairnText('friend-content-screen.offline-copy-access-expires-value', { value1: formatCairnDate(detail.expiresAt, { dateStyle: 'medium', timeStyle: 'short' }) }));
      }
    } catch (error: any) {
      setActionError(error?.code === 'revoked'
        ? cairnText('friend-content-screen.this-cairn-is-no-longer-shared-with')
        : cairnText('friend-content-screen.this-cairn-is-unavailable-offline-connect-and'));
    }
  };

  const useSharedRoute = async (mode: 'hike' | 'run') => {
    if (!selectedRoute) return;
    setLeaseLoading(mode); setActionError('');
    try {
      const prepared = await prepareFriendRouteUse(selectedRoute);
      // Modal portals remain mounted underneath the pushed pre-start screen
      // on Web/native-stack. Retire the Detail before navigation so it cannot
      // intercept Back/Start gestures on the ordinary Activity page.
      setSelectedRoute(null);
      nav.navigate(mode === 'hike' ? 'Hiking' : 'Running', {
        sharedRouteLease: prepared.launch,
      });
    } catch (error: any) {
      setActionError(error?.code === 'revoked'
        ? cairnText('friend-content-screen.this-route-is-no-longer-shared-with')
        : error?.code === 'expired'
          ? cairnText('friend-content-screen.no-valid-offline-permission-remains-for-this')
          : cairnText('friend-content-screen.this-shared-route-cannot-be-started-now'));
    }
    finally { setLeaseLoading(null); }
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <View style={styles.header}><BackButton onPress={() => nav.goBack()} /><View><Text style={[styles.title, { color: theme.foreground }]}>{friendName}</Text><Text style={[styles.subtitle, { color: theme.foregroundSecondary }]}>{cairnText('friend-content-screen.shared-with-you-read-only')}</Text></View></View>
      {state === 'loading' ? <StateSurface variant="loading" title={cairnText('friend-content-screen.loading-shared-content')} material="embedded" alignment="center" style={styles.state} /> : null}
      {state === 'unavailable' ? <StateSurface variant="unavailable" title={cairnText('friend-content-screen.shared-content-unavailable')} body={cairnText('friend-content-screen.connect-and-try-again-previously-opened-content')} actions={<PrimaryButton label={cairnText('friend-content-screen.try-again')} onPress={() => void load()} />} material="embedded" alignment="center" style={styles.state} /> : null}
      {state === 'ready' ? <ScrollView contentContainerStyle={styles.content}>
        {offlineContext ? <ContentSurface style={styles.offlineNotice}><Icon name="CloudOff" size={17} color={theme.foregroundSecondary} /><View style={styles.rowText}><Text style={[styles.rowTitle, { color: theme.foreground }]}>{cairnText('friend-content-screen.available-offline')}</Text><Text style={[styles.meta, { color: theme.foregroundSecondary }]}>{cairnText('friend-content-screen.last-checked-value-expires-value', { value1: formatCairnDate(offlineContext.checkedAt, { dateStyle: 'medium', timeStyle: 'short' }), value2: formatCairnDate(offlineContext.expiresAt, { dateStyle: 'medium', timeStyle: 'short' }) })}</Text></View></ContentSurface> : null}
        {actionError && !selectedCairn && !selectedRoute ? <Text style={[styles.error, { color: theme.destructive }]}>{actionError}</Text> : null}
        <Text style={[styles.section, { color: theme.foregroundSecondary }]}>{cairnText('friend-content-screen.encountered-cairns')}</Text>
        {cairns.length === 0 ? <Text style={[styles.empty, { color: theme.muted }]}>{cairnText('friend-content-screen.no-cairns-have-been-encountered-from-this')}</Text> : cairns.map(cairn => {
          const words = splitTitleBody(cairn.text);
          return <TouchableOpacity key={cairn.id} onPress={() => void openCairn(cairn)}><ContentSurface style={styles.row}><Icon name="MapPin" size={18} color={theme.primary} /><View style={styles.rowText}><Text style={[styles.rowTitle, { color: theme.foreground }]}>{cairnDisplayTitle(words.title, words.body, cairn.createdAt)}</Text><Text style={[styles.meta, { color: theme.foregroundSecondary }]}>{cairnText('friend-content-screen.encountered-value', { value1: formatCairnDate(cairn.encounteredAt) })}</Text></View><Icon name="ChevronRight" size={16} color={theme.iconInactive} /></ContentSurface></TouchableOpacity>;
        })}
        <Text style={[styles.section, { color: theme.foregroundSecondary }]}>{cairnText('friend-content-screen.shared-routes')}</Text>
        {routes.length === 0 ? <Text style={[styles.empty, { color: theme.muted }]}>{cairnText('friend-content-screen.no-routes-are-currently-shared-with-you')}</Text> : routes.map(item => <TouchableOpacity key={item.id} onPress={() => void openRoute(item)}><ContentSurface style={styles.row}><Icon name="Route" size={18} color={theme.primary} /><View style={styles.rowText}><Text style={[styles.rowTitle, { color: theme.foreground }]}>{item.name}</Text><Text style={[styles.meta, { color: theme.foregroundSecondary }]}>{cairnText('friend-content-screen.value-km-value-m-ca6bc5b', { value1: (item.distanceM / 1000).toFixed(1), value2: Math.round(item.elevationGainM) })}</Text></View><Icon name="ChevronRight" size={16} color={theme.iconInactive} /></ContentSurface></TouchableOpacity>)}
      </ScrollView> : null}

      {selectedCairn ? <ModalCard visible onDismiss={() => setSelectedCairn(null)} testID="friend-cairn-detail"><ModalCardHeader title={cairnDisplayTitle(splitTitleBody(selectedCairn.text).title, '', selectedCairn.createdAt)} body={cairnText('friend-content-screen.by-value-read-only', { name: selectedCairn.author.name })} onClose={() => setSelectedCairn(null)} /><Text style={[styles.detailBody, { color: theme.foreground }]}>{splitTitleBody(selectedCairn.text).body || cairnText('friend-content-screen.no-note-was-added')}</Text><Text style={[styles.meta, { color: theme.foregroundSecondary }]}>{cairnText('friend-content-screen.encountered-value-8092020', { value1: formatCairnDate(selectedCairn.encounteredAt, { dateStyle: 'medium', timeStyle: 'short' }) })}</Text>{actionError ? <Text style={[styles.error, { color: theme.destructive }]}>{actionError}</Text> : null}<PrimaryButton label={cairnText('friend-content-screen.hide-from-my-view')} variant="secondary" onPress={async () => { try { const result = await hideFriendContent('cairns', selectedCairn.id, friendId); setCairns(value => value.filter(item => item.id !== selectedCairn.id)); setSelectedCairn(null); if (!result.remoteConfirmed) setActionError(cairnText('friend-content-screen.hidden-on-this-device-we-will-retry')); } catch { setActionError(cairnText('friend-content-screen.could-not-save-this-choice-on-this')); } }} /></ModalCard> : null}
      {selectedRoute ? <ModalCard visible onDismiss={() => setSelectedRoute(null)} testID="friend-route-detail"><ModalCardHeader title={selectedRoute.name} body={cairnText('friend-content-screen.by-value-read-only-reference', { name: selectedRoute.author.name })} onClose={() => setSelectedRoute(null)} />{routeLoading ? <StateSurface variant="loading" title={cairnText('friend-content-screen.loading-route')} material="embedded" alignment="center" /> : <><RoutePreview points={selectedRoute.points ?? []} /><Text style={[styles.detailBody, { color: theme.foregroundSecondary }]}>{selectedRoute.description || cairnText('friend-content-screen.value-km-value-m', { value1: (selectedRoute.distanceM / 1000).toFixed(1), value2: Math.round(selectedRoute.elevationGainM) })}</Text>{actionError ? <Text style={[styles.error, { color: theme.destructive }]}>{actionError}</Text> : null}<View style={styles.actions}><PrimaryButton label={cairnText('friend-content-screen.use-for-hike')} onPress={() => void useSharedRoute('hike')} loading={leaseLoading === 'hike'} /><PrimaryButton label={cairnText('friend-content-screen.use-for-run')} variant="secondary" onPress={() => void useSharedRoute('run')} loading={leaseLoading === 'run'} /></View><PrimaryButton label={cairnText('friend-content-screen.hide-from-my-view')} variant="secondary" onPress={async () => { try { const result = await hideFriendContent('routes', selectedRoute.id, friendId); setRoutes(value => value.filter(item => item.id !== selectedRoute.id)); setSelectedRoute(null); if (!result.remoteConfirmed) setActionError(cairnText('friend-content-screen.hidden-on-this-device-we-will-retry')); } catch { setActionError(cairnText('friend-content-screen.could-not-save-this-choice-on-this')); } }} /></>}</ModalCard> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.base },
  title: { fontSize: FontSize.h2, fontWeight: '700' }, subtitle: { fontSize: FontSize.caption, marginTop: 2 },
  content: { padding: Spacing.base, paddingBottom: 48, gap: Spacing.sm }, state: { margin: Spacing.base },
  section: { marginTop: Spacing.base, fontSize: FontSize.small, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  empty: { paddingVertical: Spacing.lg, lineHeight: 20 }, row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.base },
  rowText: { flex: 1 }, rowTitle: { fontSize: FontSize.body, fontWeight: '600' }, meta: { fontSize: FontSize.caption, marginTop: 4 },
  detailBody: { fontSize: FontSize.body, lineHeight: 22, marginVertical: Spacing.base },
  preview: { height: 140, borderWidth: 1, borderRadius: Radius.card, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  actions: { gap: Spacing.sm, marginVertical: Spacing.md }, error: { marginTop: Spacing.sm, fontSize: FontSize.caption },
  offlineNotice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md },
});
