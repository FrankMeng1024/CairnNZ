import { DAY_VISUAL_THEME, NIGHT_VISUAL_THEME, SUNSET_VISUAL_THEME } from '../tokens';

describe('Route visual theme roles', () => {
  test('all three themes define one source-independent Route palette', () => {
    const palettes = [DAY_VISUAL_THEME, SUNSET_VISUAL_THEME, NIGHT_VISUAL_THEME];
    palettes.forEach(theme => {
      expect(theme.mapRouteLine).toBeTruthy();
      expect(theme.mapRouteCasing).toBeTruthy();
      expect(theme.mapRoutePending).toBeTruthy();
      expect(theme.mapRouteGap).toBeTruthy();
      expect(theme.mapRouteLine).not.toBe(theme.mapFogFill);
      expect(theme.mapRouteLine).not.toBe(theme.mapFriendMemoryFill);
    });
    expect(new Set(palettes.map(theme => theme.mapRouteLine)).size).toBe(3);
  });
});
