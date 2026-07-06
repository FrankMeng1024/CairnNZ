/**
 * Sprint 72 — Shared Playwright helpers.
 *
 * All specs import these to keep spec files focused on scenario intent.
 */
import type { Page } from '@playwright/test';

export const BASE = 'http://localhost:8081';

/** Read the crashLogger breadcrumb ring buffer exposed by web dev hook. */
export async function readBreadcrumbs(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const g = globalThis as unknown as { __cairnBreadcrumbs?: string[] };
    return g.__cairnBreadcrumbs ?? [];
  });
}

/** Wait until a breadcrumb matching `substring` appears (or timeout). */
export async function waitForBreadcrumb(
  page: Page,
  substring: string,
  timeoutMs = 8000
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bc = await readBreadcrumbs(page);
    const hit = bc.find(l => l.includes(substring));
    if (hit) return hit;
    await page.waitForTimeout(150);
  }
  return null;
}

/** Assert a breadcrumb matching substring has been emitted since page load. */
export async function expectBreadcrumb(page: Page, substring: string): Promise<void> {
  const found = await waitForBreadcrumb(page, substring, 8000);
  if (!found) {
    const all = await readBreadcrumbs(page);
    throw new Error(
      `Expected breadcrumb containing "${substring}". Got ${all.length} breadcrumbs:\n${all.slice(-30).join('\n')}`
    );
  }
}

/** Assert a breadcrumb does NOT appear within a given window. */
export async function expectNoBreadcrumb(
  page: Page,
  substring: string,
  windowMs = 3000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < windowMs) {
    const bc = await readBreadcrumbs(page);
    const hit = bc.find(l => l.includes(substring));
    if (hit) throw new Error(`Unexpected breadcrumb "${hit}"`);
    await page.waitForTimeout(200);
  }
}

/** Preload a JWT + optional logout marker into localStorage before boot. */
export async function seedAuthLocalStorage(
  page: Page,
  opts: { token?: string | null; logoutMarker?: boolean } = {}
): Promise<void> {
  await page.addInitScript((o: { token?: string | null; logoutMarker?: boolean }) => {
    if (o.token != null) {
      try { localStorage.setItem('cairn_jwt', o.token); } catch { /* ignore */ }
    } else {
      try { localStorage.removeItem('cairn_jwt'); } catch { /* ignore */ }
    }
    // Note: logout marker lives on AsyncStorage, which on web maps to
    // localStorage under the '@AsyncStorage:cairn_logout_marker' or plain
    // 'cairn_logout_marker' key depending on the storage adapter. We set
    // both to cover both adapters.
    if (o.logoutMarker) {
      try { localStorage.setItem('cairn_logout_marker', '1'); } catch { /* ignore */ }
      try { localStorage.setItem('@AsyncStorage:cairn_logout_marker', '1'); } catch { /* ignore */ }
    } else {
      try { localStorage.removeItem('cairn_logout_marker'); } catch { /* ignore */ }
      try { localStorage.removeItem('@AsyncStorage:cairn_logout_marker'); } catch { /* ignore */ }
    }
  }, opts);
}

/** Preload an unfinished bg session id into AsyncStorage web adapter. */
export async function seedActiveSession(page: Page, sessionId: string): Promise<void> {
  await page.addInitScript((sid: string) => {
    try { localStorage.setItem('cairn_bg_active_session_id', sid); } catch { /* ignore */ }
    try { localStorage.setItem('@AsyncStorage:cairn_bg_active_session_id', sid); } catch { /* ignore */ }
  }, sessionId);
}

/** Install a fetch interceptor so /api/auth/me returns a fake user or 401. */
export async function mockAuthMe(
  page: Page,
  behavior:
    | { mode: 'ok'; user: { id: string; name: string; email: string } }
    | { mode: '401_invalid' }
    | { mode: '401_transient' }
    | { mode: 'network_error' }
): Promise<void> {
  await page.addInitScript((b) => {
    const origFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request | URL).toString();
      if (url.includes('/api/auth/me')) {
        if (b.mode === 'network_error') throw new TypeError('Failed to fetch');
        if (b.mode === '401_invalid') {
          return new Response(JSON.stringify({ message: 'Session expired.', code: 'TOKEN_INVALID' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', 'X-Cairn-Auth-Invalid': 'true' },
          });
        }
        if (b.mode === '401_transient') {
          return new Response(JSON.stringify({ message: 'transient' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ user: (b as { user: unknown }).user }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return origFetch(input, init);
    };
  }, behavior);
}

/** Install a fetch interceptor for /api/auth/refresh. */
export async function mockAuthRefresh(
  page: Page,
  behavior:
    | { mode: 'ok'; newToken: string }
    | { mode: '401_invalid' }
    | { mode: 'network_error' }
): Promise<void> {
  await page.addInitScript((b) => {
    const origFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request | URL).toString();
      if (url.includes('/api/auth/refresh')) {
        if (b.mode === 'network_error') throw new TypeError('Failed to fetch');
        if (b.mode === '401_invalid') {
          return new Response(JSON.stringify({ message: 'expired', code: 'TOKEN_INVALID' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', 'X-Cairn-Auth-Invalid': 'true' },
          });
        }
        return new Response(JSON.stringify({ token: (b as { newToken: string }).newToken }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return origFetch(input, init);
    };
  }, behavior);
}

export async function goHome(page: Page): Promise<void> {
  await page.goto(BASE);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForLoadState('networkidle');
}
