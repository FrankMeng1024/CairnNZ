/**
 * telemetryBatcher.test.ts
 */
import {
    TelemetryBatcher,
    FLUSH_BATCH_SIZE,
    MAX_QUEUE_SIZE,
    type V025EventLike,
    type TelemetryHttpClient,
} from '../telemetryBatcher';

function ev(seq: number, outcome = 'success', diagnostic = ''): V025EventLike {
    return {
        phase: 'v22-SPAWN',
        step: 'test',
        seq,
        sessionInstanceId: 'session-1',
        timestampUnixMs: 1719000000000,
        outcome,
        diagnostic,
    };
}

function makeFakeHttp(returnOk = true): {
    client: TelemetryHttpClient;
    bodies: string[];
    setReturnOk: (v: boolean) => void;
} {
    let ok = returnOk;
    const bodies: string[] = [];
    return {
        bodies,
        setReturnOk: (v) => {
            ok = v;
        },
        client: async (_url, body) => {
            bodies.push(body);
            return { ok, statusCode: ok ? 200 : 500, diagnostic: ok ? 'ok' : 'fake err' };
        },
    };
}

describe('TelemetryBatcher (RN)', () => {
    test('addEvent increases queue length', () => {
        const fh = makeFakeHttp();
        const b = new TelemetryBatcher(fh.client, 'http://x');
        b.addEvent(ev(1));
        b.addEvent(ev(2));
        expect(b.queueLength).toBe(2);
    });

    test('forced flush with small queue posts body', async () => {
        const fh = makeFakeHttp();
        const b = new TelemetryBatcher(fh.client, 'http://x');
        b.addEvent(ev(1));
        await b.maybeFlush(true);
        expect(fh.bodies).toHaveLength(1);
        expect(fh.bodies[0]).toContain('"phase":"v22-SPAWN"');
        expect(b.queueLength).toBe(0);
    });

    test('non-forced flush below batch size does nothing', async () => {
        const fh = makeFakeHttp();
        const b = new TelemetryBatcher(fh.client, 'http://x');
        b.addEvent(ev(1));
        await b.maybeFlush(false);
        expect(fh.bodies).toHaveLength(0);
        expect(b.queueLength).toBe(1);
    });

    test('flush at batch size auto-flushes without force', async () => {
        const fh = makeFakeHttp();
        const b = new TelemetryBatcher(fh.client, 'http://x');
        for (let i = 0; i < FLUSH_BATCH_SIZE; i++) b.addEvent(ev(i));
        await b.maybeFlush(false);
        expect(fh.bodies).toHaveLength(1);
        expect(b.queueLength).toBe(0);
    });

    test('flush failure re-queues events', async () => {
        const fh = makeFakeHttp(false);
        const b = new TelemetryBatcher(fh.client, 'http://x');
        b.addEvent(ev(1));
        b.addEvent(ev(2));
        await b.maybeFlush(true);
        expect(fh.bodies).toHaveLength(1);
        expect(b.queueLength).toBe(2);
    });

    test('queue overflow drops oldest', () => {
        const fh = makeFakeHttp();
        const b = new TelemetryBatcher(fh.client, 'http://x');
        for (let i = 0; i < MAX_QUEUE_SIZE + 50; i++) b.addEvent(ev(i));
        expect(b.queueLength).toBeLessThanOrEqual(MAX_QUEUE_SIZE);
    });

    test('serialized body includes events array', async () => {
        const fh = makeFakeHttp();
        const b = new TelemetryBatcher(fh.client, 'http://x');
        b.addEvent(ev(1));
        b.addEvent(ev(2));
        await b.maybeFlush(true);
        const parsed = JSON.parse(fh.bodies[0]);
        expect(parsed.events).toHaveLength(2);
        expect(parsed.events[0].seq).toBe(1);
    });
});
