/**
 * voiceService — TTS abstraction over expo-speech.
 *
 * Provides a stable API for the Running screen, route navigation,
 * and any future "tell the user something out loud" flows. Wraps
 * expo-speech so we can:
 *   - swap voice engines later (e.g. Cloud TTS) without rewriting
 *     consumers
 *   - hold a soft queue so two announcements don't overlap
 *   - respect a user-toggleable mute (Settings → "Voice guidance")
 *   - log every announcement via crashLogger.breadcrumb so we can
 *     debug "why didn't it speak?" complaints from telemetry
 *
 * Lazy-loads expo-speech so a build that lacks it doesn't crash —
 * the service degrades to silent no-ops.
 *
 * Dialects:
 *   - speakNearbyFlag(name, distanceM) — "Scenic flag, 30 metres ahead."
 *   - speakWeatherSummary(text) — pass-through, just speaks the string
 *   - speakRouteCue(text) — turn-by-turn fragment
 *   - speak(text, options) — generic escape hatch
 *
 * All consumers should go through this service, not import expo-speech
 * directly. Future OTA upgrades (rate, language, voice id) land here.
 */

import { crashLogger } from './crashLogger';

// ── Module state ─────────────────────────────────────────────────────────
let SpeechModule: typeof import('expo-speech') | null = null;
let muted = false;
let pendingId = 0;

async function loadSpeech(): Promise<typeof import('expo-speech') | null> {
  if (SpeechModule) return SpeechModule;
  try {
    // Lazy import: expo-speech is in package.json but if a build is
    // ever missing the native module we want to fail soft, not crash.
    SpeechModule = await import('expo-speech');
    return SpeechModule;
  } catch (err) {
    crashLogger.breadcrumb(`voice:loadSpeech-failed ${String(err).slice(0, 60)}`);
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────

export interface SpeakOptions {
  /** Speech rate, 0.5–1.5 (1.0 default) */
  rate?: number;
  /** Speech pitch, 0.5–1.5 (1.0 default) */
  pitch?: number;
  /** BCP-47 language code, e.g. "en-NZ" or "zh-CN" */
  language?: string;
  /** Cancel any current utterance before this one (default true) */
  interrupt?: boolean;
}

/**
 * Speak arbitrary text. Returns immediately; speech is async on the
 * native side. Logs the request via breadcrumb.
 */
export async function speak(text: string, options: SpeakOptions = {}): Promise<void> {
  if (muted) {
    crashLogger.breadcrumb(`voice:skip-muted "${text.slice(0, 40)}"`);
    return;
  }
  if (!text || !text.trim()) return;
  const id = ++pendingId;
  crashLogger.breadcrumb(`voice:speak#${id} "${text.slice(0, 40)}"`);
  const Speech = await loadSpeech();
  if (!Speech) return;
  try {
    if (options.interrupt !== false) {
      // Stop any current utterance so the new one starts cleanly.
      Speech.stop();
    }
    Speech.speak(text, {
      rate: options.rate ?? 1.0,
      pitch: options.pitch ?? 1.0,
      language: options.language,
      onDone: () => crashLogger.breadcrumb(`voice:done#${id}`),
      onError: (err) => crashLogger.breadcrumb(`voice:error#${id} ${String(err).slice(0, 60)}`),
    });
  } catch (err) {
    crashLogger.breadcrumb(`voice:throw#${id} ${String(err).slice(0, 60)}`);
  }
}

/**
 * Stop any in-flight speech immediately.
 */
export async function stop(): Promise<void> {
  const Speech = await loadSpeech();
  if (!Speech) return;
  try { Speech.stop(); } catch { /* ignore */ }
  crashLogger.breadcrumb('voice:stop');
}

/**
 * User-controlled mute. Persisted by the consumer (Settings store).
 * setMuted(true) doesn't stop a current utterance; call stop() if needed.
 */
export function setMuted(value: boolean): void {
  muted = value;
  crashLogger.breadcrumb(`voice:setMuted ${value}`);
}

export function isMuted(): boolean {
  return muted;
}

// ── Domain-specific announcers ───────────────────────────────────────────

/**
 * "Scenic flag, 30 metres ahead." Polishes distance presentation.
 */
export async function speakNearbyFlag(typeLabel: string, distanceM: number): Promise<void> {
  const dist =
    distanceM < 50 ? `${Math.round(distanceM)} metres ahead`
      : distanceM < 1000 ? `${Math.round(distanceM / 10) * 10} metres ahead`
        : `${(distanceM / 1000).toFixed(1)} kilometres ahead`;
  await speak(`${typeLabel} flag, ${dist}.`);
}

/**
 * Weather summary — pass-through; weather wording shaped by caller.
 */
export async function speakWeatherSummary(text: string): Promise<void> {
  await speak(text);
}

/**
 * Turn-by-turn cue. Lower interrupt cost than speakNearbyFlag — when
 * route navigation fires multiple cues in quick succession, only the
 * latest matters.
 */
export async function speakRouteCue(text: string): Promise<void> {
  await speak(text, { rate: 1.05 });
}

// ── Dev / smoke test ─────────────────────────────────────────────────────

/**
 * Dev-only smoke test — speaks a sample line. Used by a hidden button
 * in the Running screen to verify the TTS pipeline on a real device
 * without waiting for a real flag/weather event.
 */
export async function speakSmokeTest(): Promise<void> {
  await speak('Cairn voice guidance is online. Scenic flag, 30 metres ahead. Light rain expected this afternoon.');
}
