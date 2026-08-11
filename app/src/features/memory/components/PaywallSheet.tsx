/**
 * PaywallSheet — Friend System v1 / Sprint 70 / STORY-00542
 *
 * Shown when the user taps a 6th friend (beyond the
 * memory_subscription_limit = 5 cap) in MemoryFriendPickModal.
 *
 * Batch 6.8 (Sprint 6): wired to react-native-purchases via iapService.
 * getOfferings() returns [] when the native module isn't in the current
 * build — in that case Subscribe falls back to a "Coming soon" alert.
 * Once the EAS build ships with react-native-purchases + a configured
 * RC public key, real StoreKit / Play Billing runs.
 *
 * UX: full-screen sheet with hero image, value props, single CTA.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../../../components/tokens';
import { Icon } from '../../../components/Icon';
import { getOfferings, purchasePackage, restorePurchases, type OfferingPackage } from '../../../services/iapService';

interface Props {
  visible: boolean;
  onClose: () => void;
  onEntitled?: () => void;   // Batch 6.8: caller can react to a successful purchase.
}

export function PaywallSheet({ visible, onClose, onEntitled }: Props) {
  const [offerings, setOfferings] = useState<OfferingPackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [purchasing, setPurchasing] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const pkgs = await getOfferings();
      if (!cancelled) {
        setOfferings(pkgs);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [visible]);

  const primaryPkg = offerings[0] || null;
  const priceLabel = primaryPkg?.priceString || 'NZ$5.99 / month';

  const onSubscribe = async () => {
    if (!primaryPkg) {
      // No offerings — SDK not initialised (no EAS build with RevenueCat
      // native module yet). Fall back to "coming soon" so the user isn't
      // stuck. Batch 6.10 Pre-Build gate flips this once the module is in.
      Alert.alert(
        'Coming soon',
        'Memory Pro will be available in the App Store release. For now, you have 5 friend slots.',
        [{ text: 'OK', onPress: onClose }],
      );
      return;
    }
    setPurchasing(true);
    try {
      const r = await purchasePackage(primaryPkg);
      if (r.cancelled) return;   // silent — user tapped X
      if (r.error) {
        Alert.alert('Purchase failed', r.error, [{ text: 'OK' }]);
        return;
      }
      if (r.hasEntitlement) {
        Alert.alert('Welcome to Memory Pro', 'You now have unlimited friend slots. Thank you for supporting Cairn!', [{ text: 'OK' }]);
        onEntitled?.();
        onClose();
      } else if (r.success) {
        // Sprint 6 review M7: purchase succeeded but entitlement didn't
        // flip on immediately (rare — RC entitlement provisioning delay
        // or webhook lag). Give the user a clear status + a "try later"
        // path instead of a silent dead-end.
        Alert.alert(
          'Purchase received',
          'Thank you! Your subscription is being activated — this can take a minute. If you don\'t see access shortly, tap Restore purchases.',
          [{ text: 'OK', onPress: onClose }],
        );
      }
    } finally {
      setPurchasing(false);
    }
  };

  const onRestore = async () => {
    setPurchasing(true);
    try {
      const r = await restorePurchases();
      if (r.hasEntitlement) {
        Alert.alert('Restored', 'Your Memory Pro subscription is active.', [{ text: 'OK' }]);
        onEntitled?.();
        onClose();
      } else {
        Alert.alert('Nothing to restore', 'No active subscription found on this account.', [{ text: 'OK' }]);
      }
    } finally {
      setPurchasing(false);
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

          {/* Hero — sepia gradient circle with sparkle */}
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

          <View style={styles.priceRow}>
            <Text style={styles.price}>{priceLabel.split(' ')[0] || 'NZ$5.99'}</Text>
            <Text style={styles.priceUnit}>{primaryPkg?.packageType === 'ANNUAL' ? 'per year' : 'per month'}</Text>
          </View>

          <TouchableOpacity
            style={[styles.cta, purchasing && { opacity: 0.6 }]}
            onPress={onSubscribe}
            disabled={purchasing || loading}
            testID="paywall-subscribe"
          >
            {purchasing
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.ctaText}>{primaryPkg ? 'Subscribe' : 'Continue'}</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={onRestore} disabled={purchasing} testID="paywall-restore">
            <Text style={styles.foot}>Restore purchases · Privacy · Terms</Text>
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
  priceRow: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center',
    gap: 4, marginTop: Spacing.md,
  },
  price: { fontSize: 32, fontWeight: '700', color: Colors.textPrimary },
  priceUnit: { fontSize: FontSize.body, color: Colors.textSecondary },
  cta: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: Radius.button,
    alignItems: 'center',
    marginTop: Spacing.lg,
  },
  ctaText: { color: '#fff', fontSize: FontSize.body, fontWeight: '700' },
  foot: { textAlign: 'center', fontSize: FontSize.caption, color: Colors.textMuted, marginTop: Spacing.md },
});
