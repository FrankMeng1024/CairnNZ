const baseConfig = require('./app.json').expo;

const BUILD57_DIAGNOSTIC_RUNTIME = '0.2.6-build57diag1';
// Build 63 introduces the truthful passive-background Memory location/privacy
// contract. Keep O66 in its own runtime domain so Build 62/O65 can never select
// this candidate or any future O66 OTA update.
const O66_OWNER_RUNTIME = '0.2.6-o66';

module.exports = () => {
  const diagnosticEnabled = process.env.CAIRN_BUILD57_DIAGNOSTIC === 'true';
  if (!diagnosticEnabled) {
    return {
      ...baseConfig,
      runtimeVersion: O66_OWNER_RUNTIME,
      updates: {
        ...baseConfig.updates,
        enabled: true,
        checkAutomatically: 'ON_LOAD',
        fallbackToCacheTimeout: 0,
      },
    };
  }

  return {
    ...baseConfig,
    runtimeVersion: BUILD57_DIAGNOSTIC_RUNTIME,
    updates: {
      ...baseConfig.updates,
      enabled: false,
      checkAutomatically: 'NEVER',
      fallbackToCacheTimeout: 0,
    },
    ios: {
      ...baseConfig.ios,
      infoPlist: {
        ...baseConfig.ios.infoPlist,
        // Diagnostic-only: expose the append-only startup receipt through
        // Finder/iTunes file sharing after a pre-render crash.
        UIFileSharingEnabled: true,
        LSSupportsOpeningDocumentsInPlace: true,
      },
    },
    plugins: [
      ...baseConfig.plugins,
      './plugins/withBuild57StartupProbe',
    ],
    extra: {
      ...baseConfig.extra,
      build57Diagnostic: {
        enabled: true,
        runtimeVersion: BUILD57_DIAGNOSTIC_RUNTIME,
        embeddedOnly: true,
      },
    },
  };
};
