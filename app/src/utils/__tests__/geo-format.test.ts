import { formatDuration } from '../geo';

describe('formatDuration', () => {
  it('never exposes fractional provider seconds', () => {
    expect(formatDuration(90.679000000000002)).toBe('01:30');
  });

  it('fails closed for invalid or negative durations', () => {
    expect(formatDuration(Number.NaN)).toBe('00:00');
    expect(formatDuration(-1)).toBe('00:00');
  });
});
