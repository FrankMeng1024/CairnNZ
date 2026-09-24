import fs from 'node:fs';
import path from 'node:path';

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, '..', '..', relative), 'utf8');

describe('Owner device Batch 01 source contracts', () => {
  test('auth entry is responsive, private and uses native OTP semantics', () => {
    const source = read('screens/AuthScreen.tsx');
    expect(source).toContain('Opening sign in…');
    expect(source).toContain("handleViewChange('login')");
    expect(source).toContain('login_auth_state_published');
    expect(source).not.toContain('login_settimeout_fired');
    expect(source).not.toContain('Remember me on this device');
    expect(source).not.toContain('requestForegroundPermissionsAsync');
    expect(source).toContain('autoFocus');
    expect(source).toContain("textContentType={i === 0 ? 'oneTimeCode' : 'none'}");
    expect(source).not.toContain("require('expo-clipboard')");
  });

  test('owner QA is hidden behind five Settings taps and ordinary Home has no QA entry', () => {
    const settings = read('screens/SettingsScreen.tsx');
    const home = read('screens/HomeScreen.tsx');
    expect(settings).toContain('qaTapCount.current < 5');
    expect(settings).toContain("updateSetting('debugMode', true)");
    expect(settings).toContain("navigation.navigate('Debug')");
    expect(home).not.toContain('testID="internal-qa-entry"');
  });

  test('warm map overlays avoid flashes and Memory distinguishes Fog restoration', () => {
    const activityMap = read('screens/HikingMap.tsx');
    const memoryMap = read('features/memory/components/MemoryMap.tsx');
    const memory = read('features/memory/screens/MemoryScreen.tsx');
    expect(activityMap).toContain('delayMs={activityMapHasRendered ? 280 : 0}');
    expect(memoryMap).toContain('delayMs={memoryMapHasRendered ? 280 : 0}');
    expect(memory).toContain('Restoring Memory…');
    expect(memory).not.toContain('Map still loading…');
    expect(memory).toContain('if (!mapReady) return;');
  });

  test('Home uses actionable balanced recent activity language', () => {
    const home = read('screens/HomeScreen.tsx');
    const generated = read('screens/home_generated/HomeScreen.generated.tsx');
    expect(home).toContain("'Paused hike'");
    expect(home).not.toContain("['Interrupted', 'Resume'");
    expect(home).toContain("return `${minutes} min ago`");
    expect(generated).toContain('lastHikeAction');
    expect(generated).toContain('H1__last_hike_card__action');
  });

  test('Cairn sheet does not display a false drag affordance', () => {
    const sheet = read('features/marks/components/MarkDetailSheet.tsx');
    expect(sheet).toContain('showHandle={false}');
  });
});
