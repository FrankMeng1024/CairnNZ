import { resolveActivityDetailBackAction } from '../activityDetailNavigation';

describe('Activity Detail Back context', () => {
  test('pops a retained Home or Cairn parent only when explicitly requested', () => {
    expect(resolveActivityDetailBackAction('previous', true)).toBe('go-back');
  });

  test('falls back safely when an explicit previous parent is unavailable', () => {
    expect(resolveActivityDetailBackAction('previous', false)).toBe('canonical-activities');
  });

  test('keeps Trails, Finish, QA and direct entry on canonical Activities', () => {
    expect(resolveActivityDetailBackAction('activities', true)).toBe('canonical-activities');
    expect(resolveActivityDetailBackAction(undefined, true)).toBe('canonical-activities');
    expect(resolveActivityDetailBackAction(undefined, false)).toBe('canonical-activities');
  });
});
