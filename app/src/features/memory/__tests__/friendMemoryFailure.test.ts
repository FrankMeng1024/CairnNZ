import { classifyFriendMemoryFailure } from '../services/friendMemoryFailure';

describe('Friend Memory failure presentation', () => {
  test('distinguishes revoked/forbidden, server, and transport failures', () => {
    expect(classifyFriendMemoryFailure({ httpStatus: 401 })).toBe('unauthorized');
    expect(classifyFriendMemoryFailure({ httpStatus: 403 })).toBe('unauthorized');
    expect(classifyFriendMemoryFailure({ httpStatus: 503 })).toBe('unavailable');
    expect(classifyFriendMemoryFailure({ timedOut: true })).toBe('offline');
    expect(classifyFriendMemoryFailure({})).toBe('offline');
  });
});
