import {
  DAY_VISUAL_THEME,
  NIGHT_VISUAL_THEME,
  Radius,
  RadiusRole,
  SUNSET_VISUAL_THEME,
  getVisualTheme,
  type VisualThemeTokens,
} from '../tokens';
import {
  FAMILY_B_CAIRN_PATHS,
  FAMILY_B_CAIRN_STROKE_WIDTH,
  FAMILY_B_CAIRN_VIEW_BOX,
} from '../home/FamilyBCairnIcon';

const themes: VisualThemeTokens[] = [DAY_VISUAL_THEME, SUNSET_VISUAL_THEME, NIGHT_VISUAL_THEME];
const requiredStringRoles: Array<keyof VisualThemeTokens> = [
  'background',
  'backgroundElevated',
  'surfacePrimary',
  'surfaceSecondary',
  'scenicSurface',
  'modalSurface',
  'sheetSurface',
  'inputSurface',
  'inputFocusBorder',
  'controlSelected',
  'controlInactive',
  'textPrimary',
  'textSecondary',
  'textMuted',
  'scenicText',
  'borderSubtle',
  'borderStrong',
  'scrim',
  'primaryAction',
  'secondaryAction',
  'destructive',
  'disabledSurface',
  'disabledText',
  'disabledBorder',
];

describe('semantic visual foundation', () => {
  it('provides shared control, focus and disabled roles in every time state', () => {
    for (const theme of themes) {
      for (const role of requiredStringRoles) {
        expect(typeof theme[role]).toBe('string');
        expect(theme[role]).toBeTruthy();
      }
      expect(theme.controlSelected).toBe(theme.tabActive);
      expect(theme.controlInactive).toBe(theme.tabInactive);
    }
  });

  it('resolves Day, Sunset and Night without a binary theme fallback', () => {
    expect(getVisualTheme('day')).toBe(DAY_VISUAL_THEME);
    expect(getVisualTheme('sunset')).toBe(SUNSET_VISUAL_THEME);
    expect(getVisualTheme('night')).toBe(NIGHT_VISUAL_THEME);
  });

  it('uses the existing radius scale for semantic component roles', () => {
    expect(RadiusRole.card).toBe(Radius.card);
    expect(RadiusRole.panel).toBe(Radius.cardLg);
    expect(RadiusRole.button).toBe(Radius.button);
    expect(RadiusRole.segmentedControl).toBe(Radius.pill);
    expect(RadiusRole.input).toBe(Radius.card);
    expect(RadiusRole.sheet).toBe(Radius.sheet);
    expect(RadiusRole.modal).toBe(Radius.card);
    expect(Math.max(...Object.values(RadiusRole))).toBeLessThanOrEqual(Radius.cardLg);
  });
});

describe('approved Family B cairn', () => {
  it('preserves the approved source geometry exactly', () => {
    expect(FAMILY_B_CAIRN_VIEW_BOX).toBe('0 0 48 48');
    expect(FAMILY_B_CAIRN_STROKE_WIDTH).toBe(2.25);
    expect(FAMILY_B_CAIRN_PATHS).toEqual([
      'M8 38.5h25.5c4.8 0 7.4-1.3 10.5-4.8-4.8-.6-8.4-.6-12.2.2L25 36.1',
      'M11 33.5c.2-3.6 3.5-5.6 10.5-5.6s10.3 2 10.5 5.6M14.8 26.5c.2-3.4 2.5-5.3 6.7-5.3s6.5 1.9 6.7 5.3M17.8 19.7c.2-2.8 1.5-4.4 3.9-4.4s3.8 1.6 4 4.4',
    ]);
  });
});
