import React from 'react';
import { render } from '@testing-library/react-native';

const mockCameraProps: any[] = [];
let mockSessionCamera: any = null;

jest.mock('../services/mapboxAdapter', () => {
  const React = require('react');
  const Passthrough = ({ children }: any) => React.createElement(React.Fragment, null, children);
  const MapView = React.forwardRef(({ children }: any, _ref: any) => (
    React.createElement(React.Fragment, null, children)
  ));
  const Camera = React.forwardRef((props: any, _ref: any) => {
    mockCameraProps.push(props);
    return null;
  });
  return {
    getMapbox: () => ({
      available: true,
      MapView,
      Camera,
      UserLocation: Passthrough,
      CircleLayer: () => null,
      StyleImport: () => null,
    }),
  };
});

jest.mock('../store/useMemoryNavigationSessionStore', () => {
  const store: any = (selector: any) => selector({ camera: mockSessionCamera });
  store.getState = () => ({ camera: mockSessionCamera, setCamera: jest.fn() });
  return { useMemoryNavigationSessionStore: store };
});

jest.mock('../../../store/useMarkerStore', () => ({
  useMarkerStore: (selector: any) => selector({ markers: [], circleMarkers: [] }),
}));
jest.mock('../store/useMemoryScopeStore', () => ({
  useMemoryScopeStore: (selector: any) => selector({ scope: 'self' }),
}));
jest.mock('../store/useMemoryStore', () => ({
  useMemoryStore: (selector: any) => selector({
    localHydration: {
      ownerUserId: 'viewer-a', status: 'ready', requiresInitialReconcile: false,
      initialReconcile: 'not_required', revision: 1,
    },
  }),
}));
jest.mock('../../../store/useAppStore', () => {
  const store: any = (selector: any) => selector({ user: { id: 'viewer-a' } });
  store.getState = () => ({ user: { id: 'viewer-a' } });
  return { useAppStore: store };
});
jest.mock('../../cairns/cairnPresentationStore', () => ({
  useCairnPresentationStore: (selector: any) => selector({ acquiredMarkers: [] }),
}));
jest.mock('../../cairns/cairnWorkspace', () => ({ markersForVisibleWorkspace: () => [] }));
jest.mock('../services/cairnMapPresentation', () => ({ markersForMemoryScope: () => [] }));
jest.mock('../../../hooks/useVisualTheme', () => ({ useVisualTheme: () => 'light' }));
jest.mock('../../../hooks/useMapTheme', () => ({ useMapTheme: () => 'day' }));
jest.mock('../../../config/mapbox', () => ({
  getMapStyleForTheme: () => 'qa-style',
  themeToStandardPreset: () => 'day',
  buildStandardConfig: () => ({}),
}));
jest.mock('../../../services/appLog', () => ({ log: jest.fn(), flushNow: jest.fn() }));
jest.mock('../../../i18n/runtime', () => ({ cairnText: (key: string) => key }));
jest.mock('../components/FogLayer', () => ({ FogLayer: () => null }));
jest.mock('../components/CairnPinsLayer', () => ({ CairnPinsLayer: () => null }));
jest.mock('../components/AcquiredCairnClusterLayer', () => ({ AcquiredCairnClusterLayer: () => null }));
jest.mock('../../../components/MapLoadOverlay', () => ({ MapLoadOverlay: () => null }));
jest.mock('../../../components/Icon', () => ({ Icon: () => null }));

const { MemoryMap } = require('../components/MemoryMap');

describe('MemoryMap native Camera recreation contract', () => {
  beforeEach(() => {
    mockCameraProps.length = 0;
    mockSessionCamera = null;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('a newly mounted MemoryMap passes the saved full camera through RNMapbox heading', () => {
    const first = render(<MemoryMap centerLat={-41.3} centerLng={174.8} showUserLocation={false} />);
    expect(mockCameraProps.at(-1).defaultSettings).toEqual({
      centerCoordinate: [174.8, -41.3], zoomLevel: 16.5, heading: 0, pitch: 0,
    });
    first.unmount();

    mockSessionCamera = {
      center: [116.32, 39.9], zoom: 18, bearing: 127, pitch: 41, actionId: 22,
    };
    const recreated = render(<MemoryMap centerLat={-41.3} centerLng={174.8} showUserLocation={false} />);

    expect(mockCameraProps.at(-1).defaultSettings).toEqual({
      centerCoordinate: [116.32, 39.9], zoomLevel: 18, heading: 127, pitch: 41,
    });
    expect(mockCameraProps.at(-1).defaultSettings).not.toHaveProperty('bearing');
    recreated.unmount();
  });
});
