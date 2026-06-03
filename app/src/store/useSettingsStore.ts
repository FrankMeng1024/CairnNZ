/**
 * useSettingsStore — App-wide user preferences (persisted via MMKV).
 *
 * Consumed by: SettingsScreen (read/write), HikingScreen (read broadcast/deviation),
 * RunningScreen (read broadcast), BroadcastService (read voiceBroadcasts/dangerAlerts).
 */
import { create } from 'zustand';
import { storage } from './storage';
import { debugLogger } from '../services/debugLogger';

export interface Settings {
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
  telemetryWifiOnly: true,
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
        set({ ...DEFAULTS, ...saved });
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
