/**
 * ARScreenV2 — v0.2.5 placeholder.
 *
 * Phase 2B.10 will replace this stub with the full v025 cairn assembly + Unity bridge.
 * Until then, when feature flag useV025 = true and this stub is reached, we delegate
 * back to the legacy implementation so users are never stranded.
 *
 * NOTE: this file lives at app/src/screens/v025/ARScreenV2.tsx per v0.2.5 plan §架构总览.
 */
import React from 'react';
import { ARScreenLegacy, ARScreenProps } from '../ARScreenLegacy';

export function ARScreenV2(props: ARScreenProps) {
  // Phase 0 stub: legacy fallback. Phase 2B.10 fills in real implementation.
  return <ARScreenLegacy {...props} />;
}
