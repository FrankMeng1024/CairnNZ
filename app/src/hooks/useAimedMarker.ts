/**
 * useAimedMarker — React hook that produces a stable aim-locked marker
 * id from continuous ARKit camera transform updates.
 *
 * Per cinematic-ar-rebuild.md §F.1 + V2.C1 + V2.C10:
 *   - 3D cone test (azimuth + pitch) via arAimDetector.detectAimedMarker
 *   - Hold-stable threshold (default 600ms) before commit
 *   - Distance gate (default 30m)
 *   - Returns ARUiState transitions: idle → aim-pending → aim-locked
 *
 * Caller passes ArFrame from UnityAROverlay's onArFrame callback
 * (camera + cairns each frame at ~10Hz). Hook tracks (a) "current best
 * candidate" and (b) "time we started looking at this candidate". When
 * stable for >= AimHoldMs, transitions to aim-locked.
 */
import { useEffect, useRef, useState } from 'react';
import { detectAimedMarker, type CairnPos } from '../services/arAimDetector';

export type ARUiState = 'idle' | 'aim-pending' | 'aim-locked';

export interface AimHookResult {
  uiState: ARUiState;
  /** When state==='aim-locked', this is the locked marker id. */
  lockedMarkerId: string | null;
  /** When state==='aim-pending' or 'aim-locked', current candidate. */
  candidateId: string | null;
  /** 3D distance to candidate (if any). */
  candidateDistM: number;
  /** Hold progress 0..1 in aim-pending (for UI hint pill). */
  holdProgress: number;
}

interface ArFrame {
  camera: { position: [number, number, number]; forward: [number, number, number] } | null;
  cairns: CairnPos[];
}

interface Options {
  /** OTA AimConeRad (default 0.087 ≈ 5°). */
  coneRad?: number;
  /** OTA AimHoldMs (default 600). */
  holdMs?: number;
  /** OTA ArInteractRangeM (default 30). */
  maxRangeM?: number;
  /** OTA LikeReportEnabled — if false, hook stays at 'idle'. */
  enabled?: boolean;
}

export function useAimedMarker(arFrame: ArFrame | null, options: Options = {}): AimHookResult {
  const coneRad = options.coneRad ?? 0.087;
  const holdMs = options.holdMs ?? 600;
  const maxRangeM = options.maxRangeM ?? 30;
  const enabled = options.enabled !== false;

  const [uiState, setUiState] = useState<ARUiState>('idle');
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [candidateDistM, setCandidateDistM] = useState<number>(Infinity);
  const [holdProgress, setHoldProgress] = useState<number>(0);

  const candidateRef = useRef<string | null>(null);
  const candidateSinceRef = useRef<number>(0);
  const lockedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !arFrame || !arFrame.camera || !arFrame.cairns) {
      // Reset
      candidateRef.current = null;
      candidateSinceRef.current = 0;
      lockedRef.current = null;
      setUiState('idle');
      setCandidateId(null);
      setCandidateDistM(Infinity);
      setHoldProgress(0);
      return;
    }
    const result = detectAimedMarker(arFrame.camera, arFrame.cairns, coneRad, maxRangeM);
    const now = Date.now();

    if (result.markerId == null) {
      // No candidate this frame — break aim.
      candidateRef.current = null;
      candidateSinceRef.current = 0;
      lockedRef.current = null;
      setUiState('idle');
      setCandidateId(null);
      setCandidateDistM(Infinity);
      setHoldProgress(0);
      return;
    }

    // Same candidate as before?
    if (candidateRef.current === result.markerId) {
      const heldMs = now - candidateSinceRef.current;
      if (lockedRef.current === result.markerId) {
        // Already locked
        setUiState('aim-locked');
        setHoldProgress(1);
      } else if (heldMs >= holdMs) {
        // Promote to locked
        lockedRef.current = result.markerId;
        setUiState('aim-locked');
        setHoldProgress(1);
      } else {
        setUiState('aim-pending');
        setHoldProgress(Math.min(1, heldMs / holdMs));
      }
    } else {
      // New candidate
      candidateRef.current = result.markerId;
      candidateSinceRef.current = now;
      lockedRef.current = null;
      setUiState('aim-pending');
      setHoldProgress(0);
    }
    setCandidateId(result.markerId);
    setCandidateDistM(result.dist);
  }, [arFrame, coneRad, holdMs, maxRangeM, enabled]);

  return {
    uiState,
    lockedMarkerId: uiState === 'aim-locked' ? candidateId : null,
    candidateId,
    candidateDistM,
    holdProgress,
  };
}
