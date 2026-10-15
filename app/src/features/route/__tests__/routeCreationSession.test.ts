import {
  activityCreationDraftId,
} from '../routeCreationSession';

describe('fresh Route creation session identity', () => {
  test('the source Activity is a template while each explicit Create owns a distinct draft', () => {
    const first = { creationSource: 'activity' as const, fromSessionId: 'goood', creationSessionId: 'create-a' };
    const second = { ...first, creationSessionId: 'create-b' };
    expect(activityCreationDraftId(first)).toBe('activity:goood:create-a');
    expect(activityCreationDraftId(second)).toBe('activity:goood:create-b');
    expect(activityCreationDraftId(first)).not.toBe(activityCreationDraftId(second));
  });
});
