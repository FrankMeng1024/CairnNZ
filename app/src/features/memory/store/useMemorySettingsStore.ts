/**
 * Memory settings store — user preferences for memory unlocking.
 *
 * Keys:
 *   - foregroundAutoUnlockEnabled (default: true)
 *       App-foreground GPS continuously clears fog as user walks.
 *   - showFriendOverlay (default: true)
 *       Whether the Memory map shows friends' shared fog overlaid.
 *
 * Persisted to MMKV so settings survive restarts. Hydration runs on
 * app boot; until hydration completes, defaults apply.
 */

import { create } from 'zustand';
import { storage } from '../../../store/storage';

const STORAGE_KEY = 'cairn:memorySettings:v1';

export interface MemorySettings {
  foregroundAutoUnlockEnabled: boolean;
  showFriendOverlay: boolean;
}

interface MemorySettingsState extends MemorySettings {
  hydrated: boolean;
  /** Hydrate from AsyncStorage. Idempotent. Returns a Promise. */
  hydrate: () => Promise<void>;
  /** Set + persist a single field. */
  set: <K extends keyof MemorySettings>(key: K, value: MemorySettings[K]) => void;
  /** Reset to defaults (debug / settings → wipe). */
  reset: () => void;
}

const DEFAULTS: MemorySettings = {
  foregroundAutoUnlockEnabled: true,
  showFriendOverlay: true,
};

function persist(state: MemorySettings): void {
  // Fire-and-forget — storage swallows errors internally.
  void storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function tryLoad(): Promise<MemorySettings | null> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return {
      foregroundAutoUnlockEnabled: Boolean(parsed.foregroundAutoUnlockEnabled ?? DEFAULTS.foregroundAutoUnlockEnabled),
      showFriendOverlay: Boolean(parsed.showFriendOverlay ?? DEFAULTS.showFriendOverlay),
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
    const { foregroundAutoUnlockEnabled, showFriendOverlay } = get();
    persist({ foregroundAutoUnlockEnabled, showFriendOverlay });
  },

  reset: () => {
    set({ ...DEFAULTS });
    persist(DEFAULTS);
  },
}));
