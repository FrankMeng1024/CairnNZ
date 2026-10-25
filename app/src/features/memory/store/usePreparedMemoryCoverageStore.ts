import { create } from 'zustand';
import type { MultiPolygon } from 'geojson';
import { authenticatedFetch } from '../../../services/apiService';
import { useAppStore } from '../../../store/useAppStore';
import { log } from '../../../services/appLog';
import type { MemoryCoverageViewport } from '../services/memoryCoverageViewport';
import {
  memoryOperationFailure,
  type MemoryOperationFailure,
} from '../services/friendMemoryFailure';
import { cairnText } from '../../../i18n/runtime';

export interface PreparedMemoryCoverageTile {
  id: string;
  bbox: [number, number, number, number];
  evidenceCount: number;
  geometrySha256: string;
  geometry: MultiPolygon;
}

export interface PreparedMemoryRegion {
  id: string;
  parentId: string | null;
  level: 2 | 3;
  name: string;
  bbox: [number, number, number, number];
  anchor: [number, number];
}

export interface PreparedMemoryCoverage {
  /** Compatibility label; authority is the complete snapshot, not a viewport. */
  viewportKey: 'all-authorized' | string;
  coverageVersion: string;
  coverageRuleVersion: number;
  datasetRevision: string;
  snapshotId: string;
  complete: boolean;
  geometry: MultiPolygon;
  tiles: PreparedMemoryCoverageTile[];
  regions: PreparedMemoryRegion[];
  evidenceCount: number;
  expectedPages: number;
  expectedTiles: number;
  loadedAtMs: number;
}

interface PreparedMemoryCoverageState {
  userId: string | null;
  coverage: PreparedMemoryCoverage | null;
  status: 'idle' | 'loading' | 'refreshing' | 'ready' | 'error';
  error: string | null;
  lastFailure: MemoryOperationFailure | null;
  version: number;
  /** Successful server writes that are not yet represented by a newer snapshot. */
  serverCoverageDirty: boolean;
  serverCoverageDirtyBaseline: string | null;
  serverCoverageDirtyGeneration: number;
  /** Diagnostic/refresh hint only. Rendering supplies its own viewport. */
  viewport: MemoryCoverageViewport | null;
  loadViewport: (viewport: MemoryCoverageViewport, force?: boolean) => Promise<void>;
  refreshCurrentViewport: () => Promise<void>;
  markServerCoverageDirty: () => void;
  reset: () => void;
}

let requestSequence = 0;
let activeRequestController: AbortController | null = null;
let refreshAfterLoad = false;
export const PREPARED_MEMORY_COVERAGE_TIMEOUT_MS = 30_000;
const SNAPSHOT_PAGE_SIZE = 24;

function validGeometry(value: any): value is MultiPolygon {
  return value?.type === 'MultiPolygon' && Array.isArray(value.coordinates);
}

function validBbox(value: any): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)
    && value[0] < value[2] && value[1] < value[3];
}

function viewportIntersectsTile(
  viewport: MemoryCoverageViewport,
  bbox: [number, number, number, number],
): boolean {
  const pad = 0.001;
  const [west, south, east, north] = viewport.bbox;
  return bbox[2] >= west - pad && bbox[0] <= east + pad
    && bbox[3] >= south - pad && bbox[1] <= north + pad;
}

export function selectPreparedCoverageViewport(
  coverage: PreparedMemoryCoverage | null,
  viewport: MemoryCoverageViewport | null | undefined,
): MultiPolygon | null {
  if (!coverage?.complete) return null;
  if (!viewport || coverage.tiles.length === 0) return coverage.geometry;
  return {
    type: 'MultiPolygon',
    coordinates: coverage.tiles
      .filter(tile => viewportIntersectsTile(viewport, tile.bbox))
      .flatMap(tile => tile.geometry.coordinates),
  };
}

function parseRegions(value: any): PreparedMemoryRegion[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.map(region => ({
    id: String(region?.id ?? ''),
    parentId: region?.parent_id == null ? null : String(region.parent_id),
    level: Number(region?.level) as 2 | 3,
    name: String(region?.name_en ?? ''),
    bbox: region?.bbox,
    anchor: region?.anchor,
  }));
  return parsed.every(region => region.id
    && (region.level === 2 || region.level === 3)
    && validBbox(region.bbox)
    && Array.isArray(region.anchor)
    && region.anchor.length === 2
    && region.anchor.every(Number.isFinite)) ? parsed : null;
}

export const usePreparedMemoryCoverageStore = create<PreparedMemoryCoverageState>((set, get) => ({
  userId: null,
  coverage: null,
  status: 'idle',
  error: null,
  lastFailure: null,
  version: 0,
  serverCoverageDirty: false,
  serverCoverageDirtyBaseline: null,
  serverCoverageDirtyGeneration: 0,
  viewport: null,

  loadViewport: async (viewport, force = false) => {
    const userId = String(useAppStore.getState().user?.id ?? '');
    if (!userId) return;
    const accountChanged = get().userId !== userId;
    if (!accountChanged && get().coverage?.complete && get().status === 'ready'
      && !get().serverCoverageDirty && !force) {
      if (get().viewport?.key !== viewport.key) set({ viewport });
      return;
    }
    if (!accountChanged && (get().status === 'loading' || get().status === 'refreshing')) {
      if (get().viewport?.key !== viewport.key) set({ viewport });
      if (force) refreshAfterLoad = true;
      return;
    }
    const sequence = ++requestSequence;
    activeRequestController?.abort();
    const controller = new AbortController();
    activeRequestController = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, PREPARED_MEMORY_COVERAGE_TIMEOUT_MS);
    const retained = accountChanged ? null : get().coverage;
    set({
      userId,
      viewport,
      coverage: retained,
      status: retained?.complete ? 'refreshing' : 'loading',
      error: null,
      lastFailure: null,
      version: accountChanged ? get().version + 1 : get().version,
    });
    const requestStartedAtMs = Date.now();
    const dirtyGenerationAtStart = get().serverCoverageDirtyGeneration;
    const dirtyBaselineAtStart = get().serverCoverageDirtyBaseline;
    const requestId = `mine-snapshot-${sequence}`;
    let stage = 'manifest';
    let targetRevision = `mine:pending:${sequence}`;
    try {
      let cursor: string | null | undefined;
      let snapshotId: string | undefined;
      let asOf: string | undefined;
      let manifest: any = null;
      const tiles: PreparedMemoryCoverageTile[] = [];
      const tileIds = new Set<string>();
      const pageIndexes = new Set<number>();
      let decodedBytes = 0;
      let receivedEvidenceCount = 0;
      do {
        const query = new URLSearchParams({ page_size: String(SNAPSHOT_PAGE_SIZE) });
        if (snapshotId) query.set('snapshot_id', snapshotId);
        if (asOf) query.set('as_of', asOf);
        if (cursor) query.set('cursor', cursor);
        stage = snapshotId ? 'page' : 'manifest';
        const response = await authenticatedFetch(
          `/api/memory/coverage-snapshot?${query.toString()}`,
          { expectedUserId: userId, signal: controller.signal },
        );
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`) as Error & { httpStatus?: number; code?: string };
          error.httpStatus = response.status;
          error.code = response.status === 409 ? 'SNAPSHOT_CHANGED' : `HTTP_${response.status}`;
          throw error;
        }
        const decodeStartedAtMs = Date.now();
        let body: any;
        try {
          body = await response.json();
        } catch (error) {
          Object.assign(error as object, { invalidPayload: true, operationStage: 'decode', httpStatus: response.status });
          throw error;
        }
        decodedBytes += JSON.stringify(body).length;
        manifest = body?.manifest;
        const page = body?.page;
        snapshotId = String(manifest?.snapshot_id ?? '');
        asOf = String(manifest?.as_of ?? '');
        targetRevision = snapshotId || targetRevision;
        if (!snapshotId || !asOf || Number(manifest?.coverage_rule_version) !== 4
          || !Number.isInteger(Number(manifest?.expected_pages))
          || !Number.isInteger(Number(manifest?.expected_tiles))
          || !Number.isFinite(Number(manifest?.expected_evidence_count))
          || !page || page.snapshot_id !== snapshotId
          || typeof page.complete !== 'boolean'
          || !Array.isArray(page.tiles)) {
          const error = new Error('Invalid complete Memory snapshot response');
          Object.assign(error, { invalidPayload: true, operationStage: 'validate', httpStatus: response.status, code: 'INVALID_SNAPSHOT_SCHEMA' });
          throw error;
        }
        if (page.tiles.length > 0) {
          const pageIndex = Number(page.page_index);
          if (!Number.isInteger(pageIndex) || pageIndexes.has(pageIndex)) {
            const error = new Error('Duplicate Memory snapshot page');
            Object.assign(error, { invalidPayload: true, operationStage: 'validate', httpStatus: response.status, code: 'DUPLICATE_PAGE' });
            throw error;
          }
          pageIndexes.add(pageIndex);
        }
        for (const tile of page.tiles) {
          const id = String(tile?.id ?? '');
          if (!id || tileIds.has(id) || !validBbox(tile?.bbox) || !validGeometry(tile?.geometry)) {
            const error = new Error('Invalid or duplicate Memory snapshot tile');
            Object.assign(error, { invalidPayload: true, operationStage: 'validate', httpStatus: response.status, code: 'INVALID_TILE' });
            throw error;
          }
          tileIds.add(id);
          const evidenceCount = Number(tile.evidence_count) || 0;
          receivedEvidenceCount += evidenceCount;
          tiles.push({
            id,
            bbox: tile.bbox,
            evidenceCount,
            geometrySha256: String(tile.geometry_sha256 ?? ''),
            geometry: tile.geometry,
          });
        }
        log('o92.memory.snapshot_page', {
          request_id: requestId,
          snapshot_revision: snapshotId,
          page_index: Number(page.page_index) || 0,
          page_tiles_n: page.tiles.length,
          expected_pages_n: Number(manifest.expected_pages),
          received_pages_n: pageIndexes.size,
          decode_ms: Date.now() - decodeStartedAtMs,
          complete: page.complete,
        });
        cursor = page.next_cursor == null ? null : String(page.next_cursor);
        if (page.complete !== (cursor === null)) {
          const error = new Error('Inconsistent Memory snapshot terminal state');
          Object.assign(error, { invalidPayload: true, operationStage: 'validate', httpStatus: response.status, code: 'INVALID_TERMINAL' });
          throw error;
        }
      } while (cursor);

      const regions = parseRegions(manifest?.regions);
      const expectedPages = Number(manifest?.expected_pages);
      const expectedTiles = Number(manifest?.expected_tiles);
      const expectedEvidenceCount = Number(manifest?.expected_evidence_count);
      if (!regions
        || pageIndexes.size !== expectedPages
        || tiles.length !== expectedTiles
        || receivedEvidenceCount !== expectedEvidenceCount
        || manifest?.complete !== (expectedTiles === 0)) {
        const error = new Error('Incomplete Memory snapshot');
        Object.assign(error, { invalidPayload: true, operationStage: 'completeness', code: 'INCOMPLETE_SNAPSHOT' });
        throw error;
      }
      if (sequence !== requestSequence
        || String(useAppStore.getState().user?.id ?? '') !== userId
        || get().userId !== userId) return;
      const geometry: MultiPolygon = {
        type: 'MultiPolygon',
        coordinates: tiles.flatMap(tile => tile.geometry.coordinates),
      };
      const stateBeforePublish = get();
      const refreshedPastDirtyBaseline = stateBeforePublish.serverCoverageDirty
        && stateBeforePublish.serverCoverageDirtyGeneration === dirtyGenerationAtStart
        && (dirtyBaselineAtStart == null
          || snapshotId !== dirtyBaselineAtStart
          || expectedEvidenceCount !== retained?.evidenceCount);
      set({
        coverage: {
          viewportKey: 'all-authorized',
          coverageVersion: snapshotId!,
          coverageRuleVersion: 4,
          datasetRevision: String(manifest.dataset_revision ?? ''),
          snapshotId: snapshotId!,
          complete: true,
          geometry,
          tiles,
          regions,
          evidenceCount: expectedEvidenceCount,
          expectedPages,
          expectedTiles,
          loadedAtMs: Date.now(),
        },
        status: 'ready',
        error: null,
        lastFailure: null,
        version: get().version + 1,
        serverCoverageDirty: refreshedPastDirtyBaseline
          ? false
          : stateBeforePublish.serverCoverageDirty,
        serverCoverageDirtyBaseline: refreshedPastDirtyBaseline
          ? null
          : stateBeforePublish.serverCoverageDirtyBaseline,
      });
      log('o92.memory.snapshot_complete', {
        request_id: requestId,
        snapshot_revision: snapshotId,
        request_ms: Date.now() - requestStartedAtMs,
        pages_n: expectedPages,
        tiles_n: expectedTiles,
        evidence_n: expectedEvidenceCount,
        decoded_bytes: decodedBytes,
      });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./useMemoryStore').useMemoryStore.getState().acknowledgePreparedCoverage();
    } catch (error: any) {
      if (sequence !== requestSequence || get().userId !== userId) return;
      const failure = memoryOperationFailure({
        error,
        httpStatus: Number.isFinite(Number(error?.httpStatus)) ? Number(error.httpStatus) : undefined,
        operation: 'mine-coverage-snapshot',
        stage: error?.operationStage ?? stage,
        targetRevision,
        timedOut,
        cancelled: error?.name === 'AbortError' && !timedOut,
        invalidPayload: Boolean(error?.invalidPayload),
        causeCode: error?.code,
      });
      if (failure.kind === 'cancelled') return;
      log('o92.memory.snapshot_failed', {
        request_id: requestId,
        request_ms: Date.now() - requestStartedAtMs,
        failure_kind: failure.kind,
        operation_stage: failure.stage,
        target_revision: failure.targetRevision,
        http_status: failure.httpStatus,
      });
      set({
        status: 'error',
        error: timedOut
          ? cairnText('memory.use-prepared-memory-coverage-store.memory-coverage-timed-out')
          : cairnText('memory.use-prepared-memory-coverage-store.unavailable'),
        lastFailure: failure,
        version: get().version + 1,
      });
    } finally {
      clearTimeout(timeout);
      if (activeRequestController === controller) activeRequestController = null;
      if (sequence === requestSequence && refreshAfterLoad && get().userId === userId) {
        refreshAfterLoad = false;
        void get().loadViewport(get().viewport ?? viewport, true);
      }
    }
  },

  refreshCurrentViewport: async () => {
    const viewport = get().viewport;
    if (viewport) await get().loadViewport(viewport, true);
  },

  markServerCoverageDirty: () => {
    const state = get();
    set({
      serverCoverageDirty: true,
      serverCoverageDirtyBaseline: state.serverCoverageDirty
        ? state.serverCoverageDirtyBaseline
        : state.coverage?.snapshotId ?? null,
      serverCoverageDirtyGeneration: state.serverCoverageDirtyGeneration + 1,
    });
    if (state.status === 'loading' || state.status === 'refreshing') {
      refreshAfterLoad = true;
      return;
    }
    if (state.viewport) void get().loadViewport(state.viewport, true);
  },

  reset: () => {
    requestSequence += 1;
    refreshAfterLoad = false;
    activeRequestController?.abort();
    activeRequestController = null;
    set({
      userId: null,
      coverage: null,
      status: 'idle',
      error: null,
      lastFailure: null,
      serverCoverageDirty: false,
      serverCoverageDirtyBaseline: null,
      serverCoverageDirtyGeneration: 0,
      viewport: null,
      version: get().version + 1,
    });
  },
}));
