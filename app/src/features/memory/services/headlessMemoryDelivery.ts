import { API_BASE_URL } from '../../../config/api';
import { getHeadlessTokenForOwner } from '../../../services/tokenStore';
import {
  listDurableMemoryEvidence,
  mergeDurableMemoryEvidence,
} from './memoryEvidenceJournal';

const HEADLESS_TIMEOUT_MS = 20_000;
const HEADLESS_POINT_LIMIT = 500;
const HEADLESS_RESPONSE_LIMIT_BYTES = 512 * 1024;

export type HeadlessMemoryDeliveryResult = {
  status: 'acknowledged' | 'nothing_to_push' | 'auth_unavailable' | 'authority_changed' | 'failed';
  pointCount: number;
  presenceCount: number;
  acquiredCount: number;
};

function result(
  status: HeadlessMemoryDeliveryResult['status'],
  pointCount = 0,
  presenceCount = 0,
  acquiredCount = 0,
): HeadlessMemoryDeliveryResult {
  return { status, pointCount, presenceCount, acquiredCount };
}

async function headlessFetch(
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; body: any }> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(`${API_BASE_URL}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        let parsed: any = null;
        if (typeof response.text === 'function') {
          const raw = await response.text();
          if (raw.length > HEADLESS_RESPONSE_LIMIT_BYTES) throw new Error('headless_response_too_large');
          try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
        } else {
          parsed = await response.json().catch(() => null);
        }
        return { ok: response.ok, body: parsed };
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('headless_request_timeout'));
        }, HEADLESS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Opportunistic native background delivery. The immutable evidence journal
 * remains crash authority; this function never writes the process-global
 * Memory store. It uses only an exact durable token-owner pair and a caller
 * supplied lease recheck, so a headless runtime cannot cross an account or
 * passive-lifecycle boundary.
 *
 * iOS may suspend or omit callbacks; a failed attempt leaves the journal for
 * normal foreground replay. Therefore this supports, but never promises,
 * locked-screen immediacy.
 */
export async function deliverHeadlessPassiveMemory(args: {
  ownerUserId: string;
  passiveEpoch: string;
  authorityIsCurrent: () => Promise<boolean>;
}): Promise<HeadlessMemoryDeliveryResult> {
  try {
    if (!await args.authorityIsCurrent()) return result('authority_changed');
    const events = (await listDurableMemoryEvidence(args.ownerUserId)).filter(event => (
      event.source === 'passive_real'
      && event.sourceSegmentId === args.passiveEpoch
    ));
    if (events.length === 0) return result('nothing_to_push');
    const merged = mergeDurableMemoryEvidence([], [], events);
    const points = merged.points.slice(-HEADLESS_POINT_LIMIT);
    const presence = merged.presenceWitnesses.slice(-HEADLESS_POINT_LIMIT);
    if (points.length === 0 && presence.length === 0) return result('nothing_to_push');
    if (!await args.authorityIsCurrent()) return result('authority_changed');
    const token = await getHeadlessTokenForOwner(args.ownerUserId);
    if (!token) return result('auth_unavailable', points.length, presence.length);
    if (!await args.authorityIsCurrent()) return result('authority_changed', points.length, presence.length);

    const upload = await headlessFetch('/api/memory/points', token, {
      points: points.map(point => ({
        lat: point.lat,
        lng: point.lng,
        ts: point.ts,
        cid: point.cid,
        evidence_source: point.evidenceSource,
        source_activity_client_id: point.sourceActivityClientId,
        source_segment_id: point.sourceSegmentId,
        horizontal_accuracy_m: point.horizontalAccuracyM,
        continuity_state: point.continuityState,
      })),
      presence_witnesses: presence.map(witness => ({
        cid: witness.cid,
        first_lat: witness.firstLat,
        first_lng: witness.firstLng,
        first_observed_at_ms: witness.firstObservedAtMs,
        lat: witness.lat,
        lng: witness.lng,
        observed_at_ms: witness.observedAtMs,
        evidence_source: witness.evidenceSource,
        source_activity_client_id: witness.sourceActivityClientId,
        source_segment_id: witness.sourceSegmentId,
        horizontal_accuracy_m: witness.horizontalAccuracyM,
        continuity_state: witness.continuityState,
      })),
    });
    if (!await args.authorityIsCurrent()) return result('authority_changed', points.length, presence.length);
    if (!upload.ok) return result('failed', points.length, presence.length);
    const uploadBody = upload.body;
    const pointEcho = Array.isArray(uploadBody?.points) ? uploadBody.points : [];
    const presenceEcho = Array.isArray(uploadBody?.presence_witnesses) ? uploadBody.presence_witnesses : [];
    const acknowledged = pointEcho.length === points.length
      && pointEcho.every((entry: any, index: number) => entry?.batch_index === index
        && entry?.cid === points[index].cid)
      && presenceEcho.length === presence.length
      && new Set(presenceEcho.map((entry: any) => String(entry?.cid ?? ''))).size === presence.length
      && presence.every(witness => presenceEcho.some((entry: any) => entry?.cid === witness.cid));
    if (!acknowledged) return result('failed', points.length, presence.length);
    if (!await args.authorityIsCurrent()) return result('authority_changed', points.length, presence.length);

    // Encounter delivery owns a separate durable queue and network request.
    // A Cairn API failure can therefore never turn a successful Memory ACK
    // into a retry (and a Memory failure cannot suppress encounter delivery).
    return result('acknowledged', points.length, presence.length, 0);
  } catch {
    return result('failed');
  }
}
