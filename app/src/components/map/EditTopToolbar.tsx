/**
 * EditTopToolbar — floating tool selector pinned to the top-right of the
 * map area when in edit mode.
 *
 * Sprint 67 v245.
 *
 * Three tools:
 *   - Pan (default) — map navigates normally; brush/eraser disabled
 *   - Brush — user draws strokes; map gestures disabled
 *   - Eraser — user erases stroke points; map gestures disabled
 *
 * Active tool gets sage primary fill; inactive tools = surface bg + border.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../Icon';
import { Colors, Spacing, Radius, Shadow } from '../tokens';
import type { EditTool } from '../../store/useRouteEditStore';

interface Props {
  activeTool: EditTool;
  onToolChange: (tool: EditTool) => void;
}

export function EditTopToolbar({ activeTool, onToolChange }: Props): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { top: insets.top + Spacing.lg + 36 }]} pointerEvents="box-none">
      <View style={styles.column} pointerEvents="auto">
        <ToolBtn
          icon="Move"
          active={activeTool === 'pan'}
          onPress={() => onToolChange('pan')}
        />
        <ToolBtn
          icon="Pencil"
          active={activeTool === 'brush'}
          onPress={() => onToolChange('brush')}
        />
        <ToolBtn
          icon="Eraser"
          active={activeTool === 'eraser'}
          onPress={() => onToolChange('eraser')}
        />
      </View>
    </View>
  );
}

interface ToolBtnProps {
  icon: string;
  active: boolean;
  onPress: () => void;
}

function ToolBtn({ icon, active, onPress }: ToolBtnProps): React.JSX.Element {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.btn, active ? styles.btnActive : styles.btnInactive]}
      activeOpacity={0.85}
    >
      <Icon
        name={icon as any}
        size={20}
        color={active ? Colors.surface : Colors.textPrimary}
        strokeWidth={2.5}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: Spacing.md,
  },
  column: {
    flexDirection: 'column',
    gap: Spacing.xs,
    backgroundColor: 'transparent',
  },
  btn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.button,
    ...Shadow.card,
  },
  btnActive: {
    backgroundColor: Colors.primary,
  },
  btnInactive: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
});
