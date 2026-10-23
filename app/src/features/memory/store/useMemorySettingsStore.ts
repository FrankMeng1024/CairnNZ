/**
 * Memory settings store — user preferences for memory unlocking.
 *
 * Keys:
 *   - passiveExplorationEnabled (default: true for a fresh install)
 *       Permits automatic exploration and encounter scanning outside an
 *       explicit Activity after the current disclosure and OS permission.
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
export const AUTOMATIC_EXPLORATION_DISCLOSURE_VERSION = 1;
export type PassiveBackgroundConsent = 'not-asked' | 'granted' | 'declined';

interface MemorySettings {
  passiveExplorationEnabled: boolean;
  memoryLocationTransitionRequired: boolean;
  automaticExplorationDisclosureVersion: number;
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
  // A fresh install starts with ordinary foreground exploration/encounters
  // enabled under the sign-up privacy disclosure. Actual capture still needs
  // foreground OS authorization. Hike/Run never consult this preference.
  passiveExplorationEnabled: true,
  memoryLocationTransitionRequired: false,
  automaticExplorationDisclosureVersion: AUTOMATIC_EXPLORATION_DISCLOSURE_VERSION,
  passiveBackgroundConsent: 'not-asked',
  passiveBackgroundConsentVersion: 0,
  passiveBackgroundEducationDismissed: false,
  firstVisitDone: false,
};

function persist(state: MemorySettings): void {
  void storage.setItem(STORAGE_KEY, JSON.stringify({
    ...state,
    passiveExplorationContractVersion: 6,
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
    const disclosureVersion = Number(parsed.automaticExplorationDisclosureVersion || 0)
      >= AUTOMATIC_EXPLORATION_DISCLOSURE_VERSION
      ? AUTOMATIC_EXPLORATION_DISCLOSURE_VERSION
      : 0;
    return {
      passiveExplorationEnabled: passiveEnabled,
      // A prior Memory-only ON is not informed consent for automatic Cairn
      // encounters. Keep its desired ON value, but fail closed until Settings
      // presents the broader disclosure. Existing explicit OFF remains OFF.
      memoryLocationTransitionRequired: passiveEnabled
        ? disclosureVersion < AUTOMATIC_EXPLORATION_DISCLOSURE_VERSION
        : Boolean(parsed.memoryLocationTransitionRequired ?? true),
      automaticExplorationDisclosureVersion: disclosureVersion,
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
      automaticExplorationDisclosureVersion,
      passiveBackgroundConsent,
      passiveBackgroundConsentVersion,
      passiveBackgroundEducationDismissed,
      firstVisitDone,
    } = get();
    persist({
      passiveExplorationEnabled,
      memoryLocationTransitionRequired,
      automaticExplorationDisclosureVersion,
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
