/**
 * Memory settings store — user preferences for memory unlocking.
 *
 * Keys:
 *   - passiveExplorationEnabled (default: false)
 *       Permits exploration outside an explicit Activity.
 *       Hike/Run Memory capture is always active and ignores this setting.
 *   - firstVisitDone (default: false)
 *       Set to true after the user dismisses the first-time hint.
 *
 * Persisted to AsyncStorage so settings survive restarts.
 */

import { create } from 'zustand';
import { storage } from '../../../store/storage';

const STORAGE_KEY = 'cairn:memorySettings:v2';

export const PASSIVE_BACKGROUND_CONSENT_VERSION = 1;
export type PassiveBackgroundConsent = 'not-asked' | 'granted' | 'declined';

interface MemorySettings {
  passiveExplorationEnabled: boolean;
  memoryLocationTransitionRequired: boolean;
  passiveBackgroundConsent: PassiveBackgroundConsent;
  passiveBackgroundConsentVersion: number;
  passiveBackgroundEducationDismissed: boolean;
  firstVisitDone: boolean;
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
  passiveExplorationEnabled: false,
  // The unified Memory lifecycle is never silently enabled for a device that
  // previously chose or inherited Off. One explicit transition is required.
  memoryLocationTransitionRequired: true,
  passiveBackgroundConsent: 'not-asked',
  passiveBackgroundConsentVersion: 0,
  passiveBackgroundEducationDismissed: false,
  firstVisitDone: false,
};

function persist(state: MemorySettings): void {
  void storage.setItem(STORAGE_KEY, JSON.stringify({
    ...state,
    passiveExplorationContractVersion: 5,
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
    const migratedToPassiveContract = Number(parsed.passiveExplorationContractVersion || 0) >= 1;
    const expandedBackgroundConsent = Number(parsed.passiveBackgroundConsentVersion || 0)
      >= PASSIVE_BACKGROUND_CONSENT_VERSION
      && parsed.passiveBackgroundConsent === 'granted';
    const passiveEnabled = migratedToPassiveContract
      ? Boolean(parsed.passiveExplorationEnabled
        ?? parsed.foregroundAutoUnlockEnabled
        ?? DEFAULTS.passiveExplorationEnabled)
      : false;
    return {
      passiveExplorationEnabled: passiveEnabled,
      memoryLocationTransitionRequired: passiveEnabled
        ? false
        : Boolean(parsed.memoryLocationTransitionRequired ?? true),
      // A prior foreground-only true is preserved for foreground use, but is
      // never treated as consent for lock/background collection.
      passiveBackgroundConsent: expandedBackgroundConsent ? 'granted' : 'not-asked',
      passiveBackgroundConsentVersion: expandedBackgroundConsent
        ? PASSIVE_BACKGROUND_CONSENT_VERSION
        : 0,
      passiveBackgroundEducationDismissed: expandedBackgroundConsent
        ? Boolean(parsed.passiveBackgroundEducationDismissed)
        : false,
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
    const {
      passiveExplorationEnabled,
      memoryLocationTransitionRequired,
      passiveBackgroundConsent,
      passiveBackgroundConsentVersion,
      passiveBackgroundEducationDismissed,
      firstVisitDone,
    } = get();
    persist({
      passiveExplorationEnabled,
      memoryLocationTransitionRequired,
      passiveBackgroundConsent,
      passiveBackgroundConsentVersion,
      passiveBackgroundEducationDismissed,
      firstVisitDone,
    });
  },

  reset: () => {
    set({ ...DEFAULTS });
    persist(DEFAULTS);
  },
}));
