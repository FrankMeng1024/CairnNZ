import React, { type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontSize, RadiusRole, Shadow, Spacing } from './tokens';
import { DismissButton } from './DismissButton';
import { useVisualTheme } from '../hooks/useVisualTheme';

interface Props {
  visible: boolean;
  onDismiss?: () => void;
  children: ReactNode;
  dismissible?: boolean;
  maxHeight?: `${number}%` | number;
  keyboardVerticalOffset?: number;
  testID?: string;
}

/** Shared bottom-sheet material, safe-area, keyboard and dismissal contract. */
export function BottomSheetFrame({
  visible,
  onDismiss,
  children,
  dismissible = true,
  maxHeight = '88%',
  keyboardVerticalOffset = 0,
  testID,
}: Props) {
  const theme = useVisualTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={dismissible ? onDismiss : undefined}
    >
      <KeyboardAvoidingView
        style={[styles.backdrop, { backgroundColor: theme.scrim }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={dismissible ? onDismiss : undefined}
          accessible={dismissible}
          accessibilityRole={dismissible ? 'button' : undefined}
          accessibilityLabel={dismissible ? 'Dismiss sheet' : undefined}
        />
        <View
          testID={testID}
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              maxHeight,
              paddingBottom: Math.max(insets.bottom, Spacing.lg),
              backgroundColor: theme.sheetSurface,
              borderColor: theme.borderSubtle,
              shadowColor: theme.shadow,
            },
          ]}
        >
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.handle, { backgroundColor: theme.borderStrong }]} />
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface BottomSheetHeaderProps {
  title: string;
  subtitle?: string;
  onClose?: () => void;
  trailing?: ReactNode;
  testID?: string;
}

/** Optional shared title region; domain content remains free to compose its own header. */
export function BottomSheetHeader({ title, subtitle, onClose, trailing, testID }: BottomSheetHeaderProps) {
  const theme = useVisualTheme();
  return (
    <View style={styles.header} testID={testID}>
      <View style={styles.headerCopy}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{subtitle}</Text> : null}
      </View>
      {trailing}
      {onClose ? (
        <DismissButton onPress={onClose} label="Close sheet" style={styles.close} />
      ) : null}
    </View>
  );
}

interface BottomSheetContentProps extends Pick<ScrollViewProps, 'keyboardShouldPersistTaps' | 'showsVerticalScrollIndicator'> {
  children: ReactNode;
  scrollable?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Content region with a deliberate opt-in scroll contract for variable-height sheets. */
export function BottomSheetContent({
  children,
  scrollable = false,
  style,
  contentContainerStyle,
  keyboardShouldPersistTaps = 'handled',
  showsVerticalScrollIndicator = false,
  testID,
}: BottomSheetContentProps) {
  if (scrollable) {
    return (
      <ScrollView
        style={[styles.scroll, style]}
        contentContainerStyle={contentContainerStyle}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        testID={testID}
      >
        {children}
      </ScrollView>
    );
  }
  return <View style={style} testID={testID}>{children}</View>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { width: '100%', borderTopLeftRadius: RadiusRole.sheet, borderTopRightRadius: RadiusRole.sheet, borderWidth: 1, paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, ...Shadow.sheet },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: Spacing.lg },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, marginBottom: Spacing.lg },
  headerCopy: { flex: 1 },
  title: { fontSize: FontSize.h2, fontWeight: '700', lineHeight: 26 },
  subtitle: { fontSize: FontSize.body, lineHeight: 21, marginTop: Spacing.xs },
  close: { marginTop: -Spacing.sm, marginRight: -Spacing.sm },
  scroll: { flexShrink: 1 },
});
