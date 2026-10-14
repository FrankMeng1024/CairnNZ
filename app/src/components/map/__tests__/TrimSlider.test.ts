import { precisionTrimDeltaPx } from '../TrimSlider';

describe('TrimSlider precision transfer', () => {
  test('small drags remain fine-grained while long drags keep useful travel', () => {
    expect(precisionTrimDeltaPx(8)).toBe(4);
    expect(precisionTrimDeltaPx(-20)).toBe(-10);
    expect(precisionTrimDeltaPx(64)).toBe(48);
  });
});
