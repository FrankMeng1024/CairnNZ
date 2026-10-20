import { API_BASE_URL } from '../../../config/api';
import { getHeadlessTokenForOwner } from '../../../services/tokenStore';
import {
  listDurableMemoryEvidence,
  mergeDurableMemoryEvidence,
} from './memoryEvidenceJournal';

const HEADLESS_TIMEOUT_MS = 20_000;
const HEADLESS_POINT_LIMIT = 500;

export type HeadlessMemoryDeliveryResult = {
  status: 'acknowledged_and_discovered' | 'nothing_to_push' | 'auth_unavailable' | 'authority_changed' | 'failed';
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
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEADLESS_TIMEOUT_MS);
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
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
    const uploadBody = await upload.json().catch(() => null);
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

    const discovery = await headlessFetch('/api/cairn-memory/discover', token, {});
    if (!await args.authorityIsCurrent()) return result('authority_changed', points.length, presence.length);
    if (!discovery.ok) return result('failed', points.length, presence.length);
    const discoveryBody = await discovery.json().catch(() => null);
    const acquiredCount = Array.isArray(discoveryBody?.acquired) ? discoveryBody.acquired.length : 0;
    return result('acknowledged_and_discovered', points.length, presence.length, acquiredCount);
  } catch {
    return result('failed');
  }
}
