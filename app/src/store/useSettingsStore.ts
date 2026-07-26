/**
 * useSettingsStore — App-wide user preferences (persisted via MMKV).
 *
 * Consumed by: SettingsScreen (read/write), HikingScreen (read broadcast/deviation),
 * RunningScreen (read broadcast), BroadcastService (read voiceBroadcasts/dangerAlerts).
 */
import { create } from 'zustand';
import { storage } from './storage';
import { debugLogger } from '../services/debugLogger';

interface Settings {
  // Emergency
  tripSharing: boolean;

  // Broadcasts
  voiceBroadcasts: boolean;
  dangerAlerts: boolean;
  routeDeviation: boolean;

  // Feedback
  hapticFeedback: boolean;
  soundEffects: boolean;
  edgeWarningGlow: boolean;

  // Social
  shareAfterAdd: boolean;
  locationShare: boolean;

  // Display
  nightMode: boolean;

  // Voice guidance
  broadcastEnabled: boolean;

  // ── Debug / Telemetry (real-device test) ──────────────────────────────
  debugMode: boolean;                    // master switch — gates everything below
  debugAnnotationFabVisible: boolean;    // show the floating L4 annotation button
  telemetryUploadEnabled: boolean;       // auto-upload session JSON to backend
  telemetryWifiOnly: boolean;            // only upload over WiFi (avoid cellular)
  telemetryBackendUrl: string;           // override backend URL (empty = use EXPO_PUBLIC_BACKEND_URL)
  telemetryApiKey: string;               // X-API-Key for telemetry endpoint
}

const STORAGE_KEY = 'cairn_settings';

const DEFAULTS: Settings = {
  tripSharing: true,
  voiceBroadcasts: true,
  dangerAlerts: true,
  routeDeviation: true,
  hapticFeedback: true,
  soundEffects: true,
  edgeWarningGlow: true,
  shareAfterAdd: true,
  locationShare: false,
  nightMode: false,
  broadcastEnabled: true,
  debugMode: false,
  debugAnnotationFabVisible: true,
  telemetryUploadEnabled: true,
  // v408 fix: 默认 false — 用户在地铁/山里 4G/5G 场景下没 WiFi,
  // 之前 WiFi-only=true 会导致 JSONL 文件永远上不去,昨天 hike 数据
  // 只有前 21 点 (JS 死前) 上了服务器,后 56 分钟 native 记的都没推。
  // debug telemetry 本质上是 dev 工具,不该默认阻塞真实数据流。
  // 用户可在 Settings 手动开 WiFi-only。
  telemetryWifiOnly: false,
  telemetryBackendUrl: '',
  telemetryApiKey: '',
};

interface SettingsState extends Settings {
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  saveAll: (patch: Partial<Settings>) => void;
  hydrate: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULTS,

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
    try {
      const raw = await storage.getItem(STORAGE_KEY);
      if (raw) {
        const saved: Partial<Settings> = JSON.parse(raw);
        // v408 migration: 老用户 AsyncStorage 里 telemetryWifiOnly=true 已存,
        // hydrate 会覆盖 DEFAULTS 让新默认 false 失效。一次性强制覆盖:
        // 若 saved 里显式 wifiOnly=true 且没有 migration flag,强制 false 一次。
        // Migration flag 存在 saved 里,以后用户手动改 wifiOnly 也不会再触发。
        const migrated: Partial<Settings> & { __v408_wifionly_migrated?: boolean } = { ...saved };
        if (saved.telemetryWifiOnly === true && !(saved as Record<string, unknown>).__v408_wifionly_migrated) {
          migrated.telemetryWifiOnly = false;
          (migrated as Record<string, unknown>).__v408_wifionly_migrated = true;
          try { storage.setItem(STORAGE_KEY, JSON.stringify(migrated)); } catch { /* ignore */ }
        }
        set({ ...DEFAULTS, ...migrated });
        debugLogger.setEnabled(Boolean(saved.debugMode));
      } else {
        debugLogger.setEnabled(DEFAULTS.debugMode);
      }
    } catch {
      // Use defaults on parse error
      debugLogger.setEnabled(DEFAULTS.debugMode);
    }
  },
}));

// Extract only Settings fields (strip Zustand methods)
function pick(state: SettingsState): Settings {
  const { updateSetting: _, saveAll: __, hydrate: ___, ...settings } = state;
  return settings as Settings;
}
