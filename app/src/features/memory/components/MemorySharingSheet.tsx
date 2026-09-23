import React, { useEffect } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { ModalCard } from '../../../components/ModalCard';
import { Icon } from '../../../components/Icon';
import { Radius, Spacing } from '../../../components/tokens';
import { useVisualTheme } from '../../../hooks/useVisualTheme';
import { useMemoryStore } from '../store/useMemoryStore';
import { useMemorySharingStore } from '../store/useMemorySharingStore';

export function MemorySharingSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useVisualTheme();
  const enabled = useMemorySharingStore(state => state.enabled);
  const enabledAt = useMemorySharingStore(state => state.enabledAt);
  const places = useMemorySharingStore(state => state.privatePlaces);
  const loading = useMemorySharingStore(state => state.loading);
  const error = useMemorySharingStore(state => state.error);
  const load = useMemorySharingStore(state => state.load);
  const setEnabled = useMemorySharingStore(state => state.setEnabled);
  const addPrivatePlace = useMemorySharingStore(state => state.addPrivatePlace);
  const removePrivatePlace = useMemorySharingStore(state => state.removePrivatePlace);
  const lastFix = useMemoryStore(state => state.lastWatcherFix);

  useEffect(() => {
    if (visible) void load();
  }, [load, visible]);

  return (
    <ModalCard visible={visible} onDismiss={onClose} testID="memory-sharing-sheet">
      <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: theme.foreground }]}>Let friends see new Memory</Text>
            <Text style={[styles.subtitle, { color: theme.foregroundSecondary }]}>Friendship never shares your Memory automatically.</Text>
          </View>
          <TouchableOpacity onPress={onClose} accessibilityLabel="Close Memory sharing">
            <Icon name="X" size={20} color={theme.iconInactive} />
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.row}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[styles.rowTitle, { color: theme.foreground }]}>Share future completed Activities</Text>
              <Text style={[styles.body, { color: theme.foregroundSecondary }]}>This applies to all current and future friends. It never shares live location, passive exploration, or old history.</Text>
            </View>
            <Switch
              value={enabled}
              disabled={loading}
              onValueChange={value => void setEnabled(value)}
              trackColor={{ false: theme.borderStrong, true: theme.primary }}
            />
          </View>
          <Text style={[styles.context, { color: theme.muted }]}>
            {enabledAt
              ? `Sharing started ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(enabledAt))}`
              : 'Sharing is off. New exploration stays only yours.'}
          </Text>
        </View>

        <View style={[styles.preview, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
          <Icon name="Map" size={18} color={theme.iconActive} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: theme.foreground }]}>What friends receive</Text>
            <Text style={[styles.body, { color: theme.foregroundSecondary }]}>Coarse areas with start, end, and protected places removed. Never your route line or timestamps.</Text>
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
