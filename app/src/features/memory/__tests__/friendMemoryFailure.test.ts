import {
  classifyFriendMemoryFailure,
  memoryOperationFailure,
} from '../services/friendMemoryFailure';

describe('Friend Memory failure presentation', () => {
  test('distinguishes revoked/forbidden, server, and transport failures', () => {
    expect(classifyFriendMemoryFailure({ httpStatus: 401 })).toBe('unauthorized');
    expect(classifyFriendMemoryFailure({ httpStatus: 403 })).toBe('unauthorized');
    expect(classifyFriendMemoryFailure({ httpStatus: 503 })).toBe('unavailable');
    expect(classifyFriendMemoryFailure({ timedOut: true })).toBe('offline');
    expect(classifyFriendMemoryFailure({})).toBe('offline');
  });

  test('retains typed operation cause, stage, status and target revision independently of display copy', () => {
    expect(memoryOperationFailure({
      error: new SyntaxError('Unexpected token < in JSON'),
      httpStatus: 200,
      operation: 'friend-coverage',
      stage: 'decode',
      targetRevision: 'selection:31@7',
    })).toMatchObject({
      kind: 'payload',
      operation: 'friend-coverage',
      stage: 'decode',
      httpStatus: 200,
      causeCode: 'SyntaxError',
      targetRevision: 'selection:31@7',
    });
    expect(memoryOperationFailure({
      error: Object.assign(new Error('aborted'), { name: 'AbortError' }),
      operation: 'friend-coverage',
      stage: 'transport',
      cancelled: true,
    }).kind).toBe('cancelled');
    expect(memoryOperationFailure({
      error: new Error('deadline'),
      operation: 'friend-coverage',
      stage: 'transport',
      timedOut: true,
    }).kind).toBe('timeout');
  });
});
