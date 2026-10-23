const mockCapture = jest.fn(async (_input: unknown) => undefined);
jest.mock('../automaticDiagnosticOutbox', () => ({
  captureAutomaticDiagnosticEvent: (input: unknown) => mockCapture(input),
}));
jest.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ user: { id: 'owner-a' } }) },
}));
jest.mock('../../features/activitySimulator/capability', () => ({
  activitySimulatorBuildCapable: false,
}));

import { log } from '../appLog';

describe('existing appLog durable Memory/Fog routing', () => {
  beforeEach(() => jest.clearAllMocks());

  test('automatically sends only an owner-scoped coordinate-free lifecycle summary to the durable outbox', () => {
    log('memory.tab_focus', {
      state: 'focused',
      latitude: -41.2,
      longitude: 174.7,
      accessToken: 'must-not-survive',
    });
    expect(mockCapture).toHaveBeenCalledTimes(1);
    const input = mockCapture.mock.calls[0][0] as any;
    expect(input).toMatchObject({
      ownerUserId: 'owner-a',
      eventCode: 'MEMORY_TAB_FOCUS',
      sourceModule: 'Memory',
      stream: { sourceType: 'memory', memoryScopeId: expect.any(String) },
      details: { tag: 'memory.tab_focus', state: 'focused' },
    });
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain('-41.2');
    expect(serialized).not.toContain('174.7');
    expect(serialized).not.toContain('must-not-survive');
  });

  test('routes bounded Plant lifecycle evidence without enabling per-sample logging', () => {
    log('plant.commit_failed', { reason: 'offline', msg: 'private free text' });
    log('plant.gps_watcher_sample', { accuracy: 4 });

    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture.mock.calls[0][0]).toMatchObject({
      ownerUserId: 'owner-a',
      eventCode: 'PLANT_COMMIT_FAILED',
      sourceModule: 'Plant',
      stream: { sourceType: 'app' },
    });
  });
});
