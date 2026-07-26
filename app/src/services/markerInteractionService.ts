/**
 * markerInteractionService — Like and Report a cairn marker.
 *
 * Flow:
 *   1. GET /api/markers/:id/interact-nonce  → { nonce }
 *   2. POST /api/markers/:id/vote           → { helpful_count, ... }
 *
 * Error handling:
 *   - 409 with existing_vote matching the requested type → treat as success
 *     (user already voted in a previous session; do not rollback optimistic UI)
 *   - 403 "Too far from marker" → throws with `code: 'TOO_FAR'`
 *   - 429 rate limit → throws with `code: 'RATE_LIMITED'`
 *   - 401 bad nonce → throws with `code: 'NONCE_INVALID'`
 *   - other non-2xx → throws with `code: 'SERVER_ERROR'`
 */
import { authenticatedFetch } from './apiService';

export class MarkerInteractionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'TOO_FAR'
      | 'RATE_LIMITED'
      | 'NONCE_INVALID'
      | 'INVALID_ID'
      | 'SERVER_ERROR',
  ) {
    super(message);
    this.name = 'MarkerInteractionError';
  }
}

/**
 * Returns true if the string represents a positive integer (server-assigned ID).
 * Local temp IDs are like "1721234567890-abc" — not valid for vote.
 */
function isServerMarkerId(id: string): boolean {
  const n = Number(id);
  return Number.isInteger(n) && n > 0;
}

async function fetchNonce(markerId: string): Promise<string> {
  const res = await authenticatedFetch(`/api/markers/${markerId}/interact-nonce`);
  if (!res.ok) {
    throw new MarkerInteractionError(
      `Failed to get nonce: ${res.status}`,
      'SERVER_ERROR',
    );
  }
  const data = await res.json();
  return data.nonce as string;
}

/**
 * Like a marker. Resolves on success or "already liked" (409).
 * Throws MarkerInteractionError on business-logic failures.
 */
export async function likeMarker(
  markerId: string,
  lat: number,
  lng: number,
  accuracy?: number | null,
): Promise<void> {
  if (!isServerMarkerId(markerId)) {
    throw new MarkerInteractionError(
      'Cannot like an unsynced marker',
      'INVALID_ID',
    );
  }

  const nonce = await fetchNonce(markerId);
  const body: Record<string, unknown> = {
    type: 'like',
    nonce,
    lat,
    lng,
    client_ts: Date.now(),
    client_op_id: generateOpId(),
  };
  if (accuracy != null) body.accuracy = accuracy;

  const res = await authenticatedFetch(`/api/markers/${markerId}/vote`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (res.ok) return;

  if (res.status === 409) {
    // Already voted — parse existing_vote. If it was a 'like', treat as success.
    try {
      const data = await res.json();
      if (data.existing_vote?.type === 'like') return; // idempotent success
    } catch { /* ignore parse error */ }
    // 409 with different vote type (user already reported) — still success,
    // the UI won't let them report again anyway.
    return;
  }

  await handleVoteError(res);
}

/**
 * Report a marker. Resolves on success or "already voted" (409).
 * @param reason 'fake_ad' | 'info_mismatch' | 'dislike'
 */
export async function reportMarker(
  markerId: string,
  reason: 'fake_ad' | 'info_mismatch' | 'dislike',
  lat: number,
  lng: number,
  accuracy?: number | null,
): Promise<void> {
  if (!isServerMarkerId(markerId)) {
    throw new MarkerInteractionError(
      'Cannot report an unsynced marker',
      'INVALID_ID',
    );
  }

  const nonce = await fetchNonce(markerId);
  const body: Record<string, unknown> = {
    type: 'report',
    reason,
    nonce,
    lat,
    lng,
    client_ts: Date.now(),
    client_op_id: generateOpId(),
  };
  if (accuracy != null) body.accuracy = accuracy;

  const res = await authenticatedFetch(`/api/markers/${markerId}/vote`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (res.ok) return;
  if (res.status === 409) return; // already voted — idempotent

  await handleVoteError(res);
}

async function handleVoteError(res: Response): Promise<never> {
  let message = `Vote failed: ${res.status}`;
  try {
    const data = await res.json();
    if (data.error) message = data.error;
  } catch { /* ignore */ }

  if (res.status === 403) {
    throw new MarkerInteractionError(message, 'TOO_FAR');
  }
  if (res.status === 429) {
    throw new MarkerInteractionError(message, 'RATE_LIMITED');
  }
  if (res.status === 401) {
    throw new MarkerInteractionError(message, 'NONCE_INVALID');
  }
  throw new MarkerInteractionError(message, 'SERVER_ERROR');
}

/** Lightweight random op ID for idempotency middleware. */
function generateOpId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
