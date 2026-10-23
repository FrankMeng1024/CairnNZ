import { memoryCameraAtTarget } from '../services/memoryCameraTransition';

describe('cross-region Memory camera readiness', () => {
  test('a stale Shanghai frame cannot satisfy a Kuala Lumpur destination', () => {
    const kualaLumpur: [number, number] = [101.6869, 3.1390];
    expect(memoryCameraAtTarget(kualaLumpur, [121.4737, 31.2304])).toBe(false);
    expect(memoryCameraAtTarget(kualaLumpur, [101.6872, 3.1392])).toBe(true);
  });
});
