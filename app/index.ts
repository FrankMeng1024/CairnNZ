/* eslint-disable @typescript-eslint/no-require-imports */

const build57DiagnosticEnabled =
  process.env.EXPO_PUBLIC_BUILD57_DIAGNOSTIC === 'true';

function startApplication(): void {
  if (!build57DiagnosticEnabled) {
    // Preserve the normal O61 entry order and behavior for every existing
    // non-diagnostic profile.
    const { registerRootComponent } = require('expo');
    const App = require('./App').default;
    registerRootComponent(App);
    return;
  }

  type NativeProbe = {
    recordSync?: (phase: string, fields: Record<string, unknown>) => boolean;
  };
  let nativeProbe: NativeProbe | null = null;
  try {
    nativeProbe = require('react-native').NativeModules.Build57StartupProbe ?? null;
  } catch {
    nativeProbe = null;
  }
  const record = (phase: string, fields: Record<string, unknown> = {}): boolean => {
    try {
      return nativeProbe?.recordSync?.(phase, fields) === true;
    } catch {
      return false;
    }
  };

  record('js_entry', {
    diagnosticEnabled: true,
    visibleCandidate: 'O61',
  });

  const {
    diagnosticErrorFields,
    installFirstBackendFetchProbe,
  } = require('./src/diagnostics/build57StartupProbe') as typeof import('./src/diagnostics/build57StartupProbe');

  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
  record('environment_config', {
    apiOrigin: (() => {
      try { return new URL(apiBaseUrl).origin; } catch { return 'invalid'; }
    })(),
    activitySimulatorEnabled:
      process.env.EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED === 'true',
    playwrightBypassEnabled:
      process.env.EXPO_PUBLIC_PLAYWRIGHT_BYPASS === 'true',
  });

  try {
    const Updates = require('expo-updates') as typeof import('expo-updates');
    record('expo_updates_state', {
      isEnabled: Updates.isEnabled,
      updateId: Updates.updateId,
      channel: Updates.channel,
      runtimeVersion: Updates.runtimeVersion,
      checkAutomatically: Updates.checkAutomatically,
      isEmbeddedLaunch: Updates.isEmbeddedLaunch,
      isEmergencyLaunch: Updates.isEmergencyLaunch,
      emergencyLaunchReason: Updates.emergencyLaunchReason,
      launchDurationMs: Updates.launchDuration,
    });
  } catch (error) {
    record('expo_updates_state_failed', diagnosticErrorFields(error));
  }

  installFirstBackendFetchProbe(record, apiBaseUrl);

  let registerRootComponent: typeof import('expo').registerRootComponent;
  try {
    record('expo_module_load_start');
    registerRootComponent = require('expo').registerRootComponent;
    record('expo_module_loaded');
  } catch (error) {
    record('expo_module_load_failed', diagnosticErrorFields(error));
    throw error;
  }

  let App: typeof import('./App').default;
  try {
    record('before_app_require');
    App = require('./App').default;
    record('after_app_require');
  } catch (error) {
    record('app_require_failed', diagnosticErrorFields(error));
    throw error;
  }

  const React = require('react') as typeof import('react');
  let rootEntered = false;
  function Build57DiagnosticRoot(props: Record<string, unknown>) {
    if (!rootEntered) {
      rootEntered = true;
      record('root_component_enter');
    }
    React.useEffect(() => {
      record('first_react_commit');
    }, []);
    return React.createElement(App, props);
  }

  try {
    record('before_root_registration');
    registerRootComponent(Build57DiagnosticRoot);
    record('root_registered');
  } catch (error) {
    record('root_registration_failed', diagnosticErrorFields(error));
    throw error;
  }
}

startApplication();
