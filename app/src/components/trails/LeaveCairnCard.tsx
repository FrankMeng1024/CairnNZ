/**
 * LeaveCairnCard — secondary CTA for the plant flow on the Trails tab.
 *
 * Visual: cream surface card with a flag-orange stroke, orange icon
 * circle, primary copy "Leave a Cairn here" + sub. Tap → navigate to
 * the Plant flow screen.
 *
 * Copy and icon come from props so future A/B testing is a one-line
 * change at the screen level.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../tokens';

interface Props {
  title?: string;
  subtitle?: string;
  iconEmoji?: string;
  onPress: () => void;
}

export function LeaveCairnCard({
  title = 'Leave a Cairn here',
  subtitle = 'Drop a note where you stand',
  iconEmoji = '🪨',
  onPress,
}: Props) {
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <View style={styles.iconCircle}>
        <Text style={styles.iconEmoji}>{iconEmoji}</Text>
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{subtitle}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderColor: Colors.flag,
    borderWidth: 2,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: 'rgba(200,121,65,0.18)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 14,
    elevation: 3,
  },
  iconCircle: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.flag,
    alignItems: 'center', justifyContent: 'center',
  },
  iconEmoji: { fontSize: 18 },
  text: { flex: 1 },
  title: { fontSize: 14, fontWeight: '700', color: Colors.flag },
  sub:   { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  chevron: { fontSize: 18, color: Colors.flag, fontWeight: '600' },
});
