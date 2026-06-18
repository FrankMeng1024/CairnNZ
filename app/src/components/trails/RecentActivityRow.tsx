/**
 * RecentActivityRow — small row showing the most recent finished session.
 *
 * Tapping it navigates to MapHistory for that session.
 * Renders nothing if there are no past sessions.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSessionStore } from '../../store/useSessionStore';
import { Colors } from '../tokens';

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day)        return 'Today';
  if (diff < 2 * day)    return 'Yesterday';
  if (diff < 7 * day)    return `${Math.floor(diff / day)} days ago`;
  return new Date(ms).toLocaleDateString();
}

function formatDistanceKm(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function RecentActivityRow() {
  const nav = useNavigation<any>();
  const sessions = useSessionStore((s) => s.sessions);
  const last = React.useMemo(() => {
    if (!sessions.length) return null;
    return [...sessions].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
  }, [sessions]);

  if (!last) return null;

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => nav.navigate('MapHistory', { sessionId: last.id })}
      activeOpacity={0.7}
    >
      <Text style={styles.icon}>{last.activityMode === 'running' ? '🏃' : '🥾'}</Text>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {formatRelativeTime(last.startedAt)}'s {last.activityMode === 'running' ? 'run' : 'hike'}
        </Text>
        <Text style={styles.sub}>
          {formatDistanceKm(last.distanceM)} · {formatDuration(last.durationS ?? 0)}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: 'rgba(93,124,70,0.06)',
    borderWidth: 1, borderColor: Colors.primaryLight,
    paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  icon: { fontSize: 14 },
  text: { flex: 1 },
  title: { fontSize: 12, fontWeight: '500', color: Colors.textPrimary },
  sub:   { fontSize: 10, color: Colors.textSecondary, marginTop: 1 },
  chevron: { fontSize: 16, color: Colors.textMuted },
});
