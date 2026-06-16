/**
 * telemetrySingleton.ts — Phase 4 composition root, RN side.
 *
 * App-wide TelemetryBatcher instance + 5-second flush ticker.
 * Wired in App.tsx on boot; ARScreenV2 imports and emits via the singleton.
 */
import { TelemetryBatcher, makeFetchHttp, FLUSH_PERIOD_MS, type V025EventLike } from './telemetryBatcher';

let _instance: TelemetryBatcher | null = null;
let _flushTimer: ReturnType<typeof setInterval> | null = null;
let _endpoint = '';

export function initTelemetrySingleton(backendBaseUrl: string): TelemetryBatcher {
    if (_instance) return _instance;
    _endpoint = `${backendBaseUrl.replace(/\/+$/, '')}/api/v025/debug-events`;
    _instance = new TelemetryBatcher(makeFetchHttp(), _endpoint);
    // Start periodic flush ticker (5s default; matches FLUSH_PERIOD_MS).
    _flushTimer = setInterval(() => {
        // fire-and-forget; failures re-queue inside batcher
        _instance?.maybeFlush(true).catch(() => undefined);
    }, FLUSH_PERIOD_MS);
    return _instance;
}

export function getTelemetryBatcher(): TelemetryBatcher | null {
    return _instance;
}

export function emitTelemetry(ev: V025EventLike): void {
    _instance?.addEvent(ev);
}

export function tearDownTelemetry(): void {
    if (_flushTimer) {
        clearInterval(_flushTimer);
        _flushTimer = null;
    }
    _instance = null;
}
