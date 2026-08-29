import {
  migrateLegacyAppearancePreference,
  resolveEffectiveScenicTime,
  resolveScenicTimeOfDay,
  SUNRISE_DAY_OFFSET_MS,
  SUNSET_WINDOW_AFTER_MS,
  SUNSET_WINDOW_BEFORE_MS,
} from '../scenicTime';

describe('resolveScenicTimeOfDay', () => {
  const sunriseMs = new Date('2026-08-27T07:00:00+12:00').getTime();
  const sunsetMs = new Date('2026-08-27T18:00:00+12:00').getTime();

  it('keeps very early morning in night', () => {
    expect(resolveScenicTimeOfDay({
      nowMs: sunriseMs + SUNRISE_DAY_OFFSET_MS - 1,
      sunriseMs,
      sunsetMs,
    }).timeOfDay).toBe('night');
  });

  it('starts day 45 minutes after sunrise', () => {
    expect(resolveScenicTimeOfDay({
      nowMs: sunriseMs + SUNRISE_DAY_OFFSET_MS,
      sunriseMs,
      sunsetMs,
    }).timeOfDay).toBe('day');
  });

  it('starts sunset 75 minutes before sunset', () => {
    expect(resolveScenicTimeOfDay({
      nowMs: sunsetMs - SUNSET_WINDOW_BEFORE_MS,
      sunriseMs,
      sunsetMs,
    }).timeOfDay).toBe('sunset');
  });

  it('keeps the sunset state through the post-sunset window', () => {
    expect(resolveScenicTimeOfDay({
      nowMs: sunsetMs + SUNSET_WINDOW_AFTER_MS - 1,
      sunriseMs,
      sunsetMs,
    }).timeOfDay).toBe('sunset');
  });

  it('returns to night 40 minutes after sunset', () => {
    expect(resolveScenicTimeOfDay({
      nowMs: sunsetMs + SUNSET_WINDOW_AFTER_MS,
      sunriseMs,
      sunsetMs,
    }).timeOfDay).toBe('night');
  });

  it('lets an explicit override win', () => {
    const result = resolveScenicTimeOfDay({ nowMs: sunriseMs, sunriseMs, sunsetMs, override: 'sunset' });
    expect(result.timeOfDay).toBe('sunset');
    expect(result.source).toBe('override');
  });

  it('uses the documented local-time fallback when solar data is absent', () => {
    const localNoon = new Date(2026, 7, 27, 12, 0, 0).getTime();
    const localEvening = new Date(2026, 7, 27, 19, 0, 0).getTime();
    const localNight = new Date(2026, 7, 27, 22, 0, 0).getTime();
    expect(resolveScenicTimeOfDay({ nowMs: localNoon }).timeOfDay).toBe('day');
    expect(resolveScenicTimeOfDay({ nowMs: localEvening }).timeOfDay).toBe('sunset');
    expect(resolveScenicTimeOfDay({ nowMs: localNight }).timeOfDay).toBe('night');
  });
});

describe('resolveEffectiveScenicTime precedence', () => {
  const sunriseMs = new Date('2026-08-27T07:00:00+12:00').getTime();
  const sunsetMs = new Date('2026-08-27T18:00:00+12:00').getTime();
  const noonMs = new Date('2026-08-27T12:00:00+12:00').getTime();

  it.each(['day', 'sunset', 'night'] as const)('persists the %s Appearance override', appearance => {
    const result = resolveEffectiveScenicTime({ nowMs: noonMs, sunriseMs, sunsetMs, appearance });
    expect(result.timeOfDay).toBe(appearance);
    expect(result.source).toBe('appearance-override');
  });

  it('lets the Dev override beat persisted Appearance', () => {
    const result = resolveEffectiveScenicTime({
      nowMs: noonMs,
      sunriseMs,
      sunsetMs,
      appearance: 'sunset',
      developerOverride: 'night',
    });
    expect(result.timeOfDay).toBe('night');
    expect(result.source).toBe('dev-override');
    expect(result.autoTimeOfDay).toBe('day');
  });

  it('uses the astronomical resolver when Appearance is Auto', () => {
    const result = resolveEffectiveScenicTime({
      nowMs: sunsetMs - SUNSET_WINDOW_BEFORE_MS,
      sunriseMs,
      sunsetMs,
      appearance: 'auto',
    });
    expect(result.timeOfDay).toBe('sunset');
    expect(result.autoTimeOfDay).toBe('sunset');
    expect(result.source).toBe('astronomical');
  });

  it('reports a next transition after the same-day night boundary', () => {
    const result = resolveEffectiveScenicTime({
      nowMs: sunsetMs + SUNSET_WINDOW_AFTER_MS + 60_000,
      sunriseMs,
      sunsetMs,
      appearance: 'auto',
    });
    expect(result.nextTransitionMs).toBe(sunriseMs + SUNRISE_DAY_OFFSET_MS + 24 * 60 * 60 * 1000);
  });
});

describe('Appearance migration', () => {
  it('preserves the former explicit Scenery Time choice over legacy Light/Dark', () => {
    expect(migrateLegacyAppearancePreference({ appearance: 'light', sceneryTime: 'sunset' }))
      .toBe('sunset');
  });

  it('maps legacy Light and Dark into Day and Night', () => {
    expect(migrateLegacyAppearancePreference({ appearance: 'light', sceneryTime: undefined }))
      .toBe('day');
    expect(migrateLegacyAppearancePreference({ appearance: 'dark', sceneryTime: undefined }))
      .toBe('night');
  });
});
