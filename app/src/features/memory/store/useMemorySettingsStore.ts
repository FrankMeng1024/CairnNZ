/**
 * Memory settings store — user preferences for memory unlocking.
 *
 * Keys:
 *   - foregroundAutoUnlockEnabled (default: false)
 *       Permits foreground exploration outside an explicit Activity.
 *       Hike/Run Memory capture is always active and ignores this setting.
 *   - recordMode (legacy persisted adapter; normalized to session-only unless
 *       passive exploration was explicitly enabled by the user)
 *   - showFriendOverlay (default: true)
 *       Whether the Memory map shows friends' shared fog overlaid.
 *   - firstVisitDone (default: false)
 *       Set to true after the user dismisses the first-time hint.
 *
 * Persisted to AsyncStorage so settings survive restarts.
 */

import { create } from 'zustand';
import { storage } from '../../../store/storage';

const STORAGE_KEY = 'cairn:memorySettings:v2';

type RecordMode = 'always' | 'session-only';

interface MemorySettings {
  foregroundAutoUnlockEnabled: boolean;
  recordMode: RecordMode;
  showFriendOverlay: boolean;
  firstVisitDone: boolean;
  /** v305 OTA: H3 hex-cell fog enabled. Default true. False = kill-switch
   *  (FogLayer returns null, user sees base map without fog) — for debug
   *  triage when H3 path misbehaves on real device. */
  useH3Fog: boolean;
}

interface MemorySettingsState extends MemorySettings {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  set: <K extends keyof MemorySettings>(key: K, value: MemorySettings[K]) => void;
  reset: () => void;
}

const DEFAULTS: MemorySettings = {
  // This controls only passive exploration outside an explicit Activity.
  // Activity Memory capture is unconditional and lives in the recorder.
  foregroundAutoUnlockEnabled: false,
  recordMode: 'session-only',
  showFriendOverlay: true,
  firstVisitDone: false,
  // v305 OTA: H3 hex fog 默认开启。
  useH3Fog: true,
};

function persist(state: MemorySettings): void {
  void storage.setItem(STORAGE_KEY, JSON.stringify({
    ...state,
    passiveExplorationContractVersion: 1,
  }));
}

async function tryLoad(): Promise<MemorySettings | null> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    // The former setting defaulted to an always-on recorder. Its persisted
    // `true` is not proof of consent to the new passive-exploration product
    // behavior, so every pre-contract payload receives the new OFF default
    // once. Subsequent explicit choices carry the version marker above.
    const migratedToPassiveContract = parsed.passiveExplorationContractVersion === 1;
    const recordModeRaw = migratedToPassiveContract ? parsed.recordMode : 'session-only';
    const recordMode: RecordMode =
      recordModeRaw === 'always' ? 'always' : 'session-only';
    return {
      foregroundAutoUnlockEnabled: migratedToPassiveContract
        ? Boolean(parsed.foregroundAutoUnlockEnabled ?? DEFAULTS.foregroundAutoUnlockEnabled)
        : false,
      recordMode,
      showFriendOverlay: Boolean(parsed.showFriendOverlay ?? DEFAULTS.showFriendOverlay),
      firstVisitDone: Boolean(parsed.firstVisitDone ?? DEFAULTS.firstVisitDone),
      // v305 OTA: useH3Fog 默认 true(老用户字段不存在时也启用)。
      useH3Fog: typeof parsed.useH3Fog === 'boolean' ? parsed.useH3Fog : DEFAULTS.useH3Fog,
    };
  } catch {
    return null;
  }
}

export const useMemorySettingsStore = create<MemorySettingsState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const loaded = await tryLoad();
    if (loaded) {
      set({ ...loaded, hydrated: true });
    } else {
      set({ hydrated: true });
    }
  },

  set: (key, value) => {
    set({ [key]: value } as Partial<MemorySettingsState>);
    const { foregroundAutoUnlockEnabled, recordMode, showFriendOverlay, firstVisitDone, useH3Fog } = get();
    persist({ foregroundAutoUnlockEnabled, recordMode, showFriendOverlay, firstVisitDone, useH3Fog });
  },

  reset: () => {
    set({ ...DEFAULTS });
    persist(DEFAULTS);
  },
}));
