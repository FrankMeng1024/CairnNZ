/**
 * PaywallSheet — Friend System v1 / Sprint 70 / STORY-00542
 *
 * Shown when the user taps a 6th friend (beyond the
 * memory_subscription_limit = 5 cap) in MemoryFriendPickModal.
 *
 * Pre-launch cleanup (O11): wired to real RevenueCat purchase flow.
 *   - Monthly: NZD $5.99/month (cairn_pro_monthly)
 *   - Annual:  NZD $39.99/year (cairn_pro_annual)
 *   - Restore: mandatory "Restore purchases" per App Store Guidelines 3.1.1
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TouchableOpacity, Alert, ActivityIndicator, Linking } from 'react-native';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../../../components/tokens';
import { Icon } from '../../../components/Icon';
import { useSubscriptionStore } from '../../../store/useSubscriptionStore';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called after a successful purchase so the parent can re-check entitlements */
  onSubscribed?: () => void;
}

export function PaywallSheet({ visible, onClose, onSubscribed }: Props) {
  const buyMonthly = useSubscriptionStore(s => s.buyMonthly);
  const buyAnnual = useSubscriptionStore(s => s.buyAnnual);
  const restore = useSubscriptionStore(s => s.restore);
  const purchasing = useSubscriptionStore(s => s.purchasing);
  const [restoring, setRestoring] = useState(false);

  const handleMonthly = async () => {
    const result = await buyMonthly();
    if (result.success) {
      onSubscribed?.();
      onClose();
    } else if (!result.cancelled && result.error) {
      Alert.alert('Purchase failed', result.error);
    }
  };

  const handleAnnual = async () => {
    const result = await buyAnnual();
    if (result.success) {
      onSubscribed?.();
      onClose();
    } else if (!result.cancelled && result.error) {
      Alert.alert('Purchase failed', result.error);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    const status = await restore();
    setRestoring(false);
    if (status.isPro) {
      Alert.alert('Restored', 'Your Pro subscription has been restored.', [
        { text: 'OK', onPress: () => { onSubscribed?.(); onClose(); } },
      ]);
    } else {
      Alert.alert('No subscription found', 'No active Pro subscription was found for this Apple ID.');
    }
  };

  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
      testID="paywall-sheet"
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <TouchableOpacity style={styles.close} onPress={onClose} testID="paywall-close">
            <Icon name="X" size={20} color={Colors.textSecondary} strokeWidth={2.2} />
          </TouchableOpacity>

          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.heroCircle}>
              <Icon name="Heart" size={32} color={Colors.primary} strokeWidth={2.2} />
            </View>
          </View>

          <Text style={styles.title}>See more of your friends' world</Text>
          <Text style={styles.subtitle}>
            You've reached the free tier of 5 friend memories. Upgrade to see all your friends' fog,
            marks, and routes on your map.
          </Text>

          <View style={styles.valueList}>
            <ValueRow icon="Map" text="Unlimited friend memories on your map" />
            <ValueRow icon="Users" text="Switch between many friends instantly" />
            <ValueRow icon="Heart" text="Support the makers of Cairn" />
          </View>

          {/* Annual CTA (primary) */}
          <TouchableOpacity
            style={[styles.cta, styles.ctaAnnual]}
            onPress={handleAnnual}
            disabled={purchasing || restoring}
            testID="paywall-subscribe-annual"
          >
            {purchasing
              ? <ActivityIndicator size="small" color="#fff" />
              : (
                <View>
                  <Text style={styles.ctaText}>Annual — NZD $39.99 / year</Text>
                  <Text style={styles.ctaSub}>Save 44% vs monthly</Text>
                </View>
              )
            }
          </TouchableOpacity>

          {/* Monthly CTA (secondary) */}
          <TouchableOpacity
            style={[styles.cta, styles.ctaMonthly]}
            onPress={handleMonthly}
            disabled={purchasing || restoring}
            testID="paywall-subscribe-monthly"
          >
            <Text style={[styles.ctaText, { color: Colors.primary }]}>Monthly — NZD $5.99 / month</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleRestore}
            disabled={purchasing || restoring}
            testID="paywall-restore"
          >
            {restoring
              ? <ActivityIndicator size="small" color={Colors.textMuted} style={{ marginTop: Spacing.md }} />
              : <Text style={styles.foot}>Restore purchases</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => Linking.openURL('https://api.yiiling.cn/privacy')}
            testID="paywall-privacy"
          >
            <Text style={[styles.foot, styles.footLink]}>Privacy Policy</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ValueRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={valueRowStyles.row}>
      <View style={valueRowStyles.bullet}>
        <Icon name={icon as any} size={14} color={Colors.primary} strokeWidth={2.2} />
      </View>
      <Text style={valueRowStyles.text}>{text}</Text>
    </View>
  );
}

const valueRowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginVertical: Spacing.xs },
  bullet: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center', justifyContent: 'center',
  },
  text: { fontSize: FontSize.body, color: Colors.textPrimary, flex: 1 },
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    ...Shadow.card,
  },
  close: { alignSelf: 'flex-end', padding: Spacing.xs },
  hero: { alignItems: 'center', marginVertical: Spacing.md },
  heroCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: FontSize.h1, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  subtitle: {
    fontSize: FontSize.body, color: Colors.textSecondary, textAlign: 'center',
    lineHeight: 22, marginTop: Spacing.sm, marginBottom: Spacing.lg,
  },
  valueList: { marginVertical: Spacing.md },
  cta: {
    paddingVertical: Spacing.md,
    borderRadius: Radius.button,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  ctaAnnual: {
    backgroundColor: Colors.primary,
    marginTop: Spacing.lg,
  },
  ctaMonthly: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  ctaText: { color: '#fff', fontSize: FontSize.body, fontWeight: '700', textAlign: 'center' },
  ctaSub: { color: 'rgba(255,255,255,0.8)', fontSize: FontSize.caption, textAlign: 'center', marginTop: 2 },
  foot: { textAlign: 'center', fontSize: FontSize.caption, color: Colors.textMuted, marginTop: Spacing.md },
  footLink: { color: Colors.primary, textDecorationLine: 'underline' },
});

