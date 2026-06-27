/**
 * Plant flow — feature configuration.
 *
 * Centralized tunables for the new plant flow (GPS lock → optional pin
 * drag → content → visibility → submit). NO hardcoded magic numbers in
 * the plant components.
 */

// ── GPS sampling ───────────────────────────────────────────────────────
export const GpsSamplingConfig = {
  /** Total sampling window — v301: 5s with watcher-stream + active
   *  polling concurrently. iOS Core Location pushes ~1Hz, so 5s
   *  yields 5-10 independent readings. Weighted fusion across that
   *  many samples brings typical outdoor accuracy from raw 5-10m
   *  down to a reported fused σ in the 4-6m band (best case 3-5m
   *  on clear sky). User wait time is bounded — no >5s in any case. */
  windowSeconds: 5,
  /** Active poll interval. v301: 500→250ms. iOS may cache between
   *  calls, but lower interval better catches push-only emissions. */
  sampleIntervalMs: 250,
  /**
   * Drop any individual reading worse than this. v301: 30→25. We're
   * actively trying to converge to 3-5m, so noisy 25m+ readings
   * pollute the cluster.
   */
  rejectAccuracyAboveMeters: 25,
  /**
   * Sigma threshold (meters) — if the standard deviation of the
   * sample window exceeds this, the GPS is considered "jumpy" and
   * we also reject. v301: 8→6. Tighter to keep the fused estimate
   * clean.
   */
  rejectStdDevAboveMeters: 6,
} as const;

// ── Manual pin nudge ──────────────────────────────────────────────────
export const PinNudgeConfig = {
  /**
   * Maximum distance (meters) the user is allowed to drag the suggested
   * pin from the algorithmic position. Prevents accidental misuse where
   * the user drags 500m away.
   */
  maxNudgeMeters: 50,
  /**
   * Minimum zoom level required for nudging to be meaningful. Below
   * this, the pin would represent dozens of meters per pixel and
   * dragging is meaningless.
   */
  minZoomForNudge: 16,
} as const;

// ── Content limits ────────────────────────────────────────────────────
export const ContentConfig = {
  titleMaxChars: 30,
  textMaxChars: 200,
  voiceMaxSeconds: 30,
  /** Cairn must have at least one of: title, text, voice. */
  requireAtLeastOneContent: true,
} as const;

// ── Visibility default ────────────────────────────────────────────────
export const VisibilityConfig = {
  /** Initial selection in the visibility chip row.
   *  Sprint 68 STORY-00530 (Friend System v1 v4.U): default is 'friends'.
   *  Reasoning: v4 product binding — Friend is the social default. v1 UI
   *  exposes only Personal vs Friend (Public hidden, see enablePublicOption).
   *  Pre-Sprint 68 was 'self' (v299 user request). v1 supersedes that.
   */
  defaultLevel: 'friends' as 'self' | 'friends' | 'public',
  /**
   * Sprint 68 STORY-00530 (Friend System v1 v4 §11): 'public' option is
   * hidden in v1 UI. Backend also rejects POST permission='public' via the
   * Sprint 67 H1 enforcement (defense in depth). Keep this flag so future
   * versions (v1.1+) can re-enable Public once moderation lands.
   */
  enablePublicOption: false,
} as const;

export type PlantConfigBundle = {
  gps: typeof GpsSamplingConfig;
  pin: typeof PinNudgeConfig;
  content: typeof ContentConfig;
  visibility: typeof VisibilityConfig;
};

export function getPlantConfig(): PlantConfigBundle {
  return {
    gps: GpsSamplingConfig,
    pin: PinNudgeConfig,
    content: ContentConfig,
    visibility: VisibilityConfig,
  };
}
