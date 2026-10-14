import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { buildDiscoveryHomeCopy } from '../../features/cairns/homeStateWindow';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('expo-linear-gradient', () => {
  const ReactModule = require('react'); const { View } = require('react-native');
  return { LinearGradient: ({ children, ...props }: any) => ReactModule.createElement(View, props, children) };
});
jest.mock('../../components/Icon', () => ({ Icon: () => null }));
jest.mock('../../components/CairnIcon', () => ({ CairnIcon: () => null }));
jest.mock('../../components/home/HomeProductIcon', () => ({ HomeProductIcon: () => null }));
jest.mock('../../components/home/HomeActionCandidateIcon', () => ({ HomeActionCandidateIcon: () => null }));
jest.mock('../../components/home/SunnyMotionLayer', () => ({ SunnyMotionLayer: () => null }));
jest.mock('../../utils/homeBackground', () => ({ getRegisteredBackgroundLayout: () => ({ width: '100%', height: '100%' }) }));

import { HomeScreen as GeneratedHome } from '../home_generated/HomeScreen.generated';
import { styles as generatedHomeStyles } from '../home_generated/styles';

describe('production Home discovery rendering', () => {
  test('a long resolved place keeps the waiting line in document flow', () => {
    const screen = render(
      <GeneratedHome state="H0" greetingName="Aroha" countryName="Queenstown-Lakes District" />,
    );
    const place = screen.getByText('Queenstown-Lakes District');
    const waiting = screen.getByText('is waiting.');
    expect(StyleSheet.flatten(place.props.style).position).toBeUndefined();
    expect(StyleSheet.flatten(waiting.props.style).position).toBeUndefined();
    expect(StyleSheet.flatten(generatedHomeStyles.H0__hero_invite_block)).toMatchObject({ top: 137, left: 24, right: 24 });
  });

  test('three acquired Cairns render one H1 summary and never the first-trail card', () => {
    const copy = buildDiscoveryHomeCopy({ cairnCount: 3, eventCount: 3, updatedEventCount: 0, mergeStartedAt: 1 }, 'Just now');
    const screen = render(
      <GeneratedHome
        state="H1"
        greetingName="Aroha"
        lastHikeEyebrow="FOUND IN YOUR WALK"
        lastHikeTitle={copy.title}
        lastHikeMeta={copy.meta}
        lastHikeDetails={copy.details}
        onLastHikePress={() => undefined}
        memoryUnreadCount={3}
      />,
    );
    expect(screen.getAllByText('3 Cairns are now in Memory')).toHaveLength(1);
    expect(screen.getByLabelText('Memory, 3 unread Cairn groups')).toBeTruthy();
    expect(screen.queryByText('Your first trail')).toBeNull();
    expect(screen.getAllByText('Saved in Memory')).toHaveLength(1);
  });
});
