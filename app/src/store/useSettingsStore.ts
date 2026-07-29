/**
 * useSettingsStore — App-wide user preferences (persisted via MMKV).
 *
 * O12 (2026-07-27): trimmed to real-consumer settings only:
 *   - units (new): 'metric' | 'imperial' — powers formatDistance util
 *   - nightMode: dark theme toggle (Phase 4 audit)
 *   - hapticFeedback: gates Haptics.selectionAsync() call sites (Phase 2)
 *   - debugMode: unlocked via 5-tap on About Cairn row — reveals Developer section
 *   - debugAnnotationFabVisible / telemetry*: kept for real-device debug workflow
 *
 * Removed in O12 (were placebo toggles with zero runtime consumers):
 *   - tripSharing, voiceBroadcasts, dangerAlerts, routeDeviation, broadcastEnabled
 *   - soundEffects, edgeWarningGlow
 *   - shareAfterAdd, locationShare
 * These fields will remain in the persisted MMKV blob for existing users but are
 * stripped on hydrate (see migration below).
 */
import { create } from 'zustand';
import { storage } from './storage';
import { debugLogger } from '../services/debugLogger';

export type UnitsPref = 'metric' | 'imperial';
// O18 HIST-09: user-selectable date format. Default 'dmy' (DD/MM/YYYY, NZ/UK style).
// 'mdy' = MM/DD/YYYY (US), 'ymd' = YYYY-MM-DD (ISO).
export type DateFormatPref = 'dmy' | 'mdy' | 'ymd';

interface Settings {
  // Preferences
  units: UnitsPref;
  dateFormat: DateFormatPref;
  nightMode: boolean;
  hapticFeedback: boolean;

  // Debug / Telemetry (real-device test)
  debugMode: boolean;                    // master switch — 5-tap on About Cairn to unlock
  debugAnnotationFabVisible: boolean;    // show the floating L4 annotation button
  telemetryUploadEnabled: boolean;       // auto-upload session JSON to backend
  telemetryWifiOnly: boolean;            // only upload over WiFi (avoid cellular)
  telemetryBackendUrl: string;           // override backend URL (empty = use EXPO_PUBLIC_BACKEND_URL)
  telemetryApiKey: string;               // X-API-Key for telemetry endpoint
}

const STORAGE_KEY = 'cairn_settings';

// O12: fields removed from Settings that may still exist in persisted JSON from old builds.
// We strip them on hydrate so pick() doesn't re-persist them forever.
const REMOVED_KEYS = [
  'tripSharing', 'voiceBroadcasts', 'dangerAlerts', 'routeDeviation', 'broadcastEnabled',
  'soundEffects', 'edgeWarningGlow', 'shareAfterAdd', 'locationShare',
] as const;

const DEFAULTS: Settings = {
  units: 'metric',       // NZ default — user can switch in Settings
  dateFormat: 'dmy',     // NZ default — DD/MM/YYYY
  nightMode: false,
  hapticFeedback: true,
  debugMode: false,
  debugAnnotationFabVisible: true,
  telemetryUploadEnabled: true,
  // v408 fix: 默认 false — 用户在地铁/山里 4G/5G 场景下没 WiFi,
  // 之前 WiFi-only=true 会导致 JSONL 文件永远上不去。
  // debug telemetry 本质上是 dev 工具,不该默认阻塞真实数据流。
  // 用户可在 Settings 手动开 WiFi-only。
  telemetryWifiOnly: false,
  telemetryBackendUrl: '',
  telemetryApiKey: '',
};

interface SettingsState extends Settings {
  /** True once hydrate() has completed at least once. App gate can wait on this
   *  to avoid a first-frame flash of DEFAULTS before the persisted value loads
   *  (Round-3 R3-H1: units metric→imperial flicker on cold start). */
  hydrated: boolean;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  saveAll: (patch: Partial<Settings>) => void;
  hydrate: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,

  updateSetting: (key, value) => {
    set({ [key]: value } as Partial<Settings>);
    const next = { ...get(), [key]: value };
    storage.setItem(STORAGE_KEY, JSON.stringify(pick(next)));
    if (key === 'debugMode') debugLogger.setEnabled(Boolean(value));
  },

  saveAll: (patch) => {
    set(patch);
    const next = { ...get(), ...patch };
    storage.setItem(STORAGE_KEY, JSON.stringify(pick(next)));
    if (patch.debugMode !== undefined) debugLogger.setEnabled(Boolean(patch.debugMode));
  },

  hydrate: async () => {
    // Round-5 R5-H2: bound storage.getItem with a 5s race so a hung
    // AsyncStorage/MMKV (rare but observed under iOS jetsam / disk
    // pressure) cannot deadlock the App boot gate. On timeout we fall
    // through to DEFAULTS but still flip hydrated:true so App.tsx
    // renders instead of the perma-blank splash.
    const TIMEOUT_MS = 5000;
    const withTimeout = <T,>(p: Promise<T>): Promise<T | null> =>
      new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), TIMEOUT_MS);
        p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
      });
    try {
      const raw = await withTimeout(storage.getItem(STORAGE_KEY));
      if (raw) {
        const saved: Partial<Settings> & Record<string, unknown> = JSON.parse(raw);

        // v408 migration: 老用户 AsyncStorage 里 telemetryWifiOnly=true 已存,
        // hydrate 会覆盖 DEFAULTS 让新默认 false 失效。一次性强制覆盖。
        const migrated: Partial<Settings> & { __v408_wifionly_migrated?: boolean } & Record<string, unknown> = { ...saved };
        if (saved.telemetryWifiOnly === true && !saved.__v408_wifionly_migrated) {
          migrated.telemetryWifiOnly = false;
          migrated.__v408_wifionly_migrated = true;
        }

        // O12 migration: strip removed field keys so they don't get re-persisted.
        let mutated = false;
        for (const k of REMOVED_KEYS) {
          if (k in migrated) {
            delete migrated[k];
            mutated = true;
          }
        }

        // O12 Round-3 R3-H2 + Round-4 V4-N1: runtime type check for every
        // field. TypeScript declares strict types but the JSON blob has no
        // such guarantee (dev-tool write, MMKV corruption, cross-version
        // downgrade). If a bad value slipped in, drop the key so DEFAULTS
        // wins in the spread below.
        if (migrated.units !== 'metric' && migrated.units !== 'imperial') {
          delete migrated.units;
        }
        if (migrated.dateFormat !== 'dmy' && migrated.dateFormat !== 'mdy' && migrated.dateFormat !== 'ymd') {
          delete migrated.dateFormat;
        }
        const boolFields = [
          'nightMode', 'hapticFeedback', 'debugMode',
          'debugAnnotationFabVisible', 'telemetryUploadEnabled', 'telemetryWifiOnly',
        ] as const;
        for (const k of boolFields) {
          if (k in migrated && typeof migrated[k] !== 'boolean') {
            delete migrated[k];
          }
        }
        const stringFields = ['telemetryBackendUrl', 'telemetryApiKey'] as const;
        for (const k of stringFields) {
          if (k in migrated && typeof migrated[k] !== 'string') {
            delete migrated[k];
          }
        }

        if (mutated) {
          try { storage.setItem(STORAGE_KEY, JSON.stringify(migrated)); } catch { /* ignore */ }
        }

        set({ ...DEFAULTS, ...migrated, hydrated: true });
        debugLogger.setEnabled(Boolean(saved.debugMode));
      } else {
        set({ hydrated: true });
        debugLogger.setEnabled(DEFAULTS.debugMode);
      }
    } catch {
      // Use defaults on parse error — still mark hydrated so app boot unblocks.
      set({ hydrated: true });
      debugLogger.setEnabled(DEFAULTS.debugMode);
    }
  },
}));

// Extract only Settings fields. Round-4 R4-M2: explicit whitelist instead of
// destructure-and-rest. Rest-spread + `as Settings` cast would silently
// persist any new SettingsState-only method or migration flag that future
// commits add — TS can't catch it because the cast erases the extra keys.
// This whitelist forces a compile error whenever a new Settings field is
// added but not returned here, and prevents dev-only meta (hydrated, __v408
// migration flag, etc.) from leaking into the persisted MMKV blob.
function pick(state: SettingsState): Settings {
  return {
    units: state.units,
    dateFormat: state.dateFormat,
    nightMode: state.nightMode,
    hapticFeedback: state.hapticFeedback,
    debugMode: state.debugMode,
    debugAnnotationFabVisible: state.debugAnnotationFabVisible,
    telemetryUploadEnabled: state.telemetryUploadEnabled,
    telemetryWifiOnly: state.telemetryWifiOnly,
    telemetryBackendUrl: state.telemetryBackendUrl,
    telemetryApiKey: state.telemetryApiKey,
  };
}
