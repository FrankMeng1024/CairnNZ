/**
 * useLikeReport — React hook that fetches + posts community state for a
 * specific marker. Per cinematic-ar-rebuild.md §F.4.
 *
 * Polls /community-state every LikeReportPollMs (default 8000ms) while
 * sheet is visible. Like uses 5s client-side undo toast (canon §一-4
 * §F.7 — request never fires if cancelled within 5s). Report uses
 * mandatory-confirm modal then immediate POST. Both go through
 * /api/markers/:id/vote with HMAC nonce + GPS body fields.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../config/api';

export type VoteType = 'like' | 'report';
export type ReportReason = 'fake_ad' | 'info_mismatch' | 'dislike';

export interface CommunityState {
  helpful_count: number;
  report_count: number;
  status: 'healthy' | 'suspicious' | 'hidden';
  user_vote: { type: VoteType; reason: ReportReason | null } | null;
}

export interface VoteUserPos {
  lat: number;
  lng: number;
  accuracy?: number | null;
}

interface UseLikeReport {
  state: CommunityState | null;
  loading: boolean;
  error: string | null;
  /** Schedule a like with 5s undo window. Returns a cancel fn (caller
   *  invokes from undo-toast onPress to abort before commit). */
  scheduleLike: (userPos: VoteUserPos, undoMs?: number) => () => void;
  /** Submit a report (no undo per canon). Returns the new state. */
  submitReport: (
    reason: ReportReason,
    userPos: VoteUserPos,
  ) => Promise<CommunityState | null>;
  /** Force re-poll. */
  refresh: () => void;
}

interface Options {
  /** OTA LikeReportPollMs (default 8000). */
  pollMs?: number;
  /** Auth token getter. */
  getAuthToken: () => string | null | Promise<string | null>;
  /** Server-side base URL override (test). */
  apiBase?: string;
}

export function useLikeReport(markerId: string | null, options: Options): UseLikeReport {
  const pollMs = options.pollMs ?? 8000;
  const apiBase = options.apiBase ?? API_BASE_URL;
  const [state, setState] = useState<CommunityState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancelLikeRef = useRef<(() => void) | null>(null);
  const pollHandleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchState = useCallback(async (): Promise<void> => {
    if (!markerId) {
      setState(null);
      return;
    }
    try {
      setLoading(true);
      const tok = await Promise.resolve(options.getAuthToken());
      const r = await fetch(`${apiBase}/api/markers/${markerId}/community-state`, {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      if (!r.ok) {
        if (r.status === 404) {
          setState(null);
          setError(null);
          return;
        }
        throw new Error(`HTTP ${r.status}`);
      }
      const j = (await r.json()) as CommunityState;
      setState(j);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, [markerId, apiBase, options]);

  // Poll while markerId is non-null.
  useEffect(() => {
    if (!markerId) {
      if (pollHandleRef.current) clearInterval(pollHandleRef.current);
      pollHandleRef.current = null;
      return;
    }
    fetchState();
    pollHandleRef.current = setInterval(fetchState, pollMs);
    return () => {
      if (pollHandleRef.current) clearInterval(pollHandleRef.current);
      pollHandleRef.current = null;
    };
  }, [markerId, pollMs, fetchState]);

  const issueNonce = useCallback(async (): Promise<string | null> => {
    if (!markerId) return null;
    try {
      const tok = await Promise.resolve(options.getAuthToken());
      const r = await fetch(`${apiBase}/api/markers/${markerId}/interact-nonce`, {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      if (!r.ok) return null;
      const j = await r.json();
      return j.nonce ?? null;
    } catch {
      return null;
    }
  }, [markerId, apiBase, options]);

  const postVote = useCallback(
    async (
      type: VoteType,
      userPos: VoteUserPos,
      reason: ReportReason | null,
    ): Promise<CommunityState | null> => {
      if (!markerId) return null;
      const nonce = await issueNonce();
      if (!nonce) {
        setError('nonce fetch failed');
        return null;
      }
      try {
        const tok = await Promise.resolve(options.getAuthToken());
        const body = {
          type,
          reason: reason ?? undefined,
          lat: userPos.lat,
          lng: userPos.lng,
          accuracy: userPos.accuracy ?? null,
          client_ts: Date.now(),
          nonce,
          client_op_id: cryptoRandomUuid(),
        };
        const r = await fetch(`${apiBase}/api/markers/${markerId}/vote`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
          },
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (r.ok) {
          // 200/201 — fresh vote
          setState(prev => ({
            helpful_count: j.helpful_count,
            report_count: j.report_count,
            status: j.status,
            user_vote: { type, reason },
          }));
          return {
            helpful_count: j.helpful_count,
            report_count: j.report_count,
            status: j.status,
            user_vote: { type, reason },
          };
        }
        if (r.status === 409 && j.existing_vote) {
          // Already voted — surface to UI; user_vote indicates canon-correct state
          setState({
            helpful_count: j.helpful_count ?? 0,
            report_count: j.report_count ?? 0,
            status: j.status ?? 'healthy',
            user_vote: j.existing_vote,
          });
          setError('already_voted');
          return null;
        }
        setError(j?.error ?? `HTTP ${r.status}`);
        return null;
      } catch (e: any) {
        setError(e?.message ?? 'post failed');
        return null;
      }
    },
    [markerId, apiBase, options, issueNonce],
  );

  const scheduleLike = useCallback(
    (userPos: VoteUserPos, undoMs = 5000): (() => void) => {
      // If a previous schedule is still pending, cancel it first.
      if (cancelLikeRef.current) cancelLikeRef.current();
      let cancelled = false;
      const handle = setTimeout(() => {
        if (cancelled) return;
        postVote('like', userPos, null);
      }, undoMs);
      const cancelFn = () => {
        cancelled = true;
        clearTimeout(handle);
        cancelLikeRef.current = null;
      };
      cancelLikeRef.current = cancelFn;
      return cancelFn;
    },
    [postVote],
  );

  const submitReport = useCallback(
    (reason: ReportReason, userPos: VoteUserPos) => postVote('report', userPos, reason),
    [postVote],
  );

  const refresh = useCallback(() => {
    fetchState();
  }, [fetchState]);

  return { state, loading, error, scheduleLike, submitReport, refresh };
}

// ── Helper: RFC4122 v4 (cheap polyfill — no crypto module dependency) ──
function cryptoRandomUuid(): string {
  // RN's crypto polyfill may not expose randomUUID; build manually.
  const rnd = () => Math.floor(Math.random() * 0xffff_ffff);
  const hex = (n: number, len: number) => n.toString(16).padStart(len, '0');
  const a = rnd();
  const b = rnd();
  const c = rnd() & 0x0fff_ffff | 0x4000_0000; // version 4
  const d = rnd() & 0x3fff_ffff | 0x8000_0000; // variant 1
  const e = rnd();
  const f = rnd();
  return (
    hex(a, 8) +
    '-' +
    hex(b >>> 16, 4) +
    '-' +
    hex(c >>> 16, 4) +
    '-' +
    hex(d >>> 16, 4) +
    '-' +
    hex(e, 8) +
    hex(f & 0xffff, 4)
  );
}
