import { resolveActivityScreenOwnership } from '../activityScreenOwnership';

describe('Activity screen ownership', () => {
  test.each(['requesting', 'tracking', 'paused'] as const)(
    'a live hike cannot be presented as a run while %s',
    status => {
      expect(resolveActivityScreenOwnership(status, 'hiking', 'running')).toEqual({
        kind: 'owned-elsewhere',
        ownerMode: 'hiking',
      });
    },
  );

  test.each(['requesting', 'tracking', 'paused'] as const)(
    'a live run cannot be presented as a hike while %s',
    status => {
      expect(resolveActivityScreenOwnership(status, 'running', 'hiking')).toEqual({
        kind: 'owned-elsewhere',
        ownerMode: 'running',
      });
    },
  );

  test('an idle screen is available without mutating the stored next mode', () => {
    expect(resolveActivityScreenOwnership('idle', 'running', 'hiking')).toEqual({ kind: 'available' });
  });
});
