import { create } from 'zustand';
import type { MultiPolygon } from 'geojson';
import { authenticatedFetch } from '../../../services/apiService';
import { useAppStore } from '../../../store/useAppStore';
import { log } from '../../../services/appLog';
import type { MemoryCoverageViewport } from '../services/memoryCoverageViewport';

export interface PreparedMemoryCoverage {
  viewportKey: string;
  coverageVersion: string;
  coverageRuleVersion: number;
  geometry: MultiPolygon;
  evidenceCount: number;
  loadedAtMs: number;
}

interface PreparedMemoryCoverageState {
  userId: string | null;
  coverage: PreparedMemoryCoverage | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  version: number;
  viewport: MemoryCoverageViewport | null;
  loadViewport: (viewport: MemoryCoverageViewport, force?: boolean) => Promise<void>;
  refreshCurrentViewport: () => Promise<void>;
  reset: () => void;
}

let requestSequence = 0;
let activeRequestController: AbortController | null = null;
export const PREPARED_MEMORY_COVERAGE_TIMEOUT_MS = 5_000;

function validGeometry(value: any): value is MultiPolygon {
  return value?.type === 'MultiPolygon' && Array.isArray(value.coordinates);
}

export const usePreparedMemoryCoverageStore = create<PreparedMemoryCoverageState>((set, get) => ({
  userId: null,
  coverage: null,
  status: 'idle',
  error: null,
  version: 0,
  viewport: null,

  loadViewport: async (viewport, force = false) => {
    const userId = String(useAppStore.getState().user?.id ?? '');
    if (!userId) return;
    if (get().userId === userId
      && get().coverage?.viewportKey === viewport.key
      && get().status === 'ready'
      && !force) return;
    const sequence = ++requestSequence;
    activeRequestController?.abort();
    const controller = new AbortController();
    activeRequestController = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, PREPARED_MEMORY_COVERAGE_TIMEOUT_MS);
    const accountChanged = get().userId !== userId;
    set({
      userId,
      viewport,
      coverage: accountChanged ? null : get().coverage,
      status: 'loading',
      error: null,
      version: accountChanged ? get().version + 1 : get().version,
    });
    const requestStartedAtMs = Date.now();
    try {
      const response = await authenticatedFetch(
        `/api/memory/coverage?bbox=${encodeURIComponent(viewport.bbox.join(','))}`,
        { expectedUserId: userId, signal: controller.signal },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      const responseParsedAtMs = Date.now();
      if (sequence !== requestSequence
        || String(useAppStore.getState().user?.id ?? '') !== userId
        || get().userId !== userId) return;
      if (!validGeometry(body?.geometry)
        || Number(body?.coverage_rule_version) !== 4) {
        throw new Error('Invalid prepared Memory coverage');
      }
      set({
        coverage: {
          viewportKey: viewport.key,
          coverageVersion: String(body.coverage_version ?? ''),
          coverageRuleVersion: Number(body.coverage_rule_version),
          geometry: body.geometry,
          evidenceCount: Number(body.evidence_count) || 0,
          loadedAtMs: Date.now(),
        },
        status: 'ready',
        error: null,
        version: get().version + 1,
      });
      log('o86.memory.mine_coverage_ready', {
        request_ms: responseParsedAtMs - requestStartedAtMs,
        total_ms: Number(body?.total_ms) || 0,
        evidence_n: Number(body?.evidence_count) || 0,
        tile_n: Number(body?.tile_count) || 0,
        rebuilt_tile_n: Number(body?.rebuilt_tile_count) || 0,
        geometry_components_n: body.geometry.coordinates.length,
        stage_ms: body?.stage_ms ?? {},
        forced: force,
      });
      // The response is generated after trusted ingestion and rebuilds stale
      // server tiles on demand. It can now take over any ACKed local overlay.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./useMemoryStore').useMemoryStore.getState().acknowledgePreparedCoverage();
    } catch (error: any) {
      if (sequence !== requestSequence || get().userId !== userId) return;
      log('o86.memory.mine_coverage_failed', {
        request_ms: Date.now() - requestStartedAtMs,
        error: String(error?.message ?? error).slice(0, 100),
      });
      set({
        status: 'error',
        error: timedOut ? 'Memory coverage timed out' : error?.message || 'Unavailable',
        version: get().version + 1,
      });
    } finally {
      clearTimeout(timeout);
      if (activeRequestController === controller) activeRequestController = null;
    }
  },

  refreshCurrentViewport: async () => {
    const viewport = get().viewport;
    if (viewport) await get().loadViewport(viewport, true);
  },

  reset: () => {
    requestSequence += 1;
    activeRequestController?.abort();
    activeRequestController = null;
    set({ userId: null, coverage: null, status: 'idle', error: null, viewport: null, version: get().version + 1 });
  },
}));
