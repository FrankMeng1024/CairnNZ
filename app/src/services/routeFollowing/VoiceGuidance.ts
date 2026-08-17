/**
 * VoiceGuidance — TTS wrapper for turn-by-turn instructions.
 *
 * Wraps expo-speech with:
 *   - a message queue (never overlap two utterances)
 *   - de-duplication (don't repeat the same phrase within N seconds)
 *   - a global mute switch (from useSettingsStore.voiceGuidance)
 *   - English-only phrases (app ships in English for the NZ market;
 *     memory rule: code + UI copy in English)
 *
 * The service is a singleton with no React coupling. Screens call
 * `voiceGuidance.announceTurn(...)` etc. — the service internally decides
 * whether to speak, and remembers what it just said.
 *
 * Web behaviour: expo-speech maps to the Web Speech API when available.
 * For headless Playwright runs, `window.__cairnVoice` is exposed so tests
 * can observe every attempted utterance regardless of whether the browser
 * actually spoke it out loud.
 */

import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import type { TurnDirection } from './RouteFollower';

// ── Types ──────────────────────────────────────────────────────────────────

export type VoiceMessageKind =
  | 'turn-ahead'      // "In 200 meters, turn left"
  | 'turn-now'        // "Turn left now"
  | 'off-route'       // "You are off route"
  | 'back-on-route'   // "Back on route"
  | 'waypoint'        // "Approaching waypoint: X"
  | 'route-complete'; // "Route complete"

export interface VoiceMessage {
  kind: VoiceMessageKind;
  /** English phrase to speak. */
  phrase: string;
  /** De-dup key: same key within `minRepeatMs` collapses. */
  dedupKey: string;
  /** Minimum ms between repeats of the same dedupKey (default per-kind). */
  minRepeatMs?: number;
}

interface VoiceGuidanceOptions {
  /** Global mute — when false, all speak calls are no-ops. */
  enabled: boolean;
  /** Voice language tag (default 'en-US'). */
  language?: string;
  /** Speaking rate (expo-speech uses ~1.0 default; 0.9 is a hair slower & clearer). */
  rate?: number;
  /** True when the user prefers imperial units (yards + miles); false = metric. */
  imperial?: boolean;
}

// ── Debounce defaults per message kind ─────────────────────────────────────

const DEFAULT_REPEAT_MS: Record<VoiceMessageKind, number> = {
  'turn-ahead': 15000,      // don't re-announce the same turn within 15s
  'turn-now': 8000,
  'off-route': 20000,       // don't nag every second when off route
  'back-on-route': 20000,
  'waypoint': 30000,
  'route-complete': 60000,
};

// ── Phrase builders (English) ──────────────────────────────────────────────

/**
 * Format a distance for speech, respecting the user's unit preference.
 *
 * Below the nearest-mile / nearest-km threshold we speak the smaller unit
 * (meters / yards) rounded to a friendly value. Above the threshold we speak
 * the larger unit with one decimal.
 *
 * imperial=true → yards + miles (yards ~= meters × 1.0936; miles = meters / 1609.344)
 * imperial=false → meters + kilometers
 */
function fmtDistance(m: number, imperial: boolean): string {
  if (imperial) {
    // Below 1 mile: yards
    if (m < 1609.344) {
      const yd = Math.max(10, Math.round((m * 1.0936) / 10) * 10);
      return `${yd} yards`;
    }
    const mi = m / 1609.344;
    return `${mi.toFixed(1)} miles`;
  }
  if (m < 1000) {
    const rounded = Math.max(10, Math.round(m / 10) * 10);
    return `${rounded} meters`;
  }
  const km = m / 1000;
  return `${km.toFixed(1)} kilometers`;
}

function turnWord(dir: TurnDirection): string {
  switch (dir) {
    case 'left': return 'turn left';
    case 'right': return 'turn right';
    case 'sharp-left': return 'sharp left';
    case 'sharp-right': return 'sharp right';
    case 'u-turn': return 'make a u-turn';
    case 'straight': return 'continue straight';
  }
}

export function buildTurnAheadPhrase(dir: TurnDirection, distanceM: number, imperial: boolean): string {
  return `In ${fmtDistance(distanceM, imperial)}, ${turnWord(dir)}.`;
}

export function buildTurnNowPhrase(dir: TurnDirection): string {
  const word = turnWord(dir);
  const w = word[0].toUpperCase() + word.slice(1);
  return `${w} now.`;
}

export function buildWaypointPhrase(label: string): string {
  return `Approaching ${label}.`;
}

export const PHRASE_OFF_ROUTE = 'You are off route.';
export const PHRASE_BACK_ON_ROUTE = 'Back on route.';
export const PHRASE_ROUTE_COMPLETE = 'Route complete.';

// ── Service singleton ──────────────────────────────────────────────────────

class VoiceGuidanceService {
  private opts: VoiceGuidanceOptions = { enabled: true, language: 'en-US', rate: 0.95, imperial: false };
  private lastSpokenAt: Map<string, number> = new Map();
  private speaking = false;
  private queue: VoiceMessage[] = [];
  /** Test observability: every attempted speak is recorded here (not gated by dedup). */
  public readonly attempts: Array<{ ts: number; kind: VoiceMessageKind; phrase: string; spoken: boolean; reason?: string }> = [];

  configure(opts: Partial<VoiceGuidanceOptions>) {
    this.opts = { ...this.opts, ...opts };
  }

  /** Cancel any pending or in-flight utterance. Called when tracking stops. */
  reset() {
    this.queue = [];
    this.speaking = false;
    this.lastSpokenAt.clear();
    // Fire and forget — Speech.stop is safe on all platforms.
    try { Speech.stop(); } catch { /* noop */ }
  }

  /** Enqueue a message. Returns true if it will be spoken (subject to platform TTS). */
  enqueue(msg: VoiceMessage): boolean {
    const now = Date.now();
    const record = (spoken: boolean, reason?: string) => {
      this.attempts.push({ ts: now, kind: msg.kind, phrase: msg.phrase, spoken, reason });
      // Keep attempts bounded so long sessions don't grow unbounded.
      if (this.attempts.length > 200) this.attempts.splice(0, this.attempts.length - 200);
    };

    if (!this.opts.enabled) {
      record(false, 'disabled');
      return false;
    }
    const minRepeat = msg.minRepeatMs ?? DEFAULT_REPEAT_MS[msg.kind];
    const lastAt = this.lastSpokenAt.get(msg.dedupKey);
    if (lastAt !== undefined && now - lastAt < minRepeat) {
      record(false, 'debounced');
      return false;
    }
    this.lastSpokenAt.set(msg.dedupKey, now);
    this.queue.push(msg);
    record(true);
    this.drain();
    return true;
  }

  private drain() {
    if (this.speaking) return;
    const next = this.queue.shift();
    if (!next) return;
    this.speaking = true;
    const done = () => {
      this.speaking = false;
      this.drain();
    };
    try {
      Speech.speak(next.phrase, {
        language: this.opts.language,
        rate: this.opts.rate,
        onDone: done,
        onStopped: done,
        onError: done,
      });
    } catch (e) {
      // Some browsers throw synchronously if speechSynthesis is not user-gestured.
      // Fail closed so we don't wedge the queue.
      done();
    }
  }

  // ── Convenience helpers per kind ─────────────────────────────────────────

  announceTurnAhead(dir: TurnDirection, distanceM: number, turnKey: string) {
    // Bucket distance into 500/300/100/50m announcements so we don't
    // fire on every GPS tick as distance drops.
    const bucket = distanceBucket(distanceM);
    if (bucket == null) return false;
    return this.enqueue({
      kind: 'turn-ahead',
      phrase: buildTurnAheadPhrase(dir, bucket, !!this.opts.imperial),
      dedupKey: `${turnKey}:${bucket}`,
    });
  }

  announceTurnNow(dir: TurnDirection, turnKey: string) {
    return this.enqueue({
      kind: 'turn-now',
      phrase: buildTurnNowPhrase(dir),
      dedupKey: `${turnKey}:now`,
    });
  }

  announceOffRoute() {
    return this.enqueue({
      kind: 'off-route',
      phrase: PHRASE_OFF_ROUTE,
      dedupKey: 'off-route',
    });
  }

  announceBackOnRoute() {
    return this.enqueue({
      kind: 'back-on-route',
      phrase: PHRASE_BACK_ON_ROUTE,
      dedupKey: 'back-on-route',
    });
  }

  announceWaypoint(label: string, waypointId: string) {
    return this.enqueue({
      kind: 'waypoint',
      phrase: buildWaypointPhrase(label),
      dedupKey: `wp:${waypointId}`,
    });
  }

  announceRouteComplete() {
    return this.enqueue({
      kind: 'route-complete',
      phrase: PHRASE_ROUTE_COMPLETE,
      dedupKey: 'route-complete',
    });
  }
}

/**
 * Bucket a raw distance to the next announcement threshold. Returns null
 * when we shouldn't announce yet (too far, or already past all thresholds).
 * Thresholds: 500 / 300 / 100 / 50 meters ahead.
 */
export function distanceBucket(m: number): number | null {
  if (m >= 550) return null;      // don't announce yet
  if (m >= 400) return 500;
  if (m >= 250) return 300;
  if (m >= 80) return 100;
  if (m >= 40) return 50;
  return null;                    // "turn now" takes over below 40m
}

// ── Singleton export ───────────────────────────────────────────────────────

export const voiceGuidance = new VoiceGuidanceService();

// Test hook — expose on web only so Playwright can inspect what would speak.
if (Platform.OS === 'web' && typeof globalThis !== 'undefined') {
  (globalThis as any).__cairnVoice = voiceGuidance;
}
