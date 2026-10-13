import React from 'react';
import { render } from '@testing-library/react-native';
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

describe('production Home discovery rendering', () => {
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
