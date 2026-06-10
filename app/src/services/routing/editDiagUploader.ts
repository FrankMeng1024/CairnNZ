/**
 * editDiagUploader — fire-and-forget POST of small JSON diagnostics to
 * the Cairn backend. Used while iterating on the Mapbox edit pipeline
 * so we can read real-device pipeline state without screenshots.
 *
 * Best-effort: failures swallowed. Async, never blocks edit flow.
 *
 * Endpoint: POST /api/edit-diag (1MB cap, 60/5min IP rate limit, 24h TTL).
 */
import { API_BASE_URL } from '../../config/api';

export function uploadEditDiag(kind: string, payload: Record<string, any>): void {
  // Fire-and-forget. We don't await — caller stays sync-fast.
  try {
    const url = `${API_BASE_URL}/api/edit-diag`;
    const body = JSON.stringify({
      kind,
      ts: Date.now(),
      ...payload,
    });
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => undefined);
  } catch {
    // never throw from a diag uploader
  }
}
