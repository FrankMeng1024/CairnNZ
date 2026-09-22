const baseConfig = require('./app.json').expo;

const BUILD57_DIAGNOSTIC_RUNTIME = '0.2.6-build57diag1';

module.exports = () => {
  const diagnosticEnabled = process.env.CAIRN_BUILD57_DIAGNOSTIC === 'true';
  if (!diagnosticEnabled) return baseConfig;

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

