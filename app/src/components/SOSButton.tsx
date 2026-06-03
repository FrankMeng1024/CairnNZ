/**
 * SOSButton — Long-press emergency button with countdown.
 *
 * Interaction:
 * 1. User long-presses for 3 seconds (progress ring fills)
 * 2. 5-second countdown begins (user can cancel)
 * 3. After countdown: sends SOS via sosService
 *
 * Sprint 47 — STORY-00157
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors, Spacing, FontSize } from './tokens';
import { Icon } from './Icon';
import { sendSOS, getEmergencyContacts, type SOSState } from '../services/sosService';
import { debugLogger } from '../services/debugLogger';

interface Props {
  /** Current GPS coordinates */
  lat: number | null;
  lng: number | null;
  accuracy: number;
  /** Callback when SOS is sent */
  onSent?: () => void;
  /** Callback on error */
  onError?: (error: string) => void;
}

export function SOSButton({ lat, lng, accuracy, onSent, onError }: Props) {
  const [state, setState] = useState<SOSState>('idle');
  const [countdown, setCountdown] = useState(5);
  const [hasContacts, setHasContacts] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdProgress = useRef(new Animated.Value(0)).current;

  // Check if contacts are configured
  useEffect(() => {
    getEmergencyContacts().then(c => setHasContacts(c.length > 0));
  }, []);

  const handlePressIn = useCallback(() => {
    if (state !== 'idle') return;
    setState('holding');

    debugLogger.log({
      ts: Date.now(),
      event: 'sos_triggered',
      stage: 'longpress_start',
      lat: lat ?? undefined,
      lon: lng ?? undefined,
      accuracy_m: accuracy,
    });

    // Animate hold progress (3 seconds)
    Animated.timing(holdProgress, {
      toValue: 1,
      duration: 3000,
      useNativeDriver: false,
    }).start();

    // After 3s hold → start countdown
    holdTimer.current = setTimeout(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      debugLogger.log({
        ts: Date.now(),
        event: 'sos_triggered',
        stage: 'longpress_complete',
        lat: lat ?? undefined,
        lon: lng ?? undefined,
        accuracy_m: accuracy,
      });
      debugLogger.log({
        ts: Date.now(),
        event: 'sos_triggered',
        stage: 'countdown_start',
        lat: lat ?? undefined,
        lon: lng ?? undefined,
        accuracy_m: accuracy,
      });
      setState('countdown');
      setCountdown(5);
      startCountdown();
    }, 3000);
  }, [state, lat, lng, accuracy]);

  const handlePressOut = useCallback(() => {
    if (state === 'holding') {
      // Cancelled before 3s hold complete
      debugLogger.log({
        ts: Date.now(),
        event: 'sos_triggered',
        stage: 'longpress_cancelled',
        lat: lat ?? undefined,
        lon: lng ?? undefined,
        accuracy_m: accuracy,
      });
      cancelHold();
    }
  }, [state, lat, lng, accuracy]);

  const cancelHold = () => {
    setState('idle');
    holdProgress.setValue(0);
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const cancelCountdown = () => {
    debugLogger.log({
      ts: Date.now(),
      event: 'sos_triggered',
      stage: 'countdown_cancelled',
      lat: lat ?? undefined,
      lon: lng ?? undefined,
      accuracy_m: accuracy,
    });
    setState('idle');
    holdProgress.setValue(0);
    setCountdown(5);
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);
      countdownTimer.current = null;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const startCountdown = () => {
    let remaining = 5;
    countdownTimer.current = setInterval(() => {
      remaining--;
      setCountdown(remaining);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

      if (remaining <= 0) {
        clearInterval(countdownTimer.current!);
        countdownTimer.current = null;
        triggerSOS();
      }
    }, 1000);
  };

  const triggerSOS = async () => {
    setState('sending');

    if (lat == null || lng == null) {
      setState('failed');
      onError?.('GPS position unavailable');
      return;
    }

    const result = await sendSOS(lat, lng, accuracy);
    if (result.success) {
      setState('sent');
      onSent?.();
      // Reset after 5s
      setTimeout(() => { setState('idle'); holdProgress.setValue(0); }, 5000);
    } else {
      setState('failed');
      onError?.(result.error || 'SOS failed');
      setTimeout(() => { setState('idle'); holdProgress.setValue(0); }, 3000);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (countdownTimer.current) clearInterval(countdownTimer.current);
    };
  }, []);

  // Not configured state
  if (!hasContacts) {
    return (
      <View style={styles.container}>
        <View style={[styles.button, styles.buttonDisabled]}>
          <Icon name="Phone" size={20} color={Colors.textMuted} />
          <Text style={styles.disabledText}>Set up emergency contacts</Text>
        </View>
      </View>
    );
  }

  // Countdown state — show cancel option
  if (state === 'countdown') {
    return (
      <View style={styles.container}>
        <View style={[styles.button, styles.buttonCountdown]}>
          <Text style={styles.countdownNumber}>{countdown}</Text>
          <Text style={styles.countdownText}>Sending SOS...</Text>
        </View>
        <TouchableOpacity style={styles.cancelBtn} onPress={cancelCountdown}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Sent state
  if (state === 'sent') {
    return (
      <View style={styles.container}>
        <View style={[styles.button, styles.buttonSent]}>
          <Icon name="Check" size={24} color="#fff" />
          <Text style={styles.sentText}>SOS Sent</Text>
        </View>
      </View>
    );
  }

  // Failed state
  if (state === 'failed') {
    return (
      <View style={styles.container}>
        <View style={[styles.button, styles.buttonFailed]}>
          <Icon name="X" size={24} color="#fff" />
          <Text style={styles.sentText}>Failed — Queued</Text>
        </View>
      </View>
    );
  }

  // Idle / Holding state
  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.button, styles.buttonIdle, state === 'holding' && styles.buttonHolding]}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
      >
        <Icon name="Phone" size={20} color={Colors.danger} />
        <Text style={styles.idleText}>
          {state === 'holding' ? 'Keep holding...' : 'Hold for SOS'}
        </Text>
      </TouchableOpacity>
      {state === 'holding' && (
        <Animated.View
          style={[styles.progressBar, {
            width: holdProgress.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
          }]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: 30,
    minWidth: 180,
  },
  buttonIdle: {
    backgroundColor: Colors.dangerBg,
    borderWidth: 2,
    borderColor: Colors.danger,
  },
  buttonHolding: {
    backgroundColor: 'rgba(197, 61, 46, 0.15)',
  },
  buttonDisabled: {
    backgroundColor: Colors.border,
    borderWidth: 1,
    borderColor: Colors.textMuted,
  },
  buttonCountdown: {
    backgroundColor: Colors.danger,
    flexDirection: 'column',
    paddingVertical: Spacing.lg,
  },
  buttonSent: {
    backgroundColor: Colors.success,
  },
  buttonFailed: {
    backgroundColor: Colors.severityWarning,
  },
  idleText: {
    fontSize: FontSize.body,
    fontWeight: '700',
    color: Colors.danger,
  },
  disabledText: {
    fontSize: FontSize.caption,
    color: Colors.textMuted,
  },
  countdownNumber: {
    fontSize: 36,
    fontWeight: '800',
    color: '#fff',
  },
  countdownText: {
    fontSize: FontSize.caption,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
  },
  sentText: {
    fontSize: FontSize.body,
    fontWeight: '700',
    color: '#fff',
  },
  cancelBtn: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.lg,
  },
  cancelText: {
    fontSize: FontSize.body,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  progressBar: {
    height: 3,
    backgroundColor: Colors.danger,
    borderRadius: 2,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
});
