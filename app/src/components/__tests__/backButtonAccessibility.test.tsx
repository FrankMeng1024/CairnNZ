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

type Variant = 'pill' | 'inline' | 'ghostRound';

const variants: Variant[] = ['pill', 'inline', 'ghostRound'];
const backButtonPath = path.resolve(__dirname, '..', 'BackButton.tsx');
const publicDetailPath = path.resolve(__dirname, '..', '..', 'screens', 'PublicCairnDetailScreen.tsx');

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
    && (tag.match(/accessibilityLabel=\{label\}/g) ?? []).length === 1;
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
    const withoutLabel = mutatePillOpeningTag(source, tag => tag.replace('        accessibilityLabel={label}\n', ''));

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
    expect(unavailableBranch).toContain('Public Cairn unavailable');
    expect(unavailableBranch).toContain('<BackButton variant="inline" />');
    expect(authorizedBranch).toContain('<BackButton variant="pill" />');
  });
});
