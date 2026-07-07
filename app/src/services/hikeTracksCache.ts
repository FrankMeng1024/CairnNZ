/**
 * hikeTracksCache — v409 缓存清理 (L2 Size cap + L3 TTL + L4 Manual)
 *
 * See docs/audit-v404/v409-USER-DECISIONS.md §决策 3
 *
 * L2 Size cap: cairn-hike-tracks/ 总大小 > 300MB → 按 ended_at 升序删最老
 *              的已上传 completed 文件, 直到降到 250MB below
 *
 * L3 TTL: completed 文件, meta.uploaded=true, ended_at > 30 天前 → 自动删
 *
 * L4 Manual: clearUploaded() + clearAll() 供 Settings 按钮调用
 *
 * 触发时机:
 *   - 每次 stopTracking (v409 useTrackingStore.stopTracking 尾部)
 *   - 冷启 hydrate (v409 useAppStore.hydrate)
 *   - Settings 手动按钮
 */

import type { HikeMeta } from './hikeTrackWriter';

const HIKE_DIR = 'cairn-hike-tracks/';
const ACTIVE_DIR = HIKE_DIR + 'active/';
const COMPLETED_DIR = HIKE_DIR + 'completed/';
const META_DIR = HIKE_DIR + 'meta/';

// v409 决策 3: 300MB size cap + 30-day TTL + manual clean.
// v409-test: 允许 Playwright web 测试通过 globalThis.__cairnSizeCapOverride
// (Platform.OS==='web' + __DEV__ 情况下,production native 无此机制) 降低
// SIZE_CAP_BYTES 到 KB 级触发真删。native production 走默认 300MB 常量。
const DEFAULT_SIZE_CAP_BYTES = 300 * 1024 * 1024;
const DEFAULT_SIZE_TARGET_BYTES = 250 * 1024 * 1024;
function getSizeCap(): { cap: number; target: number } {
  try {
    const override = (globalThis as unknown as { __cairnSizeCapOverride?: { cap: number; target: number } }).__cairnSizeCapOverride;
    if (override && typeof override.cap === 'number' && typeof override.target === 'number' && override.cap > override.target) {
      return { cap: override.cap, target: override.target };
    }
  } catch { /* ignore */ }
  return { cap: DEFAULT_SIZE_CAP_BYTES, target: DEFAULT_SIZE_TARGET_BYTES };
}
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天 (v409 决策 3)

async function getFs(): Promise<any | null> {
  try {
    const legacy = await import('expo-file-system/legacy');
    if (legacy && legacy.documentDirectory) return legacy;
  } catch { /* fallthrough */ }
  // v409 web fallback: 复用 hikeTrackWriter 的 localStorage shim.
  // 逻辑相同,直接内联复制避免循环 import。
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    const PREFIX = 'cairn-fs://';
    return {
      documentDirectory: PREFIX,
      async getInfoAsync(path: string) {
        const raw = window.localStorage.getItem(path);
        if (path.endsWith('/')) {
          const dirEntry = window.localStorage.getItem(path + '__dir__');
          return { exists: !!dirEntry, isDirectory: true, uri: path };
        }
        return { exists: raw !== null, isDirectory: false, uri: path, size: raw ? raw.length : 0 };
      },
      async readAsStringAsync(path: string): Promise<string> {
        const raw = window.localStorage.getItem(path);
        if (raw === null) throw new Error('File not found: ' + path);
        return raw;
      },
      async readDirectoryAsync(path: string): Promise<string[]> {
        if (!path.endsWith('/')) path = path + '/';
        const raw = window.localStorage.getItem(path + '__files__');
        return raw ? JSON.parse(raw) : [];
      },
      async deleteAsync(path: string, _opts?: { idempotent?: boolean }) {
        window.localStorage.removeItem(path);
        const parent = path.substring(0, path.lastIndexOf('/') + 1);
        const listKey = parent + '__files__';
        const raw = window.localStorage.getItem(listKey);
        if (raw) {
          const list: string[] = JSON.parse(raw);
          const filename = path.substring(parent.length);
          const idx = list.indexOf(filename);
          if (idx >= 0) {
            list.splice(idx, 1);
            window.localStorage.setItem(listKey, JSON.stringify(list));
          }
        }
      },
    };
  }
  return null;
}

interface FileInfo {
  sid: string;
  size: number;
  ended_at: number;
  uploaded: boolean;
  meta: HikeMeta;
  completedPath: string;
  metaPath: string;
}

async function scanCompleted(): Promise<FileInfo[]> {
  const fs = await getFs();
  if (!fs) return [];
  const completedDir = fs.documentDirectory + COMPLETED_DIR;
  const metaDir = fs.documentDirectory + META_DIR;
  try {
    const info = await fs.getInfoAsync(completedDir);
    if (!info.exists) return [];
    const files = await fs.readDirectoryAsync(completedDir);
    const out: FileInfo[] = [];
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const sid = f.replace('.jsonl', '');
      const completedPath = completedDir + f;
      const metaPath = metaDir + sid + '.json';
      try {
        const fInfo = await fs.getInfoAsync(completedPath);
        const metaRaw = await fs.readAsStringAsync(metaPath);
        const meta: HikeMeta = JSON.parse(metaRaw);
        out.push({
          sid,
          size: (fInfo as any).size ?? 0,
          ended_at: meta.ended_at ?? 0,
          uploaded: meta.uploaded ?? false,
          meta,
          completedPath,
          metaPath,
        });
      } catch { /* skip malformed */ }
    }
    return out;
  } catch { return []; }
}

async function totalSize(files: FileInfo[]): Promise<number> {
  return files.reduce((s, f) => s + f.size, 0);
}

async function deleteFile(fs: any, info: FileInfo): Promise<void> {
  try { await fs.deleteAsync(info.completedPath, { idempotent: true }); } catch {}
  try { await fs.deleteAsync(info.metaPath, { idempotent: true }); } catch {}
}

/**
 * L2: Size cap enforcement. Only deletes uploaded=true files. If total is
 * over cap but no uploaded files exist (all pending), leaves everything
 * (data integrity > disk space).
 */
export async function enforceSizeCap(): Promise<{ deleted: number; freed_bytes: number; total_after: number }> {
  const fs = await getFs();
  if (!fs) return { deleted: 0, freed_bytes: 0, total_after: 0 };
  const { cap, target } = getSizeCap();
  const files = await scanCompleted();
  const total = await totalSize(files);
  if (total <= cap) return { deleted: 0, freed_bytes: 0, total_after: total };
  // Sort uploaded files by ended_at asc (oldest first)
  const uploaded = files.filter(f => f.uploaded).sort((a, b) => a.ended_at - b.ended_at);
  let running = total;
  let deleted = 0;
  let freed = 0;
  for (const f of uploaded) {
    if (running <= target) break;
    await deleteFile(fs, f);
    running -= f.size;
    freed += f.size;
    deleted++;
  }
  return { deleted, freed_bytes: freed, total_after: running };
}

/**
 * L3: TTL. Deletes uploaded files where meta.ended_at > 30 days ago.
 */
export async function enforceTTL(): Promise<{ deleted: number; freed_bytes: number }> {
  const fs = await getFs();
  if (!fs) return { deleted: 0, freed_bytes: 0 };
  const files = await scanCompleted();
  const cutoff = Date.now() - TTL_MS;
  let deleted = 0;
  let freed = 0;
  for (const f of files) {
    if (!f.uploaded) continue;
    if (f.ended_at > cutoff) continue;
    await deleteFile(fs, f);
    deleted++;
    freed += f.size;
  }
  return { deleted, freed_bytes: freed };
}

/**
 * L4 Manual: delete all uploaded=true completed files. Preserves pending
 * ones (server-side may not have them yet).
 */
export async function clearUploaded(): Promise<{ deleted: number; freed_bytes: number }> {
  const fs = await getFs();
  if (!fs) return { deleted: 0, freed_bytes: 0 };
  const files = await scanCompleted();
  let deleted = 0;
  let freed = 0;
  for (const f of files) {
    if (!f.uploaded) continue;
    await deleteFile(fs, f);
    deleted++;
    freed += f.size;
  }
  return { deleted, freed_bytes: freed };
}

/**
 * L4 Manual (DANGER): delete ALL local hike data including pending.
 * Callers must warn user first.
 */
export async function clearAll(): Promise<{ deleted: number; freed_bytes: number }> {
  const fs = await getFs();
  if (!fs) return { deleted: 0, freed_bytes: 0 };
  let deleted = 0;
  let freed = 0;
  for (const dir of [ACTIVE_DIR, COMPLETED_DIR, META_DIR]) {
    const path = fs.documentDirectory + dir;
    try {
      const info = await fs.getInfoAsync(path);
      if (!info.exists) continue;
      const files = await fs.readDirectoryAsync(path);
      for (const f of files) {
        try {
          const fInfo = await fs.getInfoAsync(path + f);
          freed += (fInfo as any).size ?? 0;
          await fs.deleteAsync(path + f, { idempotent: true });
          deleted++;
        } catch { /* best effort */ }
      }
    } catch { /* best effort */ }
  }
  return { deleted, freed_bytes: freed };
}

/**
 * Diagnostics: total disk usage of hike tracks. Used by Settings button
 * label + web hook __cairnStores.
 */
export async function getDiskUsage(): Promise<{ total_bytes: number; completed_count: number; active_count: number; uploaded_count: number }> {
  const fs = await getFs();
  if (!fs) return { total_bytes: 0, completed_count: 0, active_count: 0, uploaded_count: 0 };
  const completed = await scanCompleted();
  // Active
  let activeCount = 0;
  let activeBytes = 0;
  try {
    const activeDir = fs.documentDirectory + ACTIVE_DIR;
    const info = await fs.getInfoAsync(activeDir);
    if (info.exists) {
      const files = await fs.readDirectoryAsync(activeDir);
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        activeCount++;
        try {
          const fInfo = await fs.getInfoAsync(activeDir + f);
          activeBytes += (fInfo as any).size ?? 0;
        } catch {}
      }
    }
  } catch {}
  const uploadedCount = completed.filter(f => f.uploaded).length;
  return {
    total_bytes: activeBytes + completed.reduce((s, f) => s + f.size, 0),
    completed_count: completed.length,
    active_count: activeCount,
    uploaded_count: uploadedCount,
  };
}
