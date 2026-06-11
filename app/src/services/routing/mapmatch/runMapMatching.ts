/**
 * runMapMatching — orchestrator that takes (originalPoints, viaPoints),
 * builds a Map Matching coord sequence (≤100 coords per call), calls
 * Mapbox per segment, stitches the results.
 *
 * Sprint 67 v236.
 */

import type { LngLat } from '../corridor/PolylineSampler';
import { buildMatchSequence, stitchMatchedSegments } from './coordSampling';
import { matchSegment } from './MapMatchingClient';
import type { MatchResult, ViaPoint } from './types';

export interface RunMatchArgs {
  originalPoints: LngLat[];
  viaPoints: ViaPoint[];
}

export interface RunMatchSuccess {
  ok: true;
  matchedPoints: LngLat[];
  /** Lowest leg confidence across all segments (0..1). */
  worstConfidence: number;
  durationMs: number;
  segmentCount: number;
}

export interface RunMatchFailure {
  ok: false;
  reason: 'no-match' | 'network' | 'timeout' | 'auth' | 'rate-limit' | 'invalid-input' | 'too-long';
  detail?: string;
  durationMs: number;
}

export type RunMatchResult = RunMatchSuccess | RunMatchFailure;

/** Hard upper bound — segmented matching beyond this is too costly + brittle. */
const MAX_SEGMENTS_PER_RUN = 4;

export async function runMapMatching(args: RunMatchArgs): Promise<RunMatchResult> {
  const t0 = Date.now();
  const build = buildMatchSequence({
    originalPoints: args.originalPoints,
    viaPoints: args.viaPoints,
  });

  if (build.segments.length === 0) {
    return {
      ok: false,
      reason: 'invalid-input',
      detail: 'too few originalPoints',
      durationMs: Date.now() - t0,
    };
  }
  if (build.segments.length > MAX_SEGMENTS_PER_RUN) {
    return {
      ok: false,
      reason: 'too-long',
      detail: `route requires ${build.segments.length} segments, max ${MAX_SEGMENTS_PER_RUN}`,
      durationMs: Date.now() - t0,
    };
  }

  // Sequential calls so we don't burst Mapbox.
  const matchedSegments: LngLat[][] = [];
  let worstConfidence = 1;
  for (const seg of build.segments) {
    const r: MatchResult = await matchSegment(seg);
    if (!r.ok) {
      return {
        ok: false,
        reason: r.reason,
        detail: r.detail,
        durationMs: Date.now() - t0,
      };
    }
    matchedSegments.push(r.matchedPoints);
    if (r.confidence < worstConfidence) worstConfidence = r.confidence;
  }

  const matched = stitchMatchedSegments(matchedSegments);
  if (matched.length < 2) {
    return {
      ok: false,
      reason: 'no-match',
      detail: 'stitched output empty',
      durationMs: Date.now() - t0,
    };
  }

  return {
    ok: true,
    matchedPoints: matched,
    worstConfidence,
    durationMs: Date.now() - t0,
    segmentCount: build.segments.length,
  };
}
