import { deriveFriendsRequestContentState } from '../friendsRequestState';

describe('Friends Requests content state', () => {
  it.each([
    [0, 0, 'empty'],
    [2, 0, 'received'],
    [0, 2, 'sent'],
    [2, 2, 'both'],
  ] as const)('derives %s Received / %s Sent as %s', (received, sent, expected) => {
    expect(deriveFriendsRequestContentState(received, sent)).toBe(expected);
  });

  it('recomputes section visibility after final request mutations', () => {
    expect(deriveFriendsRequestContentState(0, 1 - 1)).toBe('empty');
    expect(deriveFriendsRequestContentState(2, 1 - 1)).toBe('received');
    expect(deriveFriendsRequestContentState(1 - 1, 0)).toBe('empty');
    expect(deriveFriendsRequestContentState(1 - 1, 2)).toBe('sent');
  });
});

