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

  it('keeps Home Sunset independent from Night while preserving non-Home compatibility', () => {
    const homeSunset = getHomeBackground('sunny', Date.now(), 'sunset', 'home');
    const sharedSunset = getHomeBackground('sunny', Date.now(), 'sunset', 'shared');
    const homeNight = getHomeBackground('sunny', Date.now(), 'night', 'home');

    expect(homeSunset.cardBackgroundColor).toBe('rgba(226,213,199,0.74)');
    expect(homeSunset.actionButtonTextColor).toBe('#1F2F2A');
    expect(homeSunset.invertIcons).toBe(false);
    expect(homeSunset.cardBackgroundColor).not.toBe(homeNight.cardBackgroundColor);
    expect(homeSunset.actionButtonBackgroundColor).not.toBe(homeNight.actionButtonBackgroundColor);
    expect(sharedSunset.cardBackgroundColor).toBe('rgba(67,63,70,0.60)');
    expect(sharedSunset.invertIcons).toBe(true);
  });

  it('regression-locks the accepted Home Day and Night material values', () => {
    const day = getHomeBackground('sunny', Date.now(), 'day', 'home');
    const night = getHomeBackground('sunny', Date.now(), 'night', 'home');

    expect({
      text: day.textColor,
      muted: day.textColorMuted,
      card: day.cardBackgroundColor,
      cardBorder: day.cardBorderColor,
      action: day.actionButtonBackgroundColor,
      actionText: day.actionButtonTextColor,
      nav: day.tabBarBackgroundColor,
      icon: day.actionIconColor,
    }).toEqual({
      text: '#2D3131',
      muted: 'rgba(45,49,49,0.82)',
      card: 'rgba(241,239,231,0.78)',
      cardBorder: 'rgba(255,255,255,0.58)',
      action: 'rgba(239,237,229,0.74)',
      actionText: '#243B34',
      nav: 'rgba(237,235,227,0.78)',
      icon: '#29483E',
    });
    expect({
      text: night.textColor,
      muted: night.textColorMuted,
      card: night.cardBackgroundColor,
      cardBorder: night.cardBorderColor,
      action: night.actionButtonBackgroundColor,
      actionText: night.actionButtonTextColor,
      nav: night.tabBarBackgroundColor,
      icon: night.actionIconColor,
    }).toEqual({
      text: '#E8EDF0',
      muted: 'rgba(220,229,234,0.86)',
      card: 'rgba(37,46,58,0.66)',
      cardBorder: 'rgba(208,220,231,0.22)',
      action: 'rgba(39,49,61,0.62)',
      actionText: '#F2F5EF',
      nav: 'rgba(32,42,53,0.68)',
      icon: '#DCE7E7',
    });
  });

  it('resolves Sunset variants across the weather family', () => {
    expect(resolveVariant('rain', Date.now(), 'sunset')).toBe('rain-sunset');
    expect(resolveVariant('cloudy', Date.now(), 'sunset')).toBe('cloudy-sunset');
  });

  it.each(['day', 'sunset', 'night'] as const)(
    'keeps experimental Cloudy %s isolated on the Dev review mapping',
    timeOfDay => {
      const review = getCloudyReviewBackground(timeOfDay);
      const production = getHomeBackground('cloudy', Date.now(), timeOfDay, 'home');
      const sunny = getHomeBackground('sunny', Date.now(), timeOfDay, 'home');
      expect(review.variant).toBe(`cloudy-review-${timeOfDay}`);
      expect(review.assetId).toBe(`cloudy-${timeOfDay}-full-frame-3x.jpg`);
      expect(production.assetId).toBe(review.assetId);
      expect(review.backgroundScale).toBe(sunny.backgroundScale);
      if (timeOfDay === 'day') {
        expect(review.backgroundOffsetXPct).toBe(1.54);
        expect(review.backgroundOffsetYPct).toBe(-0.95);
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
      expect(production.assetId).toBe(review.assetId);
      expect(review.backgroundScale).toBe(sunny.backgroundScale);
      expect(production.variant).not.toContain('review');
    }
  });

  it('keeps corrected Snow Sunset on a readable pearl hero treatment', () => {
    expect(getWeatherReviewBackground('snow', 'sunset').useDarkText).toBe(false);
    expect(getWeatherReviewBackground('rain', 'sunset').useDarkText).toBe(false);
  });

  it('restores the measured V1 Rainy Day registration for rollback review', () => {
    const rainy = getWeatherReviewBackground('rain', 'day');
    expect(rainy.backgroundOffsetXPct).toBe(0.26);
    expect(rainy.backgroundOffsetYPct).toBe(-1.66);
  });

  it('restores the measured V1 Snowy Day registration for rollback review', () => {
    const snowy = getWeatherReviewBackground('snow', 'day');
    expect(snowy.backgroundOffsetXPct).toBe(0);
    expect(snowy.backgroundOffsetYPct).toBe(-0.12);
  });

  it.each(['day', 'sunset', 'night'] as const)(
    'exposes Sunny %s from the same rollback family only through Dev review',
    timeOfDay => {
      const review = getWeatherReviewBackground('sunny', timeOfDay);
      const production = getHomeBackground('sunny', Date.now(), timeOfDay, 'home');
      const expected = {
        day: 'sunny-day-final-micro-3x.jpg',
        sunset: 'sunny-evening-final-micro-3x.jpg',
        night: 'sunny-night-star-micro-v2-3x.jpg',
      } as const;
      expect(review.variant).toBe(`sunny-review-${timeOfDay}`);
      expect(review.assetId).toBe(expected[timeOfDay]);
      expect(production.variant).toBe(`sunny-${timeOfDay}`);
      expect(production.assetId).toBe(expected[timeOfDay]);
      expect(production.variant).not.toContain('review');
    },
  );

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
