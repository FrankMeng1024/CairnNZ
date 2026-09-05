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
  'recordSurface',
  'recordPressed',
  'recordSelected',
  'elevatedCardSurface',
  'scenicSurface',
  'modalSurface',
  'sheetSurface',
  'inputSurface',
  'inputFocusBorder',
  'controlSelected',
  'controlInactive',
  'segmentedTrack',
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
  'destructiveSurface',
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
      expect(theme.controlSelected).not.toBe(theme.tabActive);
      expect(theme.controlInactive).not.toBe(theme.tabInactive);
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
    expect(RadiusRole.segmentedControl).toBe(Radius.card);
    expect(RadiusRole.segmentedItem).toBe(Radius.button);
    expect(RadiusRole.input).toBe(Radius.card);
    expect(RadiusRole.sheet).toBe(Radius.sheet);
    expect(RadiusRole.modal).toBe(Radius.card);
    expect(Math.max(...Object.values(RadiusRole))).toBeLessThanOrEqual(Radius.cardLg);
  });

  it('meets representative rendered text, control and icon contrast floors', () => {
    for (const theme of themes) {
      const page = parseColor(theme.background);
      const record = composite(parseColor(theme.recordSurface), page);
      const input = composite(parseColor(theme.inputSurface), page);
      const track = composite(parseColor(theme.segmentedTrack), page);
      const selected = composite(parseColor(theme.controlSelected), track);
      const destructiveSurface = composite(parseColor(theme.destructiveSurface), parseColor(theme.modalSurface));

      expect(contrast(parseColor(theme.textPrimary), record)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parseColor(theme.textSecondary), record)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parseColor(theme.textPrimary), input)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parseColor(theme.onPrimary), parseColor(theme.primaryAction))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parseColor(theme.tabActive), selected)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parseColor(theme.tabInactive), track)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parseColor(theme.icon), record)).toBeGreaterThanOrEqual(3);
      expect(contrast(parseColor(theme.inputFocusBorder), input)).toBeGreaterThanOrEqual(3);
      expect(contrast(parseColor(theme.destructive), destructiveSurface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parseColor(theme.disabledText), composite(parseColor(theme.disabledSurface), page))).toBeGreaterThanOrEqual(3);
    }
  });
});

type Rgba = { r: number; g: number; b: number; a: number };

function parseColor(value: string): Rgba {
  if (value.startsWith('#')) {
    return {
      r: Number.parseInt(value.slice(1, 3), 16),
      g: Number.parseInt(value.slice(3, 5), 16),
      b: Number.parseInt(value.slice(5, 7), 16),
      a: 1,
    };
  }
  const channels = value.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3) throw new Error(`Unsupported color: ${value}`);
  return { r: channels[0], g: channels[1], b: channels[2], a: channels[3] ?? 1 };
}

function composite(front: Rgba, back: Rgba): Rgba {
  return {
    r: front.r * front.a + back.r * (1 - front.a),
    g: front.g * front.a + back.g * (1 - front.a),
    b: front.b * front.a + back.b * (1 - front.a),
    a: 1,
  };
}

function contrast(first: Rgba, second: Rgba): number {
  const luminance = ({ r, g, b }: Rgba) => {
    const linear = [r, g, b].map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

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
