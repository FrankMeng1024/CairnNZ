/**
 * devFlags.test — verify Playwright bypass NEVER activates in production builds.
 * This is a security-critical test: a regression here would auto-login real users
 * as the test account.
 */

describe('devFlags.isPlaywrightBypass', () => {
  const originalEnv = process.env;
  const originalDev = (global as any).__DEV__;

  afterEach(() => {
    process.env = originalEnv;
    (global as any).__DEV__ = originalDev;
    jest.resetModules();
  });

  it('is FALSE when __DEV__ is false (production build), even if env var is "true"', () => {
    (global as any).__DEV__ = false;
    process.env = { ...originalEnv, EXPO_PUBLIC_PLAYWRIGHT_BYPASS: 'true' };
    jest.resetModules();
    const { isPlaywrightBypass } = require('../src/utils/devFlags');
    expect(isPlaywrightBypass).toBe(false);
  });

  it('is FALSE when env var is unset (no bypass without explicit opt-in)', () => {
    (global as any).__DEV__ = true;
    process.env = { ...originalEnv };
    delete process.env.EXPO_PUBLIC_PLAYWRIGHT_BYPASS;
    jest.resetModules();
    const { isPlaywrightBypass } = require('../src/utils/devFlags');
    expect(isPlaywrightBypass).toBe(false);
  });

  it('is FALSE when env var is empty string (EAS profile override)', () => {
    (global as any).__DEV__ = true;
    process.env = { ...originalEnv, EXPO_PUBLIC_PLAYWRIGHT_BYPASS: '' };
    jest.resetModules();
    const { isPlaywrightBypass } = require('../src/utils/devFlags');
    expect(isPlaywrightBypass).toBe(false);
  });

  it('is FALSE when env var is "false"', () => {
    (global as any).__DEV__ = true;
    process.env = { ...originalEnv, EXPO_PUBLIC_PLAYWRIGHT_BYPASS: 'false' };
    jest.resetModules();
    const { isPlaywrightBypass } = require('../src/utils/devFlags');
    expect(isPlaywrightBypass).toBe(false);
  });

  it('is TRUE only when __DEV__ AND env var is exactly "true"', () => {
    (global as any).__DEV__ = true;
    process.env = { ...originalEnv, EXPO_PUBLIC_PLAYWRIGHT_BYPASS: 'true' };
    jest.resetModules();
    const { isPlaywrightBypass } = require('../src/utils/devFlags');
    expect(isPlaywrightBypass).toBe(true);
  });
});
