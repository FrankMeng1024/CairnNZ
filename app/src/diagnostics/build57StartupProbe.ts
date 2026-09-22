export type Build57StartupRecord = (
  phase: string,
  fields?: Record<string, unknown>,
) => boolean;

const MAX_ERROR_TEXT = 500;

export function diagnosticErrorFields(error: unknown): Record<string, unknown> {
  const candidate = error as { name?: unknown; message?: unknown; stack?: unknown } | null;
  const name = typeof candidate?.name === 'string' ? candidate.name : 'Error';
  const message = typeof candidate?.message === 'string'
    ? candidate.message
    : String(error ?? 'unknown error');
  const stack = typeof candidate?.stack === 'string'
    ? candidate.stack.split('\n').slice(0, 8).join('\n')
    : null;
  return {
    errorName: name.slice(0, 120),
    errorMessage: message.slice(0, MAX_ERROR_TEXT),
    errorStack: stack?.slice(0, 1_500) ?? null,
  };
}

export function diagnosticRequestDescriptor(
  input: unknown,
  init?: { method?: string },
): { method: string; origin: string; path: string } | null {
  const raw = typeof input === 'string'
    ? input
    : (input && typeof input === 'object' && 'url' in input
      ? String((input as { url?: unknown }).url ?? '')
      : '');
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const inputMethod = input && typeof input === 'object' && 'method' in input
      ? String((input as { method?: unknown }).method ?? '')
      : '';
    return {
      method: String(init?.method || inputMethod || 'GET').toUpperCase().slice(0, 16),
      origin: parsed.origin,
      // Deliberately omit query and fragment: they may contain auth or user data.
      path: parsed.pathname.slice(0, 240),
    };
  } catch {
    return null;
  }
}

export function installFirstBackendFetchProbe(
  record: Build57StartupRecord,
  apiBaseUrl: string,
): boolean {
  if (typeof globalThis.fetch !== 'function') return false;
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(apiBaseUrl).origin;
  } catch {
    return false;
  }

  const originalFetch = globalThis.fetch.bind(globalThis);
  let recorded = false;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const descriptor = diagnosticRequestDescriptor(input, init);
    if (recorded || descriptor?.origin !== expectedOrigin) {
      return originalFetch(input, init);
    }

    recorded = true;
    record('first_backend_request_start', descriptor);
    try {
      const response = await originalFetch(input, init);
      record('first_backend_request_result', {
        ...descriptor,
        ok: response.ok,
        status: response.status,
      });
      return response;
    } catch (error) {
      record('first_backend_request_error', {
        ...descriptor,
        ...diagnosticErrorFields(error),
      });
      throw error;
    }
  }) as typeof fetch;
  return true;
}

