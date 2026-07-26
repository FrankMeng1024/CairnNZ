/**
 * Memory settings store — user preferences for memory unlocking.
 *
 * Keys:
 *   - foregroundAutoUnlockEnabled (default: true)
 *       App-foreground GPS continuously clears fog as user walks.
 *   - recordMode (default: 'always')
 *       'always'         — record memory whenever app is foreground
 *       'session-only'   — only during an active Hiking/Running session
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

export type RecordMode = 'always' | 'session-only';

export interface MemorySettings {
  foregroundAutoUnlockEnabled: boolean;
  recordMode: RecordMode;
  showFriendOverlay: boolean;
  firstVisitDone: boolean;
  /** v305 OTA: H3 hex-cell fog enabled. Default true. False = kill-switch
   *  (FogLayer returns null, user sees base map without fog) — for debug
   *  triage when H3 path misbehaves on real device. */
  useH3Fog: boolean;
  /** O1 batch 28.6 (Bug 7): 走路是否实时解锁 memory。
   *  true (默认) = 走路时 GPS 点实时进 memory,fog 实时清 (现有行为)
   *  false = 只有 save hike/run 时才把这次的 GPS 点写入 memory
   *  测试场景 (sim-walker) 用户希望关闭,避免 fog 被走垃圾数据覆盖。 */
  unlockOnWalk: boolean;
}

interface MemorySettingsState extends MemorySettings {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  set: <K extends keyof MemorySettings>(key: K, value: MemorySettings[K]) => void;
  reset: () => void;
}

const DEFAULTS: MemorySettings = {
  foregroundAutoUnlockEnabled: true,
  recordMode: 'always',
  showFriendOverlay: true,
  firstVisitDone: false,
  // v305 OTA: H3 hex fog 默认开启。
  useH3Fog: true,
  // O1 batch 28.6: 默认走路时实时 unlock memory (现有行为)。
  unlockOnWalk: true,
};

function persist(state: MemorySettings): void {
  void storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function tryLoad(): Promise<MemorySettings | null> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const recordModeRaw = parsed.recordMode;
    const recordMode: RecordMode =
      recordModeRaw === 'session-only' ? 'session-only' : 'always';
    return {
      foregroundAutoUnlockEnabled: Boolean(parsed.foregroundAutoUnlockEnabled ?? DEFAULTS.foregroundAutoUnlockEnabled),
      recordMode,
      showFriendOverlay: Boolean(parsed.showFriendOverlay ?? DEFAULTS.showFriendOverlay),
      firstVisitDone: Boolean(parsed.firstVisitDone ?? DEFAULTS.firstVisitDone),
      // v305 OTA: useH3Fog 默认 true(老用户字段不存在时也启用)。
      useH3Fog: typeof parsed.useH3Fog === 'boolean' ? parsed.useH3Fog : DEFAULTS.useH3Fog,
      // O1 batch 28.6: unlockOnWalk 默认 true。
      unlockOnWalk: typeof parsed.unlockOnWalk === 'boolean' ? parsed.unlockOnWalk : DEFAULTS.unlockOnWalk,
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
    const { foregroundAutoUnlockEnabled, recordMode, showFriendOverlay, firstVisitDone, useH3Fog, unlockOnWalk } = get();
    persist({ foregroundAutoUnlockEnabled, recordMode, showFriendOverlay, firstVisitDone, useH3Fog, unlockOnWalk });
  },

  reset: () => {
    set({ ...DEFAULTS });
    persist(DEFAULTS);
  },
}));
