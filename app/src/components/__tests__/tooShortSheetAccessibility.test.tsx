import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { Animated } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { TooShortSheet } from '../TooShortSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../../hooks/useVisualTheme', () => {
  const { DAY_VISUAL_THEME } = jest.requireActual('../tokens');
  return { useVisualTheme: () => DAY_VISUAL_THEME };
});

jest.mock('../Icon', () => ({ Icon: () => null }));

const sheetPath = path.resolve(__dirname, '..', 'TooShortSheet.tsx');

function openingTagForStyle(source: string, styleName: string): string {
  const styleIndex = source.indexOf(styleName);
  const tagStart = source.lastIndexOf('<TouchableOpacity', styleIndex);
  const tagClose = '\n        >';
  const tagEnd = source.indexOf(tagClose, styleIndex);
  if (styleIndex < 0 || tagStart < 0 || tagEnd < 0) throw new Error(`${styleName} action not found`);
  return source.slice(tagStart, tagEnd + tagClose.length);
}

function mutateOpeningTag(source: string, styleName: string, mutate: (tag: string) => string): string {
  const tag = openingTagForStyle(source, styleName);
  return source.replace(tag, mutate(tag));
}

function accessibilityContract(source: string): boolean {
  const primary = openingTagForStyle(source, 'styles.btnPrimary');
  const secondary = openingTagForStyle(source, 'styles.btnSecondary');
  return (primary.match(/accessibilityRole="button"/g) ?? []).length === 1
    && (primary.match(/accessibilityLabel="Got it — keep going"/g) ?? []).length === 1
    && (secondary.match(/accessibilityRole="button"/g) ?? []).length === 1
    && (secondary.match(/accessibilityLabel=\{`End \$\{label\.toLowerCase\(\)\} anyway`\}/g) ?? []).length === 1;
}

describe('TooShortSheet accessibility contract', () => {
  beforeEach(() => {
    jest.spyOn(Animated, 'parallel').mockImplementation(() => ({
      start: (callback?: Animated.EndCallback) => callback?.({ finished: true }),
      stop: jest.fn(),
      reset: jest.fn(),
    } as unknown as Animated.CompositeAnimation));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['hiking', 'End hike anyway'],
    ['running', 'End run anyway'],
  ] as const)('%s exposes exactly two uniquely named enabled actions', (activityMode, discardLabel) => {
    const screen = render(
      <TooShortSheet visible activityMode={activityMode} onContinue={jest.fn()} onDiscard={jest.fn()} />,
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Got it — keep going' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: discardLabel })).toHaveLength(1);
    expect(buttons.every(button => button.props.disabled !== true
      && button.props.accessibilityState?.disabled !== true)).toBe(true);
  });

  it.each([
    ['hiking', 'End hike anyway'],
    ['running', 'End run anyway'],
  ] as const)('%s Continue action fires exactly once', (activityMode, discardLabel) => {
    const onContinue = jest.fn();
    const onDiscard = jest.fn();
    const screen = render(
      <TooShortSheet visible activityMode={activityMode} onContinue={onContinue} onDiscard={onDiscard} />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Got it — keep going' }));

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: discardLabel })).toHaveLength(1);
  });

  it.each([
    ['hiking', 'End hike anyway'],
    ['running', 'End run anyway'],
  ] as const)('%s discard action fires exactly once', (activityMode, discardLabel) => {
    const onContinue = jest.fn();
    const onDiscard = jest.fn();
    const screen = render(
      <TooShortSheet visible activityMode={activityMode} onContinue={onContinue} onDiscard={onDiscard} />,
    );

    fireEvent.press(screen.getByRole('button', { name: discardLabel }));

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it.each(['hiking', 'running'] as const)('%s hidden sheet exposes no buttons', activityMode => {
    const screen = render(
      <TooShortSheet visible={false} activityMode={activityMode} onContinue={jest.fn()} onDiscard={jest.fn()} />,
    );

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('rejects removal or duplication of either action semantic', () => {
    const source = fs.readFileSync(sheetPath, 'utf8');
    const mutations = [
      mutateOpeningTag(source, 'styles.btnPrimary', tag => tag.replace('          accessibilityRole="button"\n', '')),
      mutateOpeningTag(source, 'styles.btnPrimary', tag => tag.replace('          accessibilityLabel="Got it — keep going"\n', '')),
      mutateOpeningTag(source, 'styles.btnSecondary', tag => tag.replace('          accessibilityRole="button"\n', '')),
      mutateOpeningTag(source, 'styles.btnSecondary', tag => tag.replace('          accessibilityLabel={`End ${label.toLowerCase()} anyway`}\n', '')),
      mutateOpeningTag(source, 'styles.btnPrimary', tag => tag.replace('          accessibilityRole="button"\n',
        '          accessibilityRole="button"\n          accessibilityRole="button"\n')),
      mutateOpeningTag(source, 'styles.btnSecondary', tag => tag.replace('          accessibilityLabel={`End ${label.toLowerCase()} anyway`}\n',
        '          accessibilityLabel={`End ${label.toLowerCase()} anyway`}\n          accessibilityLabel={`End ${label.toLowerCase()} anyway`}\n')),
    ];

    expect(accessibilityContract(source)).toBe(true);
    for (const mutation of mutations) expect(accessibilityContract(mutation)).toBe(false);
  });
});
