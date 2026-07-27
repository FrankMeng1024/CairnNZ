/**
 * purchasesService — RevenueCat integration.
 *
 * Wraps react-native-purchases to expose a minimal surface for the rest
 * of the app. All RevenueCat identifiers (entitlement, product IDs) are
 * defined here — nowhere else.
 *
 * Entitlement structure:
 *   "pro" — unlocks all Pro features
 *
 * Product IDs (match App Store Connect + RevenueCat dashboard):
 *   cairn_pro_monthly  — NZD $5.99/month
 *   cairn_pro_annual   — NZD $39.99/year
 *   cairn_founding_monthly — NZD $3.99/month (Founding Member locked price)
 *
 * Founding Member logic:
 *   - Registered before 2027-01-01 OR user_id <= 500
 *   - Gets 12 months free Pro automatically — managed via RC "Promotional"
 *     entitlement on the RevenueCat dashboard, not code.
 *   - After the 12 months, the locked price is offered (cairn_founding_monthly).
 */
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import { Platform } from 'react-native';

// Entitlement identifier — must match RevenueCat dashboard
export const ENTITLEMENT_PRO = 'pro';

// Product identifiers (App Store Connect)
export const PRODUCT_MONTHLY = 'cairn_pro_monthly';
export const PRODUCT_ANNUAL = 'cairn_pro_annual';
export const PRODUCT_FOUNDING_MONTHLY = 'cairn_founding_monthly';

let initialized = false;

/**
 * Initialize RevenueCat. Call once at app startup (App.tsx).
 * Safe to call multiple times — no-op after first call.
 */
export function initPurchases(apiKey: string, userId?: string): void {
  if (initialized) return;
  if (!apiKey) {
    console.warn('[purchases] No API key — RevenueCat not initialized');
    return;
  }
  if (__DEV__) {
    Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  }
  Purchases.configure({ apiKey });
  if (userId) {
    Purchases.logIn(userId).catch(e =>
      console.warn('[purchases] logIn failed:', e?.message)
    );
  }
  initialized = true;
}

/**
 * Log in / identify the user after authentication.
 * Call when the user signs in or after registration.
 */
export async function identifyUser(userId: string): Promise<void> {
  if (!initialized) return;
  try {
    await Purchases.logIn(String(userId));
  } catch (e: any) {
    console.warn('[purchases] identify failed:', e?.message);
  }
}

/**
 * Log out — restore anonymous ID.
 * Call on sign out.
 */
export async function logoutPurchases(): Promise<void> {
  if (!initialized) return;
  try {
    await Purchases.logOut();
  } catch (e: any) {
    console.warn('[purchases] logout failed:', e?.message);
  }
}

export interface SubscriptionStatus {
  isPro: boolean;
  activeProductId: string | null;
  isFoundingMember: boolean;
  /** true when the status could not be fetched (network/SDK error) — last-known values preserved by store */
  fetchError?: boolean;
}

/**
 * Fetch current subscription status.
 * Lightweight — uses RC's cached customer info, refreshes in background.
 */
export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  if (!initialized) {
    return { isPro: false, activeProductId: null, isFoundingMember: false };
  }
  try {
    const info = await Purchases.getCustomerInfo();
    const proEntitlement = info.entitlements.active[ENTITLEMENT_PRO];
    const isPro = !!proEntitlement;
    const activeProductId = proEntitlement?.productIdentifier ?? null;
    // Founding member: check for 'founding_member' entitlement tag set on RC dashboard
    const isFoundingMember = !!info.entitlements.active['founding_member'];
    return { isPro, activeProductId, isFoundingMember };
  } catch (e: any) {
    console.warn('[purchases] getSubscriptionStatus failed:', e?.message);
    return { isPro: false, activeProductId: null, isFoundingMember: false, fetchError: true };
  }
}

export type PurchaseResult =
  | { success: true; productId: string }
  | { success: false; cancelled: boolean; error: string };

/**
 * Purchase the monthly Pro subscription.
 */
export async function purchaseMonthly(): Promise<PurchaseResult> {
  return purchaseProduct(PRODUCT_MONTHLY);
}

/**
 * Purchase the annual Pro subscription.
 */
export async function purchaseAnnual(): Promise<PurchaseResult> {
  return purchaseProduct(PRODUCT_ANNUAL);
}

async function purchaseProduct(productId: string): Promise<PurchaseResult> {
  if (!initialized) {
    return { success: false, cancelled: false, error: 'Purchases not initialized.' };
  }
  try {
    const packages = await getOfferings();
    const pkg = packages.find(p => p.product.identifier === productId);
    if (!pkg) {
      return { success: false, cancelled: false, error: 'Product not found. Please try again.' };
    }
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    const isPro = !!customerInfo.entitlements.active[ENTITLEMENT_PRO];
    if (isPro) {
      return { success: true, productId };
    }
    return { success: false, cancelled: false, error: 'Purchase completed but subscription not activated. Contact support.' };
  } catch (e: any) {
    const cancelled = e?.userCancelled === true;
    if (cancelled) return { success: false, cancelled: true, error: '' };
    return { success: false, cancelled: false, error: e?.message || 'Purchase failed. Please try again.' };
  }
}

/**
 * Restore previous purchases (App Store requirement — must be accessible in UI).
 */
export async function restorePurchases(): Promise<SubscriptionStatus> {
  if (!initialized) {
    return { isPro: false, activeProductId: null, isFoundingMember: false };
  }
  try {
    const info = await Purchases.restorePurchases();
    const proEntitlement = info.entitlements.active[ENTITLEMENT_PRO];
    const isPro = !!proEntitlement;
    return {
      isPro,
      activeProductId: proEntitlement?.productIdentifier ?? null,
      isFoundingMember: !!info.entitlements.active['founding_member'],
    };
  } catch (e: any) {
    console.warn('[purchases] restore failed:', e?.message);
    return { isPro: false, activeProductId: null, isFoundingMember: false, fetchError: true };
  }
}

// ── Internal helper ────────────────────────────────────────────────────────

async function getOfferings() {
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  if (!current) return [];
  return current.availablePackages;
}
