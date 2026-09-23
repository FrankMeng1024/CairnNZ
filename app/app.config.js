const baseConfig = require('./app.json').expo;

const BUILD57_DIAGNOSTIC_RUNTIME = '0.2.6-build57diag1';
// Build 61 proved the current embedded O61 source after the missing native
// ExpoCrypto module was linked. Keep the next normal owner-test/RC binary on
// a new explicit runtime so it can receive subsequent O61 UI OTAs without
// ever selecting the historical 0.2.6 / O56 update group.
const O61_OWNER_RUNTIME = '0.2.6-o61';

module.exports = () => {
  const diagnosticEnabled = process.env.CAIRN_BUILD57_DIAGNOSTIC === 'true';
  if (!diagnosticEnabled) {
    return {
      ...baseConfig,
      runtimeVersion: O61_OWNER_RUNTIME,
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
