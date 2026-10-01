export interface SnapLabCassetteEntry {
  requestFingerprint: string;
  method: 'GET';
  sanitizedUrl: string;
  status: number;
  headers?: Record<string, string>;
  body: unknown;
  provenance: 'CAPTURED_REAL_RESPONSE' | 'DETERMINISTIC_TRANSPORT';
  capturedAt?: string | null;
}

export interface SnapLabTransportReceipt {
  requestFingerprint: string;
  method: string;
  sanitizedUrl: string;
  matched: boolean;
  status: number | null;
  startedAt: number;
  completedAt: number;
  provenance: SnapLabCassetteEntry['provenance'] | 'LIVE_MAPBOX_RESPONSE' | 'NO_CASSETTE_MATCH';
  endpoint?: 'matching' | 'directions';
  requestOrdinal?: number;
  responseCode?: string | null;
  errorCategory?: string | null;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function sanitizeSnapLabRequestUrl(input: string): string {
  const parsed = new URL(input);
  if (parsed.searchParams.has('access_token')) parsed.searchParams.set('access_token', '<redacted>');
  // Query order is part of the production builder identity; retaining it also
  // catches seemingly harmless construction drift that invalidates a capture.
  return `${parsed.origin}${parsed.pathname}${parsed.search}`;
}

export function snapLabRequestFingerprint(method: string, input: string): string {
  const sanitized = sanitizeSnapLabRequestUrl(input);
  return `snap-http-v1-${fnv1a(`${method.toUpperCase()} ${sanitized}`)}`;
}

function responseFromEntry(entry: SnapLabCassetteEntry): Response {
  const headers = new Map(Object.entries(entry.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: entry.status >= 200 && entry.status < 300,
    status: entry.status,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    json: async () => JSON.parse(JSON.stringify(entry.body)),
    text: async () => JSON.stringify(entry.body),
  } as unknown as Response;
}

/** Exact-identity offline HTTP boundary for deterministic or captured replay.
 * It never falls through to global fetch and therefore cannot issue a paid or
 * production network request. */
export function createSnapLabCassetteTransport(entries: SnapLabCassetteEntry[]): {
  fetch: typeof fetch;
  receipts: () => SnapLabTransportReceipt[];
} {
  const byFingerprint = new Map<string, SnapLabCassetteEntry>();
  for (const entry of entries) {
    if (entry.method !== 'GET') throw new Error('snap_lab_cassette_method_unsupported');
    if (entry.sanitizedUrl.includes('access_token=') && !entry.sanitizedUrl.includes('%3Credacted%3E')
      && !entry.sanitizedUrl.includes('<redacted>')) {
      throw new Error('snap_lab_cassette_contains_token');
    }
    if (snapLabRequestFingerprint(entry.method, entry.sanitizedUrl) !== entry.requestFingerprint) {
      throw new Error('snap_lab_cassette_identity_mismatch');
    }
    if (byFingerprint.has(entry.requestFingerprint)) throw new Error('snap_lab_cassette_duplicate_identity');
    byFingerprint.set(entry.requestFingerprint, entry);
  }
  const recorded: SnapLabTransportReceipt[] = [];
  const cassetteFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const startedAt = Date.now();
    const method = String(init?.method ?? 'GET').toUpperCase();
    const url = typeof input === 'string' ? input : input.toString();
    const sanitizedUrl = sanitizeSnapLabRequestUrl(url);
    const requestFingerprint = snapLabRequestFingerprint(method, url);
    if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const entry = byFingerprint.get(requestFingerprint);
    if (!entry || entry.method !== method || entry.sanitizedUrl !== sanitizedUrl) {
      recorded.push({
        requestFingerprint,
        method,
        sanitizedUrl,
        matched: false,
        status: null,
        startedAt,
        completedAt: Date.now(),
        provenance: 'NO_CASSETTE_MATCH',
      });
      throw new Error(`snap_lab_cassette_miss:${requestFingerprint}`);
    }
    recorded.push({
      requestFingerprint,
      method,
      sanitizedUrl,
      matched: true,
      status: entry.status,
      startedAt,
      completedAt: Date.now(),
      provenance: entry.provenance,
    });
    return responseFromEntry(entry);
  };
  return {
    fetch: cassetteFetch as typeof fetch,
    receipts: () => recorded.map(receipt => ({ ...receipt })),
  };
}

function liveEndpoint(url: URL): 'matching' | 'directions' {
  if (url.origin !== 'https://api.mapbox.com') throw new Error('snap_lab_live_origin_rejected');
  if (url.pathname.startsWith('/matching/v5/mapbox/walking/')) return 'matching';
  if (url.pathname.startsWith('/directions/v5/mapbox/walking/')) return 'directions';
  throw new Error('snap_lab_live_endpoint_rejected');
}

/**
 * Browser-side half of the real-response boundary. The URL is built by the
 * production routing code and deliberately retains its isolated placeholder
 * credential. The external browser orchestrator authorizes/counts the request,
 * substitutes the public token only for the network hop, captures the exact
 * response, then fulfils this request. No credential is exposed to Snap Lab
 * records, local storage, receipts, or exported evidence.
 */
export function createSnapLabLiveTransport(): {
  fetch: typeof fetch;
  receipts: () => SnapLabTransportReceipt[];
} {
  const recorded: SnapLabTransportReceipt[] = [];
  let ordinal = 0;
  const liveFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const startedAt = Date.now();
    const method = String(init?.method ?? 'GET').toUpperCase();
    const rawUrl = typeof input === 'string' ? input : input.toString();
    const parsed = new URL(rawUrl);
    const endpoint = liveEndpoint(parsed);
    if (method !== 'GET') throw new Error('snap_lab_live_method_rejected');
    if (parsed.searchParams.get('access_token') !== 'snap-lab-isolated-authority') {
      throw new Error('snap_lab_live_credential_boundary_rejected');
    }
    const requestOrdinal = ++ordinal;
    const sanitizedUrl = sanitizeSnapLabRequestUrl(rawUrl);
    const requestFingerprint = snapLabRequestFingerprint(method, rawUrl);
    try {
      const response = await globalThis.fetch(input, init);
      let responseCode: string | null = null;
      try {
        const body = await response.clone().json() as { code?: unknown };
        responseCode = typeof body?.code === 'string' ? body.code : null;
      } catch { /* a non-JSON response is still recorded by HTTP category */ }
      recorded.push({
        requestFingerprint,
        method,
        sanitizedUrl,
        matched: true,
        status: response.status,
        startedAt,
        completedAt: Date.now(),
        provenance: 'LIVE_MAPBOX_RESPONSE',
        endpoint,
        requestOrdinal,
        responseCode,
        errorCategory: response.ok ? null : `http-${response.status}`,
      });
      return response;
    } catch (error) {
      recorded.push({
        requestFingerprint,
        method,
        sanitizedUrl,
        matched: false,
        status: null,
        startedAt,
        completedAt: Date.now(),
        provenance: 'LIVE_MAPBOX_RESPONSE',
        endpoint,
        requestOrdinal,
        responseCode: null,
        errorCategory: error instanceof DOMException && error.name === 'AbortError'
          ? 'aborted'
          : 'network-error',
      });
      throw error;
    }
  };
  return {
    fetch: liveFetch as typeof fetch,
    receipts: () => recorded.map(receipt => ({ ...receipt })),
  };
}
