/**
 * Voice memo service — v80 #45.
 *
 * Short voice clip attached to a marker, recorded once on plant
 * (optional) and played back from the marker detail sheet. Uses
 * `expo-av` Audio.Recording + Audio.Sound.
 *
 * v80 scope:
 *   • Local-only: clip is saved to FileSystem.documentDirectory/voice_memos/
 *   • URI persisted with the marker in AsyncStorage; survives app restart
 *   • NOT uploaded to backend (next iteration adds cloud sync)
 *
 * iOS audio session: app-level setAudioModeAsync({ allowsRecordingIOS:true })
 * is set transiently during recording, then reverted to playback (so
 * playback after recording routes to speaker not earpiece).
 *
 * Recording format: m4a / AAC / 64 kbps mono ≈ 40 KB per 5s clip.
 *
 * v80 review-fix #1: lazy require 'expo-file-system/legacy' (the
 *   default 'expo-file-system' import is @deprecated in 19.x and the
 *   moveAsync / makeDirectoryAsync helpers throw at runtime — silent
 *   fail because of try/catch).
 * v80 review-fix #2: setTimeout cleanup is keyed on the active timer,
 *   cleared on every entry path so successive recordings don't collide.
 * v80 review-fix #3: simple busy mutex — refuse to start recording or
 *   playback if another is already running. Prevents iOS audio-session
 *   thrash that produces undefined behaviour on AVAudioSession.
 * v80 review-fix #4: InterruptionModeIOS.DuckOthers — expo-av 16 maps
 *   the legacy numeric `2` to DuckOthers (NOT `1` as I originally wrote;
 *   `1` is DoNotMix in this version). Verified via type definitions.
 */
import { Platform } from 'react-native';
import { crashLogger } from './crashLogger';

const MAX_DURATION_MS = 5_000;

let activeRecording: any | null = null;
let activeStopTimer: ReturnType<typeof setTimeout> | null = null;
let activePlaybackSound: any | null = null;

function clearActiveTimer() {
  if (activeStopTimer) {
    clearTimeout(activeStopTimer);
    activeStopTimer = null;
  }
}

function isBusy(): boolean {
  return activeRecording != null || activePlaybackSound != null;
}

/**
 * Start a recording. Returns a cancel handle. Auto-stops at 5s.
 * Call `stop()` from the returned handle to finalize early; the resulting
 * URI + duration is delivered via the resolved promise.
 *
 * Throws if another recording or playback is already active (caller
 * must stop the existing operation first).
 */
export async function startRecording(): Promise<{
  stop: () => Promise<{ uri: string; durationMs: number } | null>;
  cancel: () => Promise<void>;
}> {
  if (isBusy()) {
    throw new Error('Audio busy — stop the current recording or playback first');
  }
  const { Audio, InterruptionModeIOS, InterruptionModeAndroid } = require('expo-av');

  // Permission
  const perm = await Audio.requestPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Microphone permission denied');
  }

  // Audio mode for recording. iOS requires allowsRecordingIOS true.
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    interruptionModeIOS: InterruptionModeIOS.DuckOthers,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    shouldDuckAndroid: true,
    staysActiveInBackground: false,
    playThroughEarpieceAndroid: false,
  });

  const recording = new Audio.Recording();
  await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.LOW_QUALITY);
  await recording.startAsync();
  activeRecording = recording;
  const startedAt = Date.now();
  crashLogger.breadcrumb('voiceMemo:recording-start');

  let resolveStop: ((v: { uri: string; durationMs: number } | null) => void) | null = null;
  const stopPromise = new Promise<{ uri: string; durationMs: number } | null>(r => { resolveStop = r; });

  const finalize = async (): Promise<{ uri: string; durationMs: number } | null> => {
    clearActiveTimer();
    const r = activeRecording;
    if (!r) return null;
    activeRecording = null;
    try {
      await r.stopAndUnloadAsync();
      const uri = r.getURI();
      const durationMs = Math.min(MAX_DURATION_MS, Date.now() - startedAt);
      // Restore playback-only mode so the next sound plays through speaker.
      try {
        const { Audio: A2, InterruptionModeIOS: IIOS, InterruptionModeAndroid: IAnd } = require('expo-av');
        await A2.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          interruptionModeIOS: IIOS.DuckOthers,
          interruptionModeAndroid: IAnd.DuckOthers,
          shouldDuckAndroid: true,
          staysActiveInBackground: true,
          playThroughEarpieceAndroid: false,
        });
      } catch { /* ignore */ }
      crashLogger.breadcrumb(`voiceMemo:recording-stop dur=${durationMs}ms uri=${uri ? 'ok' : 'null'}`);
      return uri ? { uri, durationMs } : null;
    } catch (err) {
      crashLogger.breadcrumb(`voiceMemo:recording-stop-err ${String(err).slice(0, 60)}`);
      return null;
    }
  };

  // Auto-stop at MAX_DURATION_MS.
  activeStopTimer = setTimeout(async () => {
    activeStopTimer = null;
    const result = await finalize();
    if (resolveStop) resolveStop(result);
  }, MAX_DURATION_MS);

  return {
    stop: async () => {
      clearActiveTimer();
      const result = await finalize();
      if (resolveStop) resolveStop(result);
      return result;
    },
    cancel: async () => {
      clearActiveTimer();
      const r = activeRecording;
      activeRecording = null;
      if (!r) return;
      try { await r.stopAndUnloadAsync(); } catch { /* ignore */ }
      crashLogger.breadcrumb('voiceMemo:recording-cancel');
      if (resolveStop) resolveStop(null);
    },
  };
}

/**
 * Play a previously-recorded memo by URI.
 * Returns a stop handle. Refuses if another recording is in progress.
 */
export async function playMemo(uri: string): Promise<{ stop: () => Promise<void> }> {
  if (activeRecording) {
    throw new Error('Cannot play while recording');
  }
  // Stop any prior playback first (single-stream policy).
  if (activePlaybackSound) {
    try { await activePlaybackSound.stopAsync(); } catch { /* ignore */ }
    try { await activePlaybackSound.unloadAsync(); } catch { /* ignore */ }
    activePlaybackSound = null;
  }
  const { Audio } = require('expo-av');
  const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
  activePlaybackSound = sound;
  crashLogger.breadcrumb('voiceMemo:play-start');
  // Auto-cleanup when done playing
  sound.setOnPlaybackStatusUpdate((status: any) => {
    if (status?.didJustFinish) {
      sound.unloadAsync().catch(() => {});
      if (activePlaybackSound === sound) activePlaybackSound = null;
      crashLogger.breadcrumb('voiceMemo:play-end');
    }
  });
  return {
    stop: async () => {
      try { await sound.stopAsync(); } catch { /* ignore */ }
      try { await sound.unloadAsync(); } catch { /* ignore */ }
      if (activePlaybackSound === sound) activePlaybackSound = null;
    },
  };
}

/**
 * Move a freshly-recorded clip from the temp recording dir to a stable
 * location keyed by markerId, so it survives app restarts and isn't
 * GC'd by the OS. Returns the new permanent URI.
 *
 * Falls back to returning the input URI if FileSystem isn't available.
 *
 * v80 review-fix: imports 'expo-file-system/legacy' explicitly. The
 * default 'expo-file-system' module deprecates these helpers in 19.x
 * and they throw at runtime (silently swallowed by try/catch).
 */
export async function persistMemo(tempUri: string, markerId: string): Promise<string> {
  try {
    const FileSystem = require('expo-file-system/legacy');
    const dir = `${FileSystem.documentDirectory}voice_memos/`;
    const dirInfo = await FileSystem.getInfoAsync(dir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    const ext = tempUri.split('.').pop() || 'm4a';
    const dest = `${dir}${markerId}.${ext}`;
    await FileSystem.moveAsync({ from: tempUri, to: dest });
    crashLogger.breadcrumb(`voiceMemo:persist id=${markerId.slice(-6)}`);
    return dest;
  } catch (err) {
    crashLogger.breadcrumb(`voiceMemo:persist-err ${String(err).slice(0, 60)}`);
    return tempUri;
  }
}

// Export Platform-checked status helper for UI
export function isVoiceMemoSupported(): boolean {
  // expo-av is in package.json + linked into the build; both iOS and Android supported.
  // Web fallback would need a different recorder — not relevant for our app shape.
  return Platform.OS === 'ios' || Platform.OS === 'android';
}
