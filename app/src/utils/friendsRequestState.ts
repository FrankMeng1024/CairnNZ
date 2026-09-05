export type FriendsRequestContentState = 'empty' | 'received' | 'sent' | 'both';

export function deriveFriendsRequestContentState(
  receivedCount: number,
  sentCount: number,
): FriendsRequestContentState {
  if (receivedCount > 0 && sentCount > 0) return 'both';
  if (receivedCount > 0) return 'received';
  if (sentCount > 0) return 'sent';
  return 'empty';
}

