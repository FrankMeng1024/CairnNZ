/**
 * ARScreenV2 — v0.2.5 placeholder.
 *
 * IMPORTANT — Phase 0 stub semantics:
 *   This stub renders ARScreenLegacy directly. It is NOT the real v025 path.
 *   Phase 2B.10 will replace this implementation with the v025 cairn assembly.
 *
 *   Rule M.4 (Phase 3 telemetry) MUST distinguish:
 *     - useV025=true AND ARScreenV2 = stub        (this state, Phase 0..2A)
 *     - useV025=true AND ARScreenV2 = real        (Phase 2B.10+)
 *     - useV025=false                              (kill switch active)
 *   The stub emits a telemetry breadcrumb so analytics during Phase 0..2A are not
 *   misattributed to the real v025 path.
 *
 *   Path: app/src/screens/v025/ARScreenV2.tsx per v0.2.5 plan §架构总览.
 */
import React, { useEffect } from 'react';
import { ARScreenLegacy, ARScreenProps } from '../ARScreenLegacy';
import { crashLogger } from '../../services/crashLogger';

export const AR_SCREEN_V2_BUILD_TAG = 'phase0_stub_legacy_delegate';

export function ARScreenV2(props: ARScreenProps) {
  useEffect(() => {
    // Mark every render so Phase 3 telemetry can split flag-on-but-stub from
    // flag-on-and-real. Cheap breadcrumb; no network.
    try {
      crashLogger.breadcrumb('arscreenv2_stub_rendered:' + AR_SCREEN_V2_BUILD_TAG);
    } catch {
      // breadcrumb storage missing — non-fatal, continue rendering
    }
  }, []);
  return <ARScreenLegacy {...props} />;
}
