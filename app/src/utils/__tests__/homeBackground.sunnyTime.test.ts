import {
  getCloudyReviewBackground,
  getHomeBackground,
  getWeatherReviewBackground,
  resolveVariant,
} from '../homeBackground';
import { resolveEffectiveScenicTime } from '../scenicTime';

describe('Sunny three-time background mapping', () => {
  const sunriseMs = new Date(2026, 7, 27, 6, 30).getTime();
  const sunsetMs = new Date(2026, 7, 27, 18, 0).getTime();

  it('resolves all three Sunny scenic keys', () => {
    expect(resolveVariant('sunny', new Date(2026, 7, 27, 12, 0).getTime(), undefined, sunriseMs, sunsetMs))
      .toBe('sunny-day');
    expect(resolveVariant('sunny', new Date(2026, 7, 27, 17, 0).getTime(), undefined, sunriseMs, sunsetMs))
      .toBe('sunny-sunset');
    expect(resolveVariant('sunny', new Date(2026, 7, 27, 21, 0).getTime(), undefined, sunriseMs, sunsetMs))
      .toBe('sunny-night');
  });

  it('maps explicit states to distinct approved asset identifiers', () => {
    expect(getHomeBackground('sunny', Date.now(), 'day', 'home').assetId)
      .toBe('sunny-day-final-micro-3x.jpg');
    expect(getHomeBackground('sunny', Date.now(), 'sunset', 'home').assetId)
      .toBe('sunny-evening-final-micro-3x.jpg');
    expect(getHomeBackground('sunny', Date.now(), 'night', 'home').assetId)
      .toBe('sunny-night-star-micro-v2-3x.jpg');
  });

  it('registers the three Sunny worlds to one overscanned geometry system', () => {
    const day = getHomeBackground('sunny', Date.now(), 'day', 'home');
    const sunset = getHomeBackground('sunny', Date.now(), 'sunset', 'home');
    const night = getHomeBackground('sunny', Date.now(), 'night', 'home');
    expect(day.backgroundScale).toBe(1.04);
    expect(sunset.backgroundScale).toBe(day.backgroundScale);
    expect(night.backgroundScale).toBe(day.backgroundScale);
    expect(sunset.backgroundOffsetYPct).toBeGreaterThan(day.backgroundOffsetYPct);
    expect(night.backgroundOffsetYPct).toBeLessThan(day.backgroundOffsetYPct);
  });

  it('does not add Sunset variants to the frozen non-Sunny family', () => {
    expect(resolveVariant('rain', Date.now(), 'sunset')).toBe('rain-day');
    expect(resolveVariant('cloudy', Date.now(), 'sunset')).toBe('cloudy-day');
  });

  it.each(['day', 'sunset', 'night'] as const)(
    'keeps experimental Cloudy %s isolated on the Dev review mapping',
    timeOfDay => {
      const review = getCloudyReviewBackground(timeOfDay);
      const production = getHomeBackground('cloudy', Date.now(), timeOfDay, 'home');
      const sunny = getHomeBackground('sunny', Date.now(), timeOfDay, 'home');
      expect(review.variant).toBe(`cloudy-review-${timeOfDay}`);
      expect(review.assetId).toBe(`cloudy-${timeOfDay}-full-frame-3x.jpg`);
      expect(review.backgroundScale).toBe(sunny.backgroundScale);
      if (timeOfDay === 'day') {
        expect(review.backgroundOffsetXPct).toBeCloseTo(sunny.backgroundOffsetXPct + 1.54);
        expect(review.backgroundOffsetYPct).toBeCloseTo(sunny.backgroundOffsetYPct - 0.95);
      } else {
        expect(review.backgroundOffsetXPct).toBe(sunny.backgroundOffsetXPct);
        expect(review.backgroundOffsetYPct).toBe(sunny.backgroundOffsetYPct);
      }
      expect(production.variant).not.toContain('review');
    },
  );

  it.each([
    ['cloudy', 'cloudy'],
    ['rain', 'rainy'],
    ['snow', 'snowy'],
  ] as const)('exposes all three %s states only through the Dev review mapper', (weather, filePrefix) => {
    for (const timeOfDay of ['day', 'sunset', 'night'] as const) {
      const review = getWeatherReviewBackground(weather, timeOfDay);
      const production = getHomeBackground(weather, Date.now(), timeOfDay, 'home');
      const sunny = getHomeBackground('sunny', Date.now(), timeOfDay, 'home');
      expect(review.variant).toBe(`${weather}-review-${timeOfDay}`);
      expect(review.assetId).toBe(`${filePrefix}-${timeOfDay}-full-frame-3x.jpg`);
      expect(review.backgroundScale).toBe(sunny.backgroundScale);
      expect(production.variant).not.toContain('review');
    }
  });

  it('keeps corrected Snow Sunset on a readable pearl hero treatment', () => {
    expect(getWeatherReviewBackground('snow', 'sunset').useDarkText).toBe(false);
    expect(getWeatherReviewBackground('rain', 'sunset').useDarkText).toBe(false);
  });

  it('registers the corrected Rainy Day material pass back to the locked world', () => {
    const rainy = getWeatherReviewBackground('rain', 'day');
    expect(rainy.backgroundOffsetXPct).toBeCloseTo(0.26);
    expect(rainy.backgroundOffsetYPct).toBeCloseTo(-1.66);
  });

  it.each(['day', 'sunset', 'night'] as const)(
    'keeps Home and Settings on the same effective %s state',
    appearance => {
      const effective = resolveEffectiveScenicTime({ appearance }).timeOfDay;
      const home = getHomeBackground('sunny', Date.now(), effective, 'home');
      const settings = getHomeBackground('sunny', Date.now(), effective, 'settings');
      expect(home.variant).toBe(`sunny-${appearance}`);
      expect(settings.variant).toBe(home.variant);
      expect(settings.assetId).toBe(home.assetId);
    },
  );
});
