/**
 * Plant flow — feature configuration.
 *
 * Centralized tunables for the new plant flow (GPS lock → optional pin
 * drag → content → visibility → submit). NO hardcoded magic numbers in
 * the plant components.
 */

// ── GPS sampling ───────────────────────────────────────────────────────
export const GpsSamplingConfig = {
  /** Total sampling window before we consider position "locked".
   *  S5 (v0.2.6.4): 10→15. Cold-start GPS first fix on iOS can take
   *  5-15s on BestForNavigation accuracy. We need the window long
   *  enough to fit ≥2 readings even in the worst case. */
  windowSeconds: 15,
  /** Sample interval — iOS native location updates are usually ~1Hz. */
  sampleIntervalMs: 500,
  /**
   * Reject the plant entirely if the best accuracy reading after the
   * window is worse than this. Surfaces "signal too weak — move to
   * open sky" message instead of recording a garbage point.
   */
  rejectAccuracyAboveMeters: 15,
  /**
   * Sigma threshold (meters) — if the standard deviation of the 5s
   * sample window exceeds this, the GPS is considered "jumpy" and we
   * also reject. Catches multi-path bouncing in narrow streets.
   */
  rejectStdDevAboveMeters: 5,
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
  /** Initial selection in the visibility chip row. */
  defaultLevel: 'friends' as 'self' | 'friends' | 'public',
  /**
   * v0.2.6 MVP: 'public' option is hidden until content moderation
   * pipeline is ready. Toggle this to enable once moderation lands.
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
