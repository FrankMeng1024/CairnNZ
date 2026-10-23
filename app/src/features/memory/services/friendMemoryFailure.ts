export type FriendMemoryFailure = 'offline' | 'unavailable' | 'unauthorized';

export function classifyFriendMemoryFailure(input: {
  httpStatus?: number;
  timedOut?: boolean;
}): FriendMemoryFailure {
  if (input.httpStatus === 401 || input.httpStatus === 403) return 'unauthorized';
  if (Number.isFinite(input.httpStatus)) return 'unavailable';
  return 'offline';
}
