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
/** v303: fog rendering pipeline. Default 'legacy' until users opt in to
 *  the native Metal SDF mode. Switching is live (no app restart). */
export type FogMode = 'legacy' | 'off' | 'sdf-soft' | 'sdf-sharp';

export interface MemorySettings {
  foregroundAutoUnlockEnabled: boolean;
  recordMode: RecordMode;
  showFriendOverlay: boolean;
  firstVisitDone: boolean;
  fogMode: FogMode;
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
  // v303 OTA 四修 P2: native binary 还没 build(7/1),默认 'legacy' 让
  // 用户冷启动直接看到 fog,不再走 SDF fallback 链(8-10s 后跳回 legacy)。
  // pill 上 SDF 三个 mode 已 disabled。7/1 build 完成后改回 'sdf-soft'。
  fogMode: 'legacy',
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
    const fogModeRaw = parsed.fogMode;
    // v303 OTA 四修 P2: SDF native 还没 build (7/1)。所有已经 persist
    // 'sdf-soft'/'sdf-sharp'/'off' 的用户强制改回 'legacy',避免 SDF
    // fallback 链卡 8-10s。7/1 native binary 上线后这条改回原逻辑。
    const fogMode: FogMode =
      fogModeRaw === 'legacy' ? 'legacy' : 'legacy';
    return {
      foregroundAutoUnlockEnabled: Boolean(parsed.foregroundAutoUnlockEnabled ?? DEFAULTS.foregroundAutoUnlockEnabled),
      recordMode,
      showFriendOverlay: Boolean(parsed.showFriendOverlay ?? DEFAULTS.showFriendOverlay),
      firstVisitDone: Boolean(parsed.firstVisitDone ?? DEFAULTS.firstVisitDone),
      fogMode,
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
    const { foregroundAutoUnlockEnabled, recordMode, showFriendOverlay, firstVisitDone, fogMode } = get();
    persist({ foregroundAutoUnlockEnabled, recordMode, showFriendOverlay, firstVisitDone, fogMode });
  },

  reset: () => {
    set({ ...DEFAULTS });
    persist(DEFAULTS);
  },
}));
