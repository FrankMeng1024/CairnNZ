/**
 * MemoryScopeToggle — Friend System v1 / Sprint 70 / STORY-00539
 *
 * Pill toggle rendered in MemoryScreen top bar. Switches Memory tab
 * between Mine and Friends scope.
 *
 * Friends scope drives:
 *   - FogLayer to render UNION (Story-541 — DEFERRED to iPhone gate)
 *   - CairnPinsLayer to include friend-tier + Public marks (Story-543)
 *   - Memory subscriptions picker access (Story-540)
 *
 * Visual: glass pill with 2 segments, sepia tokens. Sits inline with
 * BackButton in the top bar.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useMemoryScopeStore, type MemoryScope } from '../store/useMemoryScopeStore';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../../../components/tokens';

export function MemoryScopeToggle() {
  const scope = useMemoryScopeStore((s) => s.scope);
  const setScope = useMemoryScopeStore((s) => s.setScope);

  const opts: { id: MemoryScope; label: string }[] = [
    { id: 'mine', label: 'Mine' },
    { id: 'friends', label: 'Friends' },
  ];

  return (
    <View style={styles.container} testID="memory-scope-toggle">
      {opts.map((o) => {
        const active = scope === o.id;
        return (
          <TouchableOpacity
            key={o.id}
            style={[styles.segment, active && styles.segmentActive]}
            onPress={() => setScope(o.id)}
            activeOpacity={0.7}
            testID={`memory-scope-${o.id}`}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Radius.pill,
    padding: 3,
    ...Shadow.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  segment: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: 'transparent',
  },
  segmentActive: {
    backgroundColor: Colors.primaryBg,
  },
  label: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  labelActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
});
