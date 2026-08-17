/**
 * VoiceGuidance — imperial/metric unit switching test.
 */
import { buildTurnAheadPhrase, distanceBucket } from '../VoiceGuidance';

describe('buildTurnAheadPhrase', () => {
  it('metric: short distance rounds to 10m increment', () => {
    expect(buildTurnAheadPhrase('left', 200, false)).toBe('In 200 meters, turn left.');
  });
  it('metric: long distance uses kilometers', () => {
    expect(buildTurnAheadPhrase('right', 1500, false)).toBe('In 1.5 kilometers, turn right.');
  });
  it('imperial: short distance uses yards', () => {
    // 200m ≈ 219 yards → rounds to 220
    expect(buildTurnAheadPhrase('left', 200, true)).toBe('In 220 yards, turn left.');
  });
  it('imperial: long distance uses miles', () => {
    // 3218m ≈ 2.0 miles
    expect(buildTurnAheadPhrase('right', 3218, true)).toBe('In 2.0 miles, turn right.');
  });
  it('imperial: threshold at exactly 1 mile stays in miles', () => {
    // 1609.344m = 1.0 miles
    expect(buildTurnAheadPhrase('left', 1609.344, true)).toBe('In 1.0 miles, turn left.');
  });
  it('metric: threshold at 1000m switches to km', () => {
    expect(buildTurnAheadPhrase('left', 1000, false)).toBe('In 1.0 kilometers, turn left.');
  });
});

describe('distanceBucket', () => {
  it('returns null when too far', () => {
    expect(distanceBucket(700)).toBeNull();
  });
  it('returns 500 for 400-550m', () => {
    expect(distanceBucket(500)).toBe(500);
    expect(distanceBucket(400)).toBe(500);
  });
  it('returns 300 for 250-399m', () => {
    expect(distanceBucket(300)).toBe(300);
  });
  it('returns 100 for 80-249m', () => {
    expect(distanceBucket(150)).toBe(100);
  });
  it('returns 50 for 40-79m', () => {
    expect(distanceBucket(50)).toBe(50);
  });
  it('returns null below 40m (turn-now takes over)', () => {
    expect(distanceBucket(30)).toBeNull();
  });
});
