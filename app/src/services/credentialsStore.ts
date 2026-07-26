/**
 * credentialsStore — Remember-me email + password 存储。
 *
 * O1 batch 28 (2026-07-26): 从 AsyncStorage 明文迁到 SecureStore 加密。
 * batch 24 (R23#1) 一度改成只存 email 不存 password (安全,但 UX 用户
 * 不接受: 每次开 app 要重新输密码)。用户明确要恢复,存到 iOS Keychain /
 * Android Keystore 硬件加密。
 *
 * - Native (iOS/Android): expo-secure-store (Keychain/Keystore, 硬件加密)
 * - Web (dev/QA only): localStorage (production build 不用 web)
 *
 * 契约:
 * - `save({email, password})`: rememberMe=true 时调
 * - `clear()`: rememberMe=false 时调 (toggle off → 下次不预填密码)
 * - `load()`: AuthScreen hydrate 时调,返回 { email?, password? }
 * - 所有错误静默 breadcrumb + fallback 空 (storage 失败不阻断登录)
 *
 * 与 tokenStore 完全对称模式。
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const CREDENTIALS_KEY = 'cairn_remember_me';

export interface StoredCredentials {
  email: string;
  password: string;
}

export async function saveCredentials(creds: StoredCredentials): Promise<void> {
  try {
    const payload = JSON.stringify(creds);
    if (Platform.OS !== 'web') {
      await SecureStore.setItemAsync(CREDENTIALS_KEY, payload, {
        // 首次开机未解锁前不 accessible (device passcode 后可读),
        // 与 tokenStore 保持 accessibility class 一致。iOS 冷启 AuthScreen
        // 是第一屏,若 device 从未解锁过 setItemAsync 会 throw,catch 静默。
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      });
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CREDENTIALS_KEY, payload);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[credentialsStore] save failed:', err);
  }
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  try {
    let raw: string | null = null;
    if (Platform.OS !== 'web') {
      raw = await SecureStore.getItemAsync(CREDENTIALS_KEY);
    } else if (typeof localStorage !== 'undefined') {
      raw = localStorage.getItem(CREDENTIALS_KEY);
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.email === 'string' && typeof parsed?.password === 'string') {
      return { email: parsed.email, password: parsed.password };
    }
    return null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[credentialsStore] load failed:', err);
    return null;
  }
}

export async function clearCredentials(): Promise<void> {
  try {
    if (Platform.OS !== 'web') {
      await SecureStore.deleteItemAsync(CREDENTIALS_KEY);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CREDENTIALS_KEY);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[credentialsStore] clear failed:', err);
  }
}
