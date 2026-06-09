/**
 * EditCoachmark — First-run UX guide for edit mode.
 *
 * 3 steps shown to first-time users:
 *   1. "Drag the green/red dots to trim start/end"
 *   2. "Tap the route to add an edit point — stays within 1km of your walked path"
 *   3. "Tap Save when done. Your original walked path is preserved as a fade."
 *
 * Persistence: AsyncStorage flag `@cairn:edit_coachmark_seen_v1`.
 * Replay: Settings → "Show route edit tips again" (out of scope; shipped TBD).
 *
 * Also includes ApproximateWarningBar — a transient toast-style banner
 * that the parent screen mounts and unmounts based on whether the
 * latest edit operation produced an approximate-confidence segment.
 * Parent is responsible for show/hide lifecycle (no auto-viewport
 * detection — parent decides). Kept in this file because it shares
 * styling with EditCoachmark.
 *
 * Sprint 66 Wave 6 (Fix-6: removed misleading "viewport-scoped" claim).
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@cairn:edit_coachmark_seen_v1';

const STEPS = [
  {
    title: 'Trim your route',
    body: 'Drag the green or red dot at the start or end to shorten your route.',
  },
  {
    title: 'Adjust the middle',
    body:
      'Tap any point on the route to drag it. Stays within 1 km of where you actually walked — no creative routing.',
  },
  {
    title: 'Save when done',
    body:
      'Your original walked path is preserved as a faded line. Edits show as blue. Tap Save to keep changes.',
  },
];

interface EditCoachmarkProps {
  /** Force-show the coachmark (replay from Settings). */
  forceShow?: boolean;
  onClose?: () => void;
}

export function EditCoachmark({
  forceShow,
  onClose,
}: EditCoachmarkProps): React.JSX.Element | null {
  const [seen, setSeen] = useState<boolean | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (forceShow) {
      setSeen(false);
      setStep(0);
      return;
    }
    AsyncStorage.getItem(STORAGE_KEY)
      .then(v => setSeen(v === '1'))
      .catch(() => setSeen(false));
  }, [forceShow]);

  if (seen !== false) return null;

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }
    AsyncStorage.setItem(STORAGE_KEY, '1').catch(() => {});
    setSeen(true);
    onClose?.();
  };

  const handleSkip = () => {
    AsyncStorage.setItem(STORAGE_KEY, '1').catch(() => {});
    setSeen(true);
    onClose?.();
  };

  const current = STEPS[step];

  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.stepLabel}>
            Step {step + 1} / {STEPS.length}
          </Text>
          <Text style={styles.title}>{current.title}</Text>
          <Text style={styles.body}>{current.body}</Text>
          <View style={styles.actions}>
            <TouchableOpacity onPress={handleSkip} style={styles.skipBtn}>
              <Text style={styles.skipBtnText}>Skip</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleNext} style={styles.nextBtn}>
              <Text style={styles.nextBtnText}>
                {step < STEPS.length - 1 ? 'Next' : 'Got it'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

interface ApproximateWarningProps {
  visible: boolean;
  message?: string;
}

export function ApproximateWarningBar({
  visible,
  message,
}: ApproximateWarningProps): React.JSX.Element | null {
  if (!visible) return null;
  return (
    <View style={styles.warningBar}>
      <Text style={styles.warningText}>
        {message ?? 'Approximate route — try a closer point'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 6,
  },
  stepLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 8,
    fontWeight: '500',
  },
  title: {
    fontSize: 20,
    color: '#111827',
    marginBottom: 8,
    fontWeight: '700',
  },
  body: {
    fontSize: 15,
    color: '#374151',
    lineHeight: 22,
    marginBottom: 24,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  skipBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  skipBtnText: {
    fontSize: 15,
    color: '#6B7280',
    fontWeight: '500',
  },
  nextBtn: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  nextBtnText: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  warningBar: {
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(245, 158, 11, 0.95)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    zIndex: 1000,
  },
  warningText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
});
