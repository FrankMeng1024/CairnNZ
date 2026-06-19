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
    const { foregroundAutoUnlockEnabled, recordMode, showFriendOverlay, firstVisitDone } = get();
    persist({ foregroundAutoUnlockEnabled, recordMode, showFriendOverlay, firstVisitDone });
  },

  reset: () => {
    set({ ...DEFAULTS });
    persist(DEFAULTS);
  },
}));
