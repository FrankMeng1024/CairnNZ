/**
 * iapService — Batch 6.8 In-App Purchase wrapper.
 *
 * Wraps react-native-purchases (RevenueCat SDK). RevenueCat bridges
 * StoreKit (iOS) + Google Play Billing (Android) under one API and
 * handles receipt validation server-side.
 *
 * Contract (client-side):
 *   1. On app boot (after login): call initialize() with the RevenueCat
 *      API key + a stable app-user-id (the Cairn user id).
 *   2. To show the paywall: call getOfferings() → renders packages.
 *   3. On subscribe: call purchasePackage(package) → returns entitlement.
 *   4. On restore: call restorePurchases().
 *   5. To gate a feature: call getEntitlement() → boolean.
 *
 * Product IDs are configured in RevenueCat dashboard, not hardcoded here.
 * See _review/asc-revenuecat-setup.md for the ASC + RC setup checklist.
 *
 * Batch 6.8 wiring caveats:
 *   - react-native-purchases is a NATIVE MODULE — requires EAS build.
 *     Until the build, initialize() logs a "SDK unavailable" breadcrumb
 *     and returns null. Feature-gating falls back to the current
 *     memory_subscription_limit = 5 free friends behavior.
 *   - REVENUECAT_API_KEY (public key) must be set in expo config /
 *     .env for each platform.
 *   - Server-side receipt validation is handled by RevenueCat webhooks
 *     to backend /api/iap/webhook (added in a follow-up batch).
 */
import { Platform } from 'react-native';
import { crashLogger } from './crashLogger';

const ENTITLEMENT_ID = 'memory_pro';

let purchasesModule: any = null;
let initialized = false;
// Sprint 6 round-9 review R9B6: track the currently-configured user so
// a user-switch on the same device correctly re-identifies with RevenueCat
// instead of leaving the SDK bound to the previous user.
let currentAppUserID: string | null = null;

async function tryLoadModule() {
  if (purchasesModule) return purchasesModule;
  try {
    // Lazy require so a build without the native module doesn't hard-fail
    // at import time. eslint disable safe here — the require is guarded
    // by try/catch and only pulls a peer-installed package.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    purchasesModule = require('react-native-purchases').default
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      || require('react-native-purchases');
    return purchasesModule;
  } catch {
    return null;
  }
}

export async function initializePurchases(userId: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const Purchases = await tryLoadModule();
  if (!Purchases) {
    crashLogger.breadcrumb('iap:sdk_unavailable — feature-gating in fallback mode');
    return false;
  }
  // Sprint 6 round-9 review R9B6 fix: if already initialized for a
  // DIFFERENT user, call Purchases.logIn(newUser) to re-identify. Pre-
  // fix, the early return `if (initialized) return true` left the SDK
  // bound to the first user forever; all subsequent B-user purchases
  // attributed to A's RC account, and Restore surfaced A's subs to B.
  if (initialized) {
    if (currentAppUserID === userId) return true;
    try {
      // Sprint 6 round-10 review R10B1 fix: capture prev BEFORE assign
      // so the breadcrumb actually shows the transition (was logging
      // from=NEW to=NEW because of assign-before-log ordering).
      const prev = currentAppUserID;
      await Purchases.logIn(userId);
      currentAppUserID = userId;
      crashLogger.breadcrumb(`iap:user_switched from=${prev ?? 'null'} to=${userId}`);
      return true;
    } catch (err: any) {
      crashLogger.breadcrumb(`iap:login_failed ${String(err?.message || err).slice(0, 80)}`);
      return false;
    }
  }
  const apiKey = Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
    : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  if (!apiKey) {
    crashLogger.breadcrumb('iap:api_key_missing');
    return false;
  }
  try {
    Purchases.configure({ apiKey, appUserID: userId });
    initialized = true;
    currentAppUserID = userId;
    crashLogger.breadcrumb(`iap:initialized user_id=${userId}`);
    return true;
  } catch (err: any) {
    crashLogger.breadcrumb(`iap:init_failed ${String(err?.message || err).slice(0, 80)}`);
    return false;
  }
}

// Sprint 6 round-9 review R9B6 + round-10 R10B2: called from
// useAppStore.logout() so the SDK stops attributing purchases to the
// just-signed-out user. R10B2 fix: also reset `initialized` so a
// subsequent sign-in triggers a full configure path (picks up any
// rotated API keys, matches the semantic "logOut clears everything").
export async function resetPurchases(): Promise<void> {
  const Purchases = await tryLoadModule();
  // Sprint 6 round-14 R14B10 companion: clear the entitlement cache
  // regardless of SDK state — pre-existing cache from user A must not
  // leak to user B who logs in next. Runs BEFORE the SDK logout in
  // case that throws.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { storage } = require('../store/storage');
    await storage.removeItem(ENTITLEMENT_CACHE_KEY);
  } catch { /* silent */ }
  if (!Purchases || !initialized) return;
  try {
    await Purchases.logOut();
    currentAppUserID = null;
    initialized = false;
    crashLogger.breadcrumb('iap:logged_out');
  } catch (err: any) {
    crashLogger.breadcrumb(`iap:logout_failed ${String(err?.message || err).slice(0, 80)}`);
  }
}

export interface OfferingPackage {
  identifier: string;
  priceString: string;
  packageType: string;
  raw: any;   // the underlying RC Package for purchasePackage
}

export async function getOfferings(): Promise<OfferingPackage[]> {
  const Purchases = await tryLoadModule();
  if (!Purchases || !initialized) return [];
  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings?.current;
    if (!current) return [];
    return (current.availablePackages || []).map((p: any) => ({
      identifier: p.identifier,
      priceString: p.product?.priceString || '',
      packageType: p.packageType || 'unknown',
      raw: p,
    }));
  } catch (err: any) {
    crashLogger.breadcrumb(`iap:offerings_failed ${String(err?.message || err).slice(0, 80)}`);
    return [];
  }
}

export async function purchasePackage(pkg: OfferingPackage): Promise<{
  success: boolean;
  cancelled?: boolean;
  hasEntitlement?: boolean;
  error?: string;
}> {
  const Purchases = await tryLoadModule();
  if (!Purchases || !initialized) return { success: false, error: 'sdk_unavailable' };
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg.raw);
    const hasEntitlement = !!customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
    return { success: true, hasEntitlement };
  } catch (err: any) {
    if (err?.userCancelled) return { success: false, cancelled: true };
    return { success: false, error: err?.message || 'purchase_failed' };
  }
}

export async function restorePurchases(): Promise<{ hasEntitlement: boolean }> {
  const Purchases = await tryLoadModule();
  if (!Purchases || !initialized) return { hasEntitlement: false };
  try {
    const customerInfo = await Purchases.restorePurchases();
    return { hasEntitlement: !!customerInfo?.entitlements?.active?.[ENTITLEMENT_ID] };
  } catch (err: any) {
    crashLogger.breadcrumb(`iap:restore_failed ${String(err?.message || err).slice(0, 80)}`);
    return { hasEntitlement: false };
  }
}

const ENTITLEMENT_CACHE_KEY = 'cairn_iap_entitlement_cache';
const ENTITLEMENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export async function hasProEntitlement(): Promise<boolean> {
  // Sprint 6 round-14 R14B10 fix: cache last-known entitlement to
  // AsyncStorage so an offline/uninitialized read doesn't false-negative
  // for a legitimate paying user. Airplane-mode / dead-zone hiking is
  // exactly this app's target scenario.
  const Purchases = await tryLoadModule();
  const readCache = async (): Promise<{ has: boolean; ts: number } | null> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { storage } = require('../store/storage');
      const raw = await storage.getItem(ENTITLEMENT_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.has !== 'boolean' || typeof parsed?.ts !== 'number') return null;
      return parsed;
    } catch {
      return null;
    }
  };
  const writeCache = async (has: boolean) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { storage } = require('../store/storage');
      await storage.setItem(ENTITLEMENT_CACHE_KEY, JSON.stringify({ has, ts: Date.now() }));
    } catch { /* silent */ }
  };
  if (!Purchases || !initialized) {
    // Not ready to check live — fall back to cached value if fresh.
    const cached = await readCache();
    if (cached && Date.now() - cached.ts < ENTITLEMENT_CACHE_TTL_MS) return cached.has;
    return false;
  }
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    const has = !!customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
    await writeCache(has); // refresh cache on successful check
    return has;
  } catch {
    // Offline / SDK error — return cached value if fresh, else false.
    const cached = await readCache();
    if (cached && Date.now() - cached.ts < ENTITLEMENT_CACHE_TTL_MS) return cached.has;
    return false;
  }
}
