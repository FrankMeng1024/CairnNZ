/**
 * Home visual feature switches.
 *
 * The approved static Sunny remains canonical. Ambient motion is an optional
 * layer that can be removed with the single production switch below.
 */
export const SUNNY_AMBIENT_MOTION_ENABLED = false;

export type SunnyMotionDevMode = 'static' | 'normal' | 'debug';

/**
 * DEV-only QA mode. Production ignores this value and uses normal amplitude
 * whenever SUNNY_AMBIENT_MOTION_ENABLED is true.
 *
 * Web QA may also override this without editing source:
 *   ?homeMotion=off | normal | debug
 */
export const SUNNY_MOTION_DEV_MODE: SunnyMotionDevMode = 'normal';

/** Debug uses the real motion channels at a visibly diagnostic amplitude. */
export const SUNNY_MOTION_DEBUG_MULTIPLIER = 5;
