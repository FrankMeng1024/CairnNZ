/**
 * Sprint 72 STORY-00556 — iOS Low Power Mode warning.
 *
 * When tracking is active + iOS Low Power Mode is on, background tasks
 * (including our GPS task) may be throttled by iOS. Show a one-time
 * alert per 24 hours so the user can decide whether to disable LPM.
 *
 * Deduped by AsyncStorage timestamp key so the user isn't nagged.
 */
import { Alert, Platform } from 'react-native';
import { crashLogger } from './crashLogger';
import { cairnText } from '../i18n/runtime';

const DEDUPE_KEY = 'cairn_lpm_warned_ts';
const DEDUPE_WINDOW_MS = 24 * 60 * 60_000;

export async function checkAndWarnLowPowerMode(): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  try {
    const Battery = require('expo-battery');
    const isLpm = await Battery.isLowPowerModeEnabledAsync?.();
    if (!isLpm) return;
    crashLogger.breadcrumb('lpm:detected');
    // Dedupe by timestamp
    const AsyncStorageMod = await import('@react-native-async-storage/async-storage');
    const AsyncStorage = AsyncStorageMod.default ?? AsyncStorageMod;
    const lastTs = await AsyncStorage.getItem(DEDUPE_KEY);
    const now = Date.now();
    if (lastTs) {
      const last = parseInt(lastTs, 10);
      if (!Number.isNaN(last) && now - last < DEDUPE_WINDOW_MS) {
        crashLogger.breadcrumb('lpm:warning_skipped_recent_flag');
        return;
      }
    }
    await AsyncStorage.setItem(DEDUPE_KEY, String(now));
    crashLogger.breadcrumb('lpm:warning_shown');
    Alert.alert(
      cairnText('low-power-mode-warn.low-power-mode-is-on'),
      cairnText('low-power-mode-warn.ios-may-limit-background-gps-while-low'),
      [{ text: cairnText('low-power-mode-warn.ok') }]
    );
  } catch {
    // expo-battery may not be available (web, old build) — silent.
  }
}
