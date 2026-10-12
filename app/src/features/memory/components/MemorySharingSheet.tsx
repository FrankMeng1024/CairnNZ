import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { ModalCard } from '../../../components/ModalCard';
import { Icon } from '../../../components/Icon';
import { Radius, Spacing } from '../../../components/tokens';
import { useVisualTheme } from '../../../hooks/useVisualTheme';
import { useMemoryStore } from '../store/useMemoryStore';
import { useMemorySharingStore } from '../store/useMemorySharingStore';

export function MemorySharingSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useVisualTheme();
  const grants = useMemorySharingStore(state => state.grants);
  const delaySeconds = useMemorySharingStore(state => state.delaySeconds);
  const places = useMemorySharingStore(state => state.privatePlaces);
  const loading = useMemorySharingStore(state => state.loading);
  const error = useMemorySharingStore(state => state.error);
  const load = useMemorySharingStore(state => state.load);
  const applyGrantSelection = useMemorySharingStore(state => state.applyGrantSelection);
  const addPrivatePlace = useMemorySharingStore(state => state.addPrivatePlace);
  const removePrivatePlace = useMemorySharingStore(state => state.removePrivatePlace);
  const lastFix = useMemoryStore(state => state.lastWatcherFix);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [draftDirty, setDraftDirty] = useState(false);

  useEffect(() => {
    if (visible) {
      setDraftDirty(false);
      void load();
    }
  }, [load, visible]);

  useEffect(() => {
    if (visible && !draftDirty && !loading) {
      setDraftIds(grants.filter(grant => grant.enabled).map(grant => grant.friend_id));
    }
  }, [draftDirty, grants, loading, visible]);

  const toggleDraft = (friendId: string, enabled: boolean) => {
    setDraftDirty(true);
    setDraftIds(current => enabled
      ? [...new Set([...current, friendId])]
      : current.filter(id => id !== friendId));
  };

  return (
    <ModalCard visible={visible} onDismiss={onClose} testID="memory-sharing-sheet">
      <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: theme.foreground }]}>Share Memory with friends</Text>
            <Text style={[styles.subtitle, { color: theme.foregroundSecondary }]}>Choose each friend separately. New friends are never added automatically.</Text>
          </View>
          <TouchableOpacity onPress={onClose} accessibilityLabel="Close Memory sharing">
            <Icon name="X" size={20} color={theme.iconInactive} />
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {grants.length > 0 ? (
            <View style={styles.bulkRow}>
              <TouchableOpacity
                disabled={loading}
                onPress={() => { setDraftDirty(true); setDraftIds(grants.map(grant => grant.friend_id)); }}
                accessibilityRole="button"
              >
                <Text style={[styles.bulkAction, { color: theme.primary }]}>Select current friends</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={loading}
                onPress={() => { setDraftDirty(true); setDraftIds([]); }}
                accessibilityRole="button"
              >
                <Text style={[styles.bulkAction, { color: theme.primary }]}>Clear</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {grants.length === 0 ? (
            <Text style={[styles.body, { color: theme.foregroundSecondary }]}>Add and accept a friend before sharing Memory.</Text>
          ) : grants.map((grant, index) => (
            <View key={grant.friend_id} style={[styles.grantRow, index > 0 && { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[styles.rowTitle, { color: theme.foreground }]}>{grant.friend_name}</Text>
                <Text style={[styles.body, { color: theme.foregroundSecondary }]}>Full accepted Memory history · delayed at least {Math.round(delaySeconds / 60)} min</Text>
              </View>
              <Switch
                value={draftIds.includes(grant.friend_id)}
                disabled={loading}
                onValueChange={value => toggleDraft(grant.friend_id, value)}
                trackColor={{ false: theme.borderStrong, true: theme.primary }}
                accessibilityLabel={`${draftIds.includes(grant.friend_id) ? 'Stop sharing' : 'Share'} Memory with ${grant.friend_name}`}
              />
            </View>
          ))}
          {grants.length > 0 ? (
            <TouchableOpacity
              style={[styles.applyButton, { backgroundColor: theme.primary }]}
              disabled={loading || !draftDirty}
              onPress={() => void applyGrantSelection(draftIds).then(applied => applied && setDraftDirty(false))}
              accessibilityRole="button"
              accessibilityState={{ disabled: loading || !draftDirty }}
              testID="memory-sharing-apply"
            >
              <Text style={[styles.applyLabel, { color: theme.onPrimary }]}>Apply sharing choices</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={[styles.preview, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
          <Icon name="Map" size={18} color={theme.iconActive} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: theme.foreground }]}>What friends receive</Text>
            <Text style={[styles.body, { color: theme.foregroundSecondary }]}>Coarse areas only, delayed by at least {Math.round(delaySeconds / 60)} minutes. Start, end, protected places, route lines, and timestamps stay hidden. Repeated areas may still let a friend infer habits.</Text>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: theme.foreground }]}>Protected places</Text>
            <Text style={[styles.body, { color: theme.foregroundSecondary }]}>At least 250 m around each place is withheld.</Text>
          </View>
          <TouchableOpacity
            style={[styles.addButton, { borderColor: theme.borderStrong }]}
            disabled={loading || !lastFix}
            onPress={() => lastFix && void addPrivatePlace(lastFix.lat, lastFix.lng, 'Protected place')}
          >
            <Icon name="Plus" size={15} color={lastFix ? theme.iconActive : theme.iconInactive} />
            <Text style={[styles.addLabel, { color: lastFix ? theme.primary : theme.muted }]}>Current</Text>
          </TouchableOpacity>
        </View>
        {places.length === 0 ? (
          <Text style={[styles.empty, { color: theme.muted }]}>{lastFix ? 'No protected places yet.' : 'A reliable location is needed to add this place.'}</Text>
        ) : places.map(place => (
          <View key={place.id} style={[styles.placeRow, { borderColor: theme.border }]}>
            <Icon name="Shield" size={16} color={theme.iconActive} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: theme.foreground }]}>{place.label || 'Protected place'}</Text>
              <Text style={[styles.body, { color: theme.foregroundSecondary }]}>{place.radius_m} m minimum mask</Text>
            </View>
            <TouchableOpacity onPress={() => void removePrivatePlace(place.id)} accessibilityLabel="Remove protected place">
              <Icon name="Trash2" size={16} color={theme.iconInactive} />
            </TouchableOpacity>
          </View>
        ))}
        {loading ? <ActivityIndicator color={theme.primary} /> : null}
        {error ? <Text style={[styles.error, { color: theme.destructive }]}>{error}</Text> : null}
      </ScrollView>
    </ModalCard>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md },
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { fontSize: 13, marginTop: 3 },
  card: { borderWidth: 1, borderRadius: Radius.card, padding: Spacing.md, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  grantRow: { flexDirection: 'row', alignItems: 'center', minHeight: 58, paddingVertical: 8 },
  bulkRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  bulkAction: { fontSize: 12, fontWeight: '700' },
  applyButton: { minHeight: 44, borderRadius: Radius.button, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  applyLabel: { fontSize: 13, fontWeight: '700' },
  rowTitle: { fontSize: 14, fontWeight: '700' },
  body: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  context: { fontSize: 11 },
  preview: { borderWidth: 1, borderRadius: Radius.card, padding: Spacing.md, flexDirection: 'row', gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center' },
  addButton: { borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', gap: 5 },
  addLabel: { fontSize: 12, fontWeight: '700' },
  empty: { fontSize: 12, paddingVertical: 8 },
  placeRow: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  error: { fontSize: 12, lineHeight: 17 },
});
