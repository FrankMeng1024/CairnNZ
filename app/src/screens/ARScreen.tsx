/**
 * ARScreen — v0.2.5 wrapper that routes between legacy and v2 implementations
 * based on the useV025 feature flag.
 *
 * Default: useV025 = true → ARScreenV2 (Phase 2B.10 will fill in real implementation;
 * until then it falls back to legacy under the hood).
 *
 * useV025 = false → directly render ARScreenLegacy (kill-switch).
 */
import React from 'react';
import { ARScreenLegacy, ARScreenProps } from './ARScreenLegacy';
import { ARScreenV2 } from './v025/ARScreenV2';
import { useV025Enabled } from '../services/v025/featureFlagsClient';

export type { ARScreenProps } from './ARScreenLegacy';

export function ARScreen(props: ARScreenProps) {
  const useV025 = useV025Enabled();
  if (useV025) {
    return <ARScreenV2 {...props} />;
  }
  return <ARScreenLegacy {...props} />;
}
