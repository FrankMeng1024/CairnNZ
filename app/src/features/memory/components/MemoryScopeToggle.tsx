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
 *
 * v376: optional third "trailing" slot — when scope=friends, a Pick
 * friends icon expands out the right side of the pill as a third
 * segment (width + opacity animation). When scope=mine, the slot is
 * unrendered entirely (toggle pill has no extra blank space).
 * User feedback (v375): "right empty space looks bad — make it an
 * expand-out third tab, not a separate fixed-position icon."
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import { useMemoryScopeStore, type MemoryScope } from '../store/useMemoryScopeStore';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../../../components/tokens';
import { Icon } from '../../../components/Icon';

interface Props {
  /** When provided, a Pick icon is shown as a third segment that
   *  expands out from the right edge of the toggle when scope=friends.
   *  Pressing it calls onPickPress. When scope=mine, the slot is
   *  collapsed (width 0, opacity 0) and unmounted from layout. */
  onPickPress?: () => void;
}

export function MemoryScopeToggle({ onPickPress }: Props) {
  const scope = useMemoryScopeStore((s) => s.scope);
  const setScope = useMemoryScopeStore((s) => s.setScope);

  // v376: third-segment expand animation. Width grows from 0→44 and
  // opacity 0→1 when scope flips to friends. Reverses on flip back.
  const expand = useRef(new Animated.Value(scope === 'friends' ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(expand, {
      toValue: scope === 'friends' ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      // width animation requires JS driver (layout prop).
      useNativeDriver: false,
    }).start();
  }, [scope]);

  const expandWidth = expand.interpolate({ inputRange: [0, 1], outputRange: [0, 44] });
  const expandOpacity = expand;

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
      {/* v376: third "Pick friends" slot — expands out when scope=friends.
          Always mounted (so animation runs) but collapsed to 0 width when
          scope=mine. */}
      {onPickPress ? (
        <Animated.View style={{ width: expandWidth, opacity: expandOpacity, overflow: 'hidden' }}>
          <TouchableOpacity
            style={styles.pickSegment}
            onPress={() => { if (scope === 'friends') onPickPress(); }}
            disabled={scope !== 'friends'}
            activeOpacity={0.7}
            accessibilityElementsHidden={scope !== 'friends'}
            importantForAccessibility={scope === 'friends' ? 'yes' : 'no-hide-descendants'}
            testID="memory-scope-pick"
          >
            <Icon name="Users" size={16} color={Colors.primary} strokeWidth={2.2} />
          </TouchableOpacity>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
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
  // v376: Pick segment — same vertical metrics as Mine/Friends so the
  // pill height is unchanged. Width 44 = comfortable tap target while
  // matching the segment padding rhythm.
  pickSegment: {
    width: 44,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
