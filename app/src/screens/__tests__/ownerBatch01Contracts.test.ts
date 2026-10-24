import fs from 'node:fs';
import path from 'node:path';

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, '..', '..', relative), 'utf8');

describe('Owner device Batch 01 source contracts', () => {
  test('auth entry is responsive, private and uses native OTP semantics', () => {
    const source = read('screens/AuthScreen.tsx');
    const catalog = read('i18n/cairnText.ts');
    // REVISE_WITH_REASON: visible copy now has one catalog authority; the
    // source contract must assert the key wiring rather than duplicate English.
    expect(source).toContain("cairnText('auth-screen.opening-sign-in')");
    expect(catalog).toContain("'en-NZ': 'Opening sign in…'");
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
    expect(settings).toContain("activitySimulatorBuildCapable ? 'Debug' : 'RouteDrawingDiagnostics'");
    const routeDiagnostics = read('screens/RouteDrawingDiagnosticsScreen.tsx');
    expect(routeDiagnostics).toContain('testID="route-owner-trace-toggle"');
    expect(routeDiagnostics).toContain("nav.navigate('RouteDrawingReplay'");
    expect(routeDiagnostics).toContain('exportRouteDrawingTrace');
    expect(routeDiagnostics).not.toContain('telemetryApiKey');
    expect(home).not.toContain('testID="internal-qa-entry"');
  });

  test('warm map overlays avoid flashes and Memory distinguishes Fog restoration', () => {
    const activityMap = read('screens/HikingMap.tsx');
    const memoryMap = read('features/memory/components/MemoryMap.tsx');
    const memory = read('features/memory/screens/MemoryScreen.tsx');
    expect(activityMap).toContain('delayMs={activityMapHasRendered ? 280 : 0}');
    expect(memoryMap).toContain('delayMs={memoryMapHasRendered ? 280 : 0}');
    expect(memory).toContain('testID="memory-entry-veil"');
    expect(memory).toContain('delayMs={authorizedPreviewUri ? MEMORY_WARM_ENTRY_MESSAGE_DELAY_MS : MEMORY_ENTRY_MESSAGE_DELAY_MS}');
    expect(memory).not.toContain('Map still loading…');
    expect(memory).not.toContain('PREPARING YOUR MAP');
    expect(memory).not.toContain('Restoring Memory…');
  });

  test('Home uses actionable balanced recent activity language', () => {
    const home = read('screens/HomeScreen.tsx');
    const generated = read('screens/home_generated/HomeScreen.generated.tsx');
    const catalog = read('i18n/cairnText.ts');
    expect(home).toContain("case 'paused'");
    expect(home).toContain("case 'resuming'");
    expect(home).toContain("case 'finishing'");
    expect(home).not.toContain("['Interrupted', 'Resume'");
    expect(home).toContain("return cairnText('home-screen.value-min-ago', { minutes: minutes })");
    expect(catalog).toContain("'en-NZ': '{minutes} min ago'");
    expect(generated).not.toContain('lastHikeAction');
    expect(generated).toContain('H1__last_hike_card__action');
  });

  test('Cairn sheet does not display a false drag affordance', () => {
    const sheet = read('features/marks/components/MarkDetailSheet.tsx');
    expect(sheet).toContain('showHandle={false}');
    expect(sheet).toContain('backdropVariant="mapPreview"');
    const frame = read('components/BottomSheetFrame.tsx');
    expect(frame).toContain("backdropVariant === 'mapPreview' ? 'transparent' : theme.scrim");
    expect(frame).toContain('accessibilityViewIsModal');
  });

  test('Plant pin heading follows the semantic visual theme', () => {
    const pinAdjust = read('features/plant/components/PinAdjustStep.tsx');
    expect(pinAdjust).toContain("import { useVisualTheme } from '../../../hooks/useVisualTheme'");
    expect(pinAdjust).toContain("styles.title, { color: theme.foreground }");
    expect(pinAdjust).toContain("styles.sub, { color: theme.foregroundSecondary }");
    expect(pinAdjust).not.toContain('color: Colors.textPrimary,\n    marginTop: Spacing.md');
  });

  test('narrow Web QA uses the real device viewport instead of cropping the laptop preview shell', () => {
    const app = read('../App.tsx');
    const routeEditor = read('screens/OrderedRouteEditorScreen.tsx');
    expect(app).toContain('const useDeviceViewport = viewportWidth <= 430');
    expect(app).toContain("width: useDeviceViewport ? '100%' : 430");
    expect(app).toContain("height: useDeviceViewport ? '100%' : 932");
    expect(app).toContain("transform: useDeviceViewport ? 'none' : `scale(${SCALE})`");
    expect(routeEditor).toContain('compactViewport ? Spacing.sm : Spacing.md');
    expect(routeEditor).toContain('compactSaveAction: { minHeight: 44');
    expect(routeEditor).toContain('nameSaveRow: { minHeight: 44');
  });

  test('pending Activity discard uses the shared modal inside the live Session card', () => {
    const history = read('screens/MapHistoryScreen.tsx');
    const sessionCard = history.slice(
      history.indexOf('function SessionCard'),
      history.indexOf('// ── Flag detail bottom sheet'),
    );
    const redirect = history.slice(history.indexOf('function TrailsIndexRedirect'));
    expect(sessionCard).toContain('testID="pending-activity-discard-confirmation"');
    expect(sessionCard).toContain("label={cairnText('map-history-screen.keep-activity')}");
    expect(sessionCard).toContain("label={cairnText('map-history-screen.discard-activity')}");
    expect(redirect).not.toContain('pending-activity-discard-confirmation');
  });
});
