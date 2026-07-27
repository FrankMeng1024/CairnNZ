/**
 * useSubscriptionStore — global subscription / entitlement state.
 *
 * Wraps purchasesService so the rest of the app can reactively check
 * `isPro` without calling RevenueCat directly.
 *
 * Usage:
 *   const isPro = useSubscriptionStore(s => s.isPro);
 *   const { purchaseMonthly } = useSubscriptionStore.getState();
 */
import { create } from 'zustand';
import {
  getSubscriptionStatus,
  identifyUser,
  logoutPurchases,
  purchaseMonthly,
  purchaseAnnual,
  restorePurchases,
  type PurchaseResult,
  type SubscriptionStatus,
} from '../services/purchasesService';

interface SubscriptionStore {
  /** Whether the current user has an active Pro entitlement */
  isPro: boolean;
  /** Whether the user has the founding_member entitlement */
  isFoundingMember: boolean;
  /** Product ID of the active subscription, or null */
  activeProductId: string | null;
  /** True while any purchase / restore operation is in flight */
  purchasing: boolean;
  /** True after the first successful status check */
  hydrated: boolean;

  /** Load current status from RevenueCat (cached, fast) */
  hydrate: () => Promise<void>;
  /** Call after user logs in */
  onUserLogin: (userId: string) => Promise<void>;
  /** Call after user logs out */
  onUserLogout: () => Promise<void>;
  /** Start monthly subscription */
  buyMonthly: () => Promise<PurchaseResult>;
  /** Start annual subscription */
  buyAnnual: () => Promise<PurchaseResult>;
  /** Restore previous purchases */
  restore: () => Promise<SubscriptionStatus>;
}

export const useSubscriptionStore = create<SubscriptionStore>((set, get) => ({
  isPro: false,
  isFoundingMember: false,
  activeProductId: null,
  purchasing: false,
  hydrated: false,

  hydrate: async () => {
    const status = await getSubscriptionStatus();
    // On network/SDK error, preserve last-known subscription state — do not overwrite Pro=true with false.
    if (!status.fetchError) {
      set({
        isPro: status.isPro,
        isFoundingMember: status.isFoundingMember,
        activeProductId: status.activeProductId,
      });
    }
    set({ hydrated: true });
  },

  onUserLogin: async (userId) => {
    await identifyUser(userId);
    await get().hydrate();
  },

  onUserLogout: async () => {
    await logoutPurchases();
    set({ isPro: false, isFoundingMember: false, activeProductId: null });
  },

  buyMonthly: async () => {
    set({ purchasing: true });
    const result = await purchaseMonthly();
    if (result.success) {
      await get().hydrate();
    }
    set({ purchasing: false });
    return result;
  },

  buyAnnual: async () => {
    set({ purchasing: true });
    const result = await purchaseAnnual();
    if (result.success) {
      await get().hydrate();
    }
    set({ purchasing: false });
    return result;
  },

  restore: async () => {
    set({ purchasing: true });
    try {
      const status = await restorePurchases();
      set({
        isPro: status.isPro,
        isFoundingMember: status.isFoundingMember,
        activeProductId: status.activeProductId,
      });
      return status;
    } catch (e: any) {
      console.warn('[subscription] restore failed:', e?.message);
      return { isPro: false, activeProductId: null, isFoundingMember: false };
    } finally {
      set({ purchasing: false });
    }
  },
}));
