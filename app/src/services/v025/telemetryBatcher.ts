/**
 * telemetryBatcher.ts — Phase 3.4 RN-side bulk uploader for v025 telemetry events.
 *
 * Mirror of UnityARLib/.../v025/Telemetry/TelemetryBatcherV2.cs.
 *
 * Buffers V025Event-shaped objects in memory; flushes to backend
 * POST /api/v025/debug-events every 5 seconds OR at 100 events.
 * Re-queues on failure; bounded at 1000 events with oldest-drop overflow.
 *
 * RN side emits events when ARScreenV2 receives v025/telemetry messages from
 * Unity (Phase 3.5 wiring) AND for RN-originated events (auto-progress heartbeat,
 * spawn-rejection diagnostics that Unity didn't surface, etc.).
 */

export interface V025EventLike {
    phase: string;
    step: string;
    seq: number;
    sessionInstanceId: string;
    timestampUnixMs: number;
    outcome: string;
    diagnostic: string;
}

export const FLUSH_PERIOD_MS = 5000;
export const FLUSH_BATCH_SIZE = 100;
export const MAX_QUEUE_SIZE = 1000;

export interface TelemetryHttpResult {
    ok: boolean;
    statusCode: number;
    diagnostic: string;
}

export type TelemetryHttpClient = (url: string, jsonBody: string) => Promise<TelemetryHttpResult>;

export class TelemetryBatcher {
    private readonly _queue: V025EventLike[] = [];
    private _flushInFlight = false;

    constructor(
        private readonly _http: TelemetryHttpClient,
        private readonly _endpointUrl: string
    ) {}

    get queueLength(): number {
        return this._queue.length;
    }

    addEvent(ev: V025EventLike): void {
        if (this._queue.length >= MAX_QUEUE_SIZE) {
            // Drop oldest 10% to avoid quadratic shift on every overflow
            this._queue.splice(0, Math.floor(MAX_QUEUE_SIZE / 10));
        }
        this._queue.push(ev);
    }

    async maybeFlush(force: boolean): Promise<TelemetryHttpResult> {
        if (this._flushInFlight) return { ok: true, statusCode: 0, diagnostic: 'in flight' };
        if (this._queue.length === 0) return { ok: true, statusCode: 0, diagnostic: 'empty' };
        if (!force && this._queue.length < FLUSH_BATCH_SIZE) {
            return { ok: true, statusCode: 0, diagnostic: 'below batch size' };
        }
        this._flushInFlight = true;
        const drained = this._queue.splice(0, this._queue.length);
        try {
            const body = JSON.stringify({ events: drained });
            const result = await this._http(this._endpointUrl, body);
            if (!result.ok) {
                // Re-queue on failure
                this._queue.unshift(...drained);
                if (this._queue.length > MAX_QUEUE_SIZE) {
                    this._queue.splice(0, this._queue.length - MAX_QUEUE_SIZE);
                }
            }
            return result;
        } finally {
            this._flushInFlight = false;
        }
    }
}

/**
 * Default HTTP client backed by global fetch.
 */
export function makeFetchHttp(): TelemetryHttpClient {
    return async (url, body) => {
        try {
            const r = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
            });
            return { ok: r.ok, statusCode: r.status, diagnostic: r.ok ? 'ok' : `HTTP ${r.status}` };
        } catch (err) {
            return { ok: false, statusCode: 0, diagnostic: String(err) };
        }
    };
}
