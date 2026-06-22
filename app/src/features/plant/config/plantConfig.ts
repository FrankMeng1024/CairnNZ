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
   *  v300 N2: 15→10. With the wider acceptance threshold below, the
   *  early-exit kicks in within 1-2 polls in the common case; 10s is
   *  ample headroom for cold-start TTFF without holding the user on
   *  a black screen. The window is the worst-case ceiling, not the
   *  typical wait. */
  windowSeconds: 10,
  /** Sample interval — iOS native location updates are usually ~1Hz. */
  sampleIntervalMs: 500,
  /**
   * v300 N2: 15→30. Real-device user complaint was "15s remaining,
   * no GPS reading received, retry succeeds" — the actual reason
   * was indoor / urban-canyon accuracy hovering at 18-35m for the
   * full window, so the 15m gate kept rejecting every reading.
   *
   * 30m is still useful for plant: step 2 has a 50m manual pan
   * radius, so as long as the system lock is within ~30m the user
   * can drag the pin onto the real spot. Better to give them a
   * draggable pin than a permanent "no GPS" wall.
   */
  rejectAccuracyAboveMeters: 30,
  /**
   * Sigma threshold (meters) — if the standard deviation of the 5s
   * sample window exceeds this, the GPS is considered "jumpy" and we
   * also reject. Catches multi-path bouncing in narrow streets.
   *
   * v300 N2: 5→8. Slightly more permissive to match the relaxed
   * accuracy gate above — otherwise the std-dev check would become
   * the new bottleneck for users on weak signal.
   */
  rejectStdDevAboveMeters: 8,
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
   *  v299: 'self' (Just me) per user request — "默认是 just me". */
  defaultLevel: 'self' as 'self' | 'friends' | 'public',
  /**
   * v0.2.6 MVP: 'public' option is hidden until content moderation
   * pipeline is ready. Toggle this to enable once moderation lands.
   */
  enablePublicOption: true,
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
