/**
 * editEnvelopeClient — fetch + cache the server-precomputed EditEnvelope.
 *
 * v224 — Sprint MVT-Envelope.
 *
 * Endpoint:
 *   GET /api/routes/:id/edit-envelope
 *     200 { envelope: EditEnvelope }   — ready to use
 *     202 { status: 'building' }       — server building, retry later
 *     404                              — route not found / no permission
 *     409                              — route too short to envelope
 *     500                              — server error
 *
 * Strategy:
 *   1. Try AsyncStorage cache first (per-route key, 7-day TTL).
 *   2. Fetch from server. If 200 → cache + return.
 *   3. If 202 → poll up to 3× with 1.5s backoff.
 *   4. Anything else → null. Caller falls back gracefully (endpoint-only).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authenticatedFetch } from '../apiService';
import {
  EditEnvelope,
  validateEnvelope,
} from './editEnvelopeTypes';

const CACHE_PREFIX = '@cairn:edit_envelope:v1:';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const POLL_MAX_TRIES = 4;
const POLL_DELAY_MS = 1500;

interface CachedEnvelope {
  cachedAt: number;
  envelope: EditEnvelope;
}

async function readCache(routeId: string | number): Promise<EditEnvelope | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + routeId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEnvelope;
    if (!parsed?.cachedAt || Date.now() - parsed.cachedAt > CACHE_TTL_MS) {
      // expired — remove and miss
      AsyncStorage.removeItem(CACHE_PREFIX + routeId).catch(() => undefined);
      return null;
    }
    return validateEnvelope(parsed.envelope);
  } catch {
    return null;
  }
}

async function writeCache(routeId: string | number, env: EditEnvelope) {
  try {
    const payload: CachedEnvelope = { cachedAt: Date.now(), envelope: env };
    await AsyncStorage.setItem(CACHE_PREFIX + routeId, JSON.stringify(payload));
  } catch {
    // ignore — cache best effort
  }
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export interface FetchEnvelopeResult {
  ok: boolean;
  envelope: EditEnvelope | null;
  source: 'cache' | 'server' | 'building-timeout' | 'error' | 'none';
  status?: number;
}

/**
 * Fetch envelope for a route, polling on 202 and falling back gracefully.
 */
export async function fetchEditEnvelope(
  routeId: string | number,
  opts?: { bypassCache?: boolean }
): Promise<FetchEnvelopeResult> {
  if (!opts?.bypassCache) {
    const cached = await readCache(routeId);
    if (cached) return { ok: true, envelope: cached, source: 'cache' };
  }

  for (let attempt = 0; attempt < POLL_MAX_TRIES; attempt++) {
    let res: Response;
    try {
      res = await authenticatedFetch(`/api/routes/${routeId}/edit-envelope`, {
        method: 'GET',
      });
    } catch {
      return { ok: false, envelope: null, source: 'error' };
    }

    if (res.status === 200) {
      try {
        const body = await res.json();
        const env = validateEnvelope(body?.envelope);
        if (env) {
          writeCache(routeId, env).catch(() => undefined);
          return { ok: true, envelope: env, source: 'server', status: 200 };
        }
        return { ok: false, envelope: null, source: 'error', status: 200 };
      } catch {
        return { ok: false, envelope: null, source: 'error', status: 200 };
      }
    }

    if (res.status === 202) {
      // building — wait and retry
      if (attempt < POLL_MAX_TRIES - 1) {
        await sleep(POLL_DELAY_MS);
        continue;
      }
      return {
        ok: false,
        envelope: null,
        source: 'building-timeout',
        status: 202,
      };
    }

    // 404 / 409 / 500 — give up
    return { ok: false, envelope: null, source: 'error', status: res.status };
  }

  return { ok: false, envelope: null, source: 'building-timeout' };
}

/**
 * Force regeneration on the server. Fire-and-forget — caller should
 * follow with fetchEditEnvelope to pick up the new build.
 */
export async function regenerateEditEnvelope(
  routeId: string | number,
): Promise<void> {
  try {
    await authenticatedFetch(`/api/routes/${routeId}/edit-envelope/regenerate`, {
      method: 'POST',
    });
    // Invalidate local cache so next fetch hits the server.
    await AsyncStorage.removeItem(CACHE_PREFIX + routeId).catch(() => undefined);
  } catch {
    // ignore
  }
}
