import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '../../..');
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), 'utf8');

describe('Settings product and correctness convergence', () => {
  const settings = read('src/screens/SettingsScreen.tsx');

  test('root is the accepted four-group product surface', () => {
    const root = settings.slice(settings.indexOf('const renderRoot'), settings.indexOf('const renderAccount'));
    expect(root.match(/<SectionTitle[^>]*>[^<]+<\/SectionTitle>/g)).toHaveLength(4);
    for (const title of ['Account', 'Preferences', 'Privacy & Data', 'Help & About']) {
      expect(root).toContain(`>${title}</SectionTitle>`);
    }
    for (const removed of ['Weather', "What's New", 'Safety report', 'Date format', 'Map layer', 'Exploration stats']) {
      expect(root).not.toContain(removed);
    }
  });

  test('account actions are provider-aware and destructive behavior is secondary', () => {
    const account = settings.slice(settings.indexOf('const renderAccount'), settings.indexOf('const renderExportState'));
    expect(account).toContain('user?.hasPassword === true');
    expect(account).toContain('Password managed by your provider');
    expect(account).toContain('Account email · not currently changeable in the app');
    expect(account).toContain('Seven days to restore, then permanent deletion');
    const root = settings.slice(settings.indexOf('const renderRoot'), settings.indexOf('const renderAccount'));
    expect(root).not.toContain('Delete account');
  });

  test('local preferences remain immediate and truthfully scoped', () => {
    expect(settings).toContain("{ key: 'metric', label: 'Metric' }");
    expect(settings).toContain("{ key: 'imperial', label: 'Imperial' }");
    for (const appearance of ['Auto', 'Day', 'Sunset', 'Night']) expect(settings).toContain(`label: '${appearance}'`);
    expect(settings).toContain('Updates exploration outside an Activity while the app is on screen');
    expect(settings).toContain('On in Cairn · unavailable until foreground location is allowed in iOS');
    expect(settings).toContain("updateSetting('hapticFeedback'");
  });

  test('server-owned actions cannot claim optimistic success', () => {
    expect(settings).toContain("feedbackState === 'sending'");
    expect(settings).toContain('if (result.acknowledged)');
    expect(settings).toContain('const ownerId = renderedOwnerId');
    expect(settings).toContain('|| feedbackFlight.current) return');
    expect(settings).toContain('generation !== feedbackGeneration.current');
    expect(settings).toContain('if (exportFlight.current) return');
    expect(settings).toContain('if (!ownerId || currentOwnerId() !== ownerId || deleteFlight.current) return');
    expect(settings).toContain('Delivered to Cairn');
    expect(settings).toContain('Retry delivery');
    expect(settings).toContain("latestExport.status === 'queued' || latestExport.status === 'building'");
    expect(settings).toContain('Ready to download');
    expect(settings).toContain('The export could not be prepared');
    expect(settings).toContain("result.localCleanup !== 'complete' && result.durableCleanupScheduled === false");
    expect(settings).toContain('Do not sign another account into this installation; reinstall Cairn first.');
  });

  test('normal Settings owns no Debug or emergency product entry', () => {
    expect(settings).not.toContain('Open Debug');
    expect(settings).not.toContain('developer unlock');
    expect(settings).not.toContain('Safety report');
    expect(settings).toContain('Feedback is not an emergency or monitored safety service.');
  });

  test('Settings reuses Cairn visual authority for all scenic appearances', () => {
    for (const shared of ['ContentSurface', 'SegmentedControl', 'PrimaryButton', 'ModalCard', 'BackButton', 'useVisualTheme']) {
      expect(settings).toContain(shared);
    }
    expect(settings).toContain('getHomeBackground(');
    expect(settings).toContain('background.settingsCardBackgroundColor');
    expect(settings).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  test('legacy Settings keys have migration-only presence and no runtime authority', () => {
    const store = read('src/store/useSettingsStore.ts');
    const contract = store.slice(store.indexOf('interface Settings {'), store.indexOf('const STORAGE_KEY'));
    const pick = store.slice(store.indexOf('function pick'));
    for (const key of ['nightMode', 'dateFormat', 'voiceGuidance', 'offRouteThresholdM', 'showExplorationPercent']) {
      expect(store).toContain(`'${key}'`);
      expect(contract).not.toContain(`${key}:`);
      expect(pick).not.toContain(`${key}:`);
    }
    const memory = read('src/features/memory/store/useMemorySettingsStore.ts');
    expect(memory).not.toContain('recordMode:');
    expect(memory).not.toContain('showFriendOverlay:');
    expect(memory).not.toContain('useH3Fog:');
    expect(read('src/features/memory/components/FogLayer.tsx')).not.toContain('useH3Fog');
  });

  test('units and locale formatting propagate outside the Settings label', () => {
    const home = read('src/screens/HomeScreen.tsx');
    const dates = read('src/utils/dateFormat.ts');
    expect(home).toContain('const distance = useDistance()');
    expect(home).toContain('distance.format(meters, 1)');
    expect(home).not.toContain('function formatDistanceKm');
    expect(dates).toContain('Intl.DateTimeFormat');
    expect(dates).not.toContain('useSettingsStore');
  });

  test('Debug has a separate build-gated owner', () => {
    const home = read('src/screens/HomeScreen.tsx');
    const debug = read('src/screens/DebugScreen.tsx');
    const capability = read('src/features/activitySimulator/capability.ts');
    expect(home).toContain('qaToolsAvailable');
    expect(home).toContain("nav.navigate('Debug')");
    expect(debug).toContain('activitySimulatorBuildCapable');
    expect(capability).toContain("EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED === 'true'");
  });

  test('generic operational logs are privacy-scrubbed before entering the queue', () => {
    const appLog = read('src/services/appLog.ts');
    expect(appLog).toContain("import { sanitizeTelemetryEventForUpload } from './telemetryPrivacy'");
    expect(appLog.indexOf('sanitizeTelemetryEventForUpload({ ctx })')).toBeLessThan(appLog.indexOf('queue.push({'));
  });

  test('internal session telemetry cannot be force-enabled by a normal product screen', () => {
    const routeEditor = read('src/screens/RouteEditorScreen.tsx');
    const uploader = read('src/services/telemetryUploader.ts');
    expect(routeEditor).not.toContain('debugLogger.setEnabled(true)');
    expect(routeEditor).toContain('if (!qaToolsAvailable || !debugMode) return');
    expect(uploader.match(/Internal QA upload is not authorized/g)).toHaveLength(2);
    expect(uploader).toContain('settings.debugMode');
    expect(uploader).toContain('activitySimulatorBuildCapable');
  });
});
