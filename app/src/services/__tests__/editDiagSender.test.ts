/**
 * editDiagSender.test.ts — verify v6.3 plan §1.7 telemetry contract.
 *
 * Plan §6.1 spec:
 *   "telemetryQueue.test.ts — 队列上限 + 429 + flush fail(R1v3)"
 */

// Set token + isolate the module so AppState subscription doesn't escape tests.
import {
  sendEditDiag,
  flushQueue,
  _resetForTesting,
  _peekQueueLength,
  MAX_QUEUE_SIZE,
} from '../editDiagSender';

const realFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  (global as any).fetch = fetchMock;
  (globalThis as any).fetch = fetchMock;
  _resetForTesting();
});

afterEach(() => {
  _resetForTesting();
  (global as any).fetch = realFetch;
  (globalThis as any).fetch = realFetch;
});

describe('editDiagSender — sendEditDiag basic enqueue', () => {
  test('non-key event enqueues without immediate fetch', async () => {
    sendEditDiag('brush_preview_started', { stroke_count: 1 });
    // Debounce is 5s — fetch should not yet have fired.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(_peekQueueLength()).toBe(1);
  });

  test('key event triggers immediate flush (brush_save_committed)', async () => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ id: 1, ok: true }) });
    sendEditDiag('brush_save_committed', { stroke_count: 1, distance_m: 100, has_alt: true });
    // Microtask flush — yield once to let the immediate flush run.
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(_peekQueueLength()).toBe(0);
  });

  test('key event triggers immediate flush (brush_mapbox_error)', async () => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({}) });
    sendEditDiag('brush_mapbox_error', { reason: 'timeout', ms_to_error: 8000 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('editDiagSender — bounded queue', () => {
  test('queue caps at MAX_QUEUE_SIZE; oldest dropped on overflow', async () => {
    for (let i = 0; i < MAX_QUEUE_SIZE + 5; i++) {
      sendEditDiag('brush_preview_started', { stroke_count: i });
    }
    expect(_peekQueueLength()).toBe(MAX_QUEUE_SIZE);
  });
});

describe('editDiagSender — flush behavior', () => {
  test('flushQueue posts JSON body with events array', async () => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({}) });
    sendEditDiag('brush_preview_started', { stroke_count: 2 });
    await flushQueue();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body).toHaveProperty('events');
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      kind: 'brush_preview_started',
      payload: { stroke_count: 2 },
    });
    expect(typeof body.events[0].timestamp_ms).toBe('number');
  });

  test('429 response puts batch back at head of queue', async () => {
    fetchMock.mockResolvedValue({ status: 429, json: async () => ({}) });
    sendEditDiag('brush_preview_started', { stroke_count: 1 });
    sendEditDiag('brush_preview_started', { stroke_count: 2 });
    await flushQueue();
    // Both events should still be in queue after 429.
    expect(_peekQueueLength()).toBe(2);
  });

  test('non-429 failure drops the batch (no retry storm)', async () => {
    fetchMock.mockResolvedValue({ status: 500, json: async () => ({}) });
    sendEditDiag('brush_preview_started', { stroke_count: 1 });
    await flushQueue();
    expect(_peekQueueLength()).toBe(0); // dropped
  });

  test('thrown network error drops the batch silently (no UI block)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    sendEditDiag('brush_preview_started', { stroke_count: 1 });
    await expect(flushQueue()).resolves.not.toThrow();
    expect(_peekQueueLength()).toBe(0);
  });

  test('flushQueue with empty queue does nothing', async () => {
    await flushQueue();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('concurrent flushQueue calls do not double-send (inflight guard)', async () => {
    let resolve1: (v: any) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolve1 = resolve;
        }),
    );
    sendEditDiag('brush_preview_started', { stroke_count: 1 });
    const p1 = flushQueue();
    const p2 = flushQueue();
    // Yield so first flush actually picks up the batch.
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve1({ status: 200, json: async () => ({}) });
    await Promise.all([p1, p2]);
  });
});

describe('editDiagSender — batch size cap', () => {
  test('flushQueue takes at most MAX_BATCH_SIZE per call', async () => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({}) });
    for (let i = 0; i < 25; i++) {
      sendEditDiag('brush_preview_started', { stroke_count: i });
    }
    await flushQueue();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.events.length).toBeLessThanOrEqual(10);
    expect(_peekQueueLength()).toBeGreaterThan(0); // remainder still queued
  });
});
