import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { BackButton } from '../BackButton';

const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));

jest.mock('../../hooks/useVisualTheme', () => {
  const { DAY_VISUAL_THEME } = jest.requireActual('../tokens');
  return { useVisualTheme: () => DAY_VISUAL_THEME };
});

jest.mock('../Icon', () => ({ Icon: () => null }));

type Variant = 'pill' | 'inline' | 'mapInline' | 'ghostRound';

const variants: Variant[] = ['pill', 'inline', 'mapInline', 'ghostRound'];
const backButtonPath = path.resolve(__dirname, '..', 'BackButton.tsx');
const publicDetailPath = path.resolve(__dirname, '..', '..', 'screens', 'PublicCairnDetailScreen.tsx');

function productionTsxFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name.endsWith('_generated')) return [];
      return productionTsxFiles(absolute);
    }
    return entry.isFile() && entry.name.endsWith('.tsx') ? [absolute] : [];
  });
}

function mutatePillOpeningTag(source: string, mutate: (tag: string) => string): string {
  const pillStart = source.indexOf('// Pill: frosted-glass effect');
  const tagStart = source.indexOf('<TouchableOpacity', pillStart);
  const tagEnd = source.indexOf('>', tagStart) + 1;
  if (pillStart < 0 || tagStart < 0 || tagEnd === 0) throw new Error('pill TouchableOpacity not found');
  return `${source.slice(0, tagStart)}${mutate(source.slice(tagStart, tagEnd))}${source.slice(tagEnd)}`;
}

function pillAccessibilityContract(source: string): boolean {
  const pillStart = source.indexOf('// Pill: frosted-glass effect');
  const tagStart = source.indexOf('<TouchableOpacity', pillStart);
  const tagEnd = source.indexOf('>', tagStart) + 1;
  if (pillStart < 0 || tagStart < 0 || tagEnd === 0) return false;
  const tag = source.slice(tagStart, tagEnd);
  return (tag.match(/accessibilityRole="button"/g) ?? []).length === 1
    && (tag.match(/accessibilityLabel=\{accessibilityLabel\}/g) ?? []).length === 1;
}

describe('BackButton accessibility contract', () => {
  beforeEach(() => {
    mockGoBack.mockClear();
  });

  it.each(variants)('%s exposes exactly one button named Back by default', variant => {
    const screen = render(<BackButton variant={variant} />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Back' })).toHaveLength(1);
  });

  it.each(variants)('%s uses a custom label as its accessible name', variant => {
    const screen = render(<BackButton variant={variant} label="Return to Memory" />);

    expect(screen.getAllByRole('button', { name: 'Return to Memory' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('keeps Activity-standard visible copy while allowing a contextual accessible name', () => {
    const screen = render(<BackButton accessibilityLabel="Back from Hike" />);

    expect(screen.getByText('Back')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back from Hike' })).toBeTruthy();
  });

  it('fires a pill callback exactly once without also navigating', () => {
    const onPress = jest.fn();
    const screen = render(<BackButton variant="pill" onPress={onPress} />);

    fireEvent.press(screen.getByRole('button', { name: 'Back' }));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('uses default navigation exactly once when no callback is supplied', () => {
    const screen = render(<BackButton variant="pill" />);

    fireEvent.press(screen.getByRole('button', { name: 'Back' }));

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('fails its pill source contract if either repaired semantic is removed', () => {
    const source = fs.readFileSync(backButtonPath, 'utf8');
    const withoutRole = mutatePillOpeningTag(source, tag => tag.replace('        accessibilityRole="button"\n', ''));
    const withoutLabel = mutatePillOpeningTag(source, tag => tag.replace('        accessibilityLabel={accessibilityLabel}\n', ''));

    expect(pillAccessibilityContract(source)).toBe(true);
    expect(pillAccessibilityContract(withoutRole)).toBe(false);
    expect(pillAccessibilityContract(withoutLabel)).toBe(false);
  });

  it('keeps unavailable and authorized Public Detail on the repaired shared variants', () => {
    const source = fs.readFileSync(publicDetailPath, 'utf8');
    const unavailableStart = source.indexOf('if (!detail) {');
    const authorizedStart = source.indexOf('testID="public-cairn-detail"', unavailableStart);
    expect(unavailableStart).toBeGreaterThan(-1);
    expect(authorizedStart).toBeGreaterThan(unavailableStart);

    const unavailableBranch = source.slice(unavailableStart, authorizedStart);
    const authorizedBranch = source.slice(authorizedStart);
    // Display copy is now catalog-owned; this source contract verifies the
    // semantic key without coupling navigation coverage to English wording.
    expect(unavailableBranch).toContain("cairnText('public-cairn-detail-screen.public-cairn-unavailable')");
    expect(unavailableBranch).toContain('<BackButton variant="inline" />');
    expect(authorizedBranch).toContain('<BackButton variant="mapInline" />');
  });

  it('uses the Activity-standard inline composition on every production BackButton callsite', () => {
    const sourceRoot = path.resolve(__dirname, '..', '..');
    const callsites = productionTsxFiles(sourceRoot)
      .filter(file => file !== backButtonPath)
      .map(file => ({ file, source: fs.readFileSync(file, 'utf8') }))
      .filter(item => item.source.includes('<BackButton'));

    expect(callsites.length).toBeGreaterThan(10);
    for (const callsite of callsites) {
      expect(callsite.source).not.toMatch(/<BackButton[^>]+variant="(?:pill|ghostRound)"/);
    }

    const memory = fs.readFileSync(path.resolve(sourceRoot, 'features/memory/screens/MemoryScreen.tsx'), 'utf8');
    expect(memory).not.toContain('memoryBackSurface');
    const activityDetail = fs.readFileSync(path.resolve(sourceRoot, 'screens/MapHistoryScreen.tsx'), 'utf8');
    expect(activityDetail).toContain("variant={isRouteDetail ? 'mapInline' : 'inline'}");
  });
});
