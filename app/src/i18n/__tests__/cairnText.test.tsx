import React, { useEffect, useState } from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { CAIRN_TEXT } from '../cairnText';
import {
  LocalizationBoundary,
  cairnText,
  normalizeCairnLocale,
  setCairnLocaleOverride,
} from '../runtime';

describe('single Cairn text catalog runtime', () => {
  afterEach(() => act(() => setCairnLocaleOverride(null)));

  it('normalizes Japanese and English variants with an en-NZ default', () => {
    expect(normalizeCairnLocale('ja')).toBe('ja-JP');
    expect(normalizeCairnLocale('ja-JP')).toBe('ja-JP');
    expect(normalizeCairnLocale('en-AU')).toBe('en-NZ');
    expect(normalizeCairnLocale('zh-CN')).toBe('en-NZ');
  });

  it('renders approved Japanese, explicit pending fallback and pseudo-expanded QA copy', () => {
    setCairnLocaleOverride('ja-JP');
    expect(cairnText('navigation.back')).toBe('戻る');
    expect(cairnText('public.anonymous-explorer')).toBe('Anonymous explorer');
    setCairnLocaleOverride('en-XA');
    expect(cairnText('navigation.back')).toMatch(/^⟦B/);
    expect(cairnText('navigation.back')).toContain('···⟧');
  });

  it.each([
    [0, 'No items'],
    [1, '1 item'],
    [2, '2 items'],
    [27, '27 items'],
  ])('supports whole-message plural selection for %s', (count, expected) => {
    setCairnLocaleOverride('en-NZ');
    expect(cairnText('qa.sample.items', { count })).toBe(expected);
  });

  it('never exposes an unknown internal key or a blank value', () => {
    setCairnLocaleOverride('en-NZ');
    const rendered = cairnText('missing.internal.key' as never);
    expect(rendered).toBe('Text unavailable');
    expect(rendered).not.toContain('missing.internal.key');
  });

  it('makes a catalog-only edit visible to every resolver call and restores it', () => {
    const entry = CAIRN_TEXT['navigation.back'] as { 'en-NZ': string };
    const original = entry['en-NZ'];
    try {
      entry['en-NZ'] = 'Return';
      setCairnLocaleOverride('en-NZ');
      expect([cairnText('navigation.back'), cairnText('navigation.back'), cairnText('navigation.back')])
        .toEqual(['Return', 'Return', 'Return']);
    } finally {
      entry['en-NZ'] = original;
    }
  });

  it('resolves one shared key consistently in header, error and control surfaces', () => {
    setCairnLocaleOverride('en-NZ');
    function SharedCopyProbe() {
      return <>
        <Text testID="header-copy">{cairnText('common.retry')}</Text>
        <Text testID="error-copy">{cairnText('common.retry')}</Text>
        <Text testID="control-copy">{cairnText('common.retry')}</Text>
      </>;
    }
    render(<SharedCopyProbe />);
    expect(screen.getByTestId('header-copy')).toHaveTextContent('Retry');
    expect(screen.getByTestId('error-copy')).toHaveTextContent('Retry');
    expect(screen.getByTestId('control-copy')).toHaveTextContent('Retry');
  });

  it('interpolates dynamic names without exposing placeholders', () => {
    setCairnLocaleOverride('en-NZ');
    const rendered = cairnText('friend-content-screen.by-value-read-only', { name: 'Aroha' });
    expect(rendered).toContain('Aroha');
    expect(rendered).not.toContain('{name}');
  });

  it('updates locale without remounting or losing existing component state', () => {
    let mounts = 0;
    let updateJourney: (() => void) | null = null;
    function StatefulProbe() {
      const [draft, updateDraft] = useState('route-draft');
      const [friends, updateFriends] = useState('friend-12,friend-34');
      const [camera, updateCamera] = useState('174.76,-36.85,z17');
      updateJourney = () => {
        updateDraft('edited-draft');
        updateFriends('friend-34');
        updateCamera('174.78,-36.86,z18');
      };
      useEffect(() => { mounts += 1; }, []);
      return <Text testID="stateful-probe">{`${cairnText('navigation.back')}|${draft}|${friends}|${camera}`}</Text>;
    }

    setCairnLocaleOverride('en-NZ');
    render(<LocalizationBoundary><StatefulProbe /></LocalizationBoundary>);
    act(() => updateJourney?.());
    act(() => setCairnLocaleOverride('ja-JP'));
    expect(screen.getByTestId('stateful-probe'))
      .toHaveTextContent('戻る|edited-draft|friend-34|174.78,-36.86,z18');
    expect(mounts).toBe(1);
  });
});
