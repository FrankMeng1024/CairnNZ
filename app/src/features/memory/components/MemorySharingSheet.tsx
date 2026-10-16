import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { ModalCard } from '../../../components/ModalCard';
import { Icon } from '../../../components/Icon';
import { Radius, Spacing } from '../../../components/tokens';
import { useVisualTheme } from '../../../hooks/useVisualTheme';
import { useMemorySharingStore } from '../store/useMemorySharingStore';
import { useAppStore } from '../../../store/useAppStore';

export function MemorySharingSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useVisualTheme();
  const currentOwnerId = useAppStore(state => state.user?.id == null ? null : String(state.user.id));
  const sharingOwnerId = useMemorySharingStore(state => state.ownerId);
  const storedGrants = useMemorySharingStore(state => state.grants);
  const delaySeconds = useMemorySharingStore(state => state.delaySeconds);
  const loading = useMemorySharingStore(state => state.loading);
  const error = useMemorySharingStore(state => state.error);
  const load = useMemorySharingStore(state => state.load);
  const applyGrantSelection = useMemorySharingStore(state => state.applyGrantSelection);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [draftDirty, setDraftDirty] = useState(false);
  const ownerMatches = Boolean(currentOwnerId && sharingOwnerId === currentOwnerId);
  const grants = ownerMatches ? storedGrants : [];

  useEffect(() => {
    if (visible && currentOwnerId) {
      setDraftDirty(false);
      void load(currentOwnerId);
    }
  }, [currentOwnerId, load, visible]);

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
            <Text style={[styles.body, { color: theme.foregroundSecondary }]}>{loading || !ownerMatches ? 'Loading sharing choices…' : 'Add and accept a friend before sharing Memory.'}</Text>
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
            <Text style={[styles.body, { color: theme.foregroundSecondary }]}>Complete eligible exploration as coarse areas, delayed by at least {Math.round(delaySeconds / 60)} minutes. Raw GPS, route lines, precise visit points, and timestamps stay hidden. Repeated areas may still let a friend infer habits.</Text>
          </View>
        </View>
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
  error: { fontSize: 12, lineHeight: 17 },
});
