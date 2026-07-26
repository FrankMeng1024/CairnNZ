/**
 * useFriendMemoryStore — v413 friend memory 渲染 union
 *
 * 产品语义 (用户口述, 2026-07-08):
 * - Memory 页永远显示 union(self ∪ subscribed_friends) 的解锁 fog
 * - 未订阅任何 friend = 只看自己
 * - 订阅 friend X = fog 立即扩展 (显示 X 走过的地方也解锁)
 * - 取消订阅 X = fog 立即回缩 (借来的解锁还回去)
 * - 多 friend 订阅 = union (重叠不加成)
 * - 反选不动 self.points, 只是纯前端 render 层临时 merge
 *
 * 架构:
 * - "enabled" 的真源 = useMemorySubscriptionsStore.subscriptions (已存 DB)
 * - 此 store 只负责: (a) 缓存 friend memory points (GET /api/circle/fog),
 *   (b) 提供 getEnabledFriendPoints() 供 FogLayer / CairnPinsLayer union
 * - unsubscribe (DB 删) → subscriptions 变 → getEnabledFriendPoints 返回变 → fog 回缩
 *
 * 数据流:
 * 1. Memory 页 mount / 或 subscriptions 变化 → loadFriendFog() 拉 /api/circle/fog
 * 2. friendMemory[friendId] = points 存本地
 * 3. FogLayer / CairnPinsLayer union self.points + subscribed_friends 的 points
 * 4. subscribe/unsubscribe 走 useMemorySubscriptionsStore (它写 DB)
 */
import { create } from 'zustand';
import { authenticatedFetch } from '../../../services/apiService';

export interface FriendMemoryPoint {
  lat: number;
  lng: number;
  ts: number;
}

interface FriendMemoryState {
  /**
   * Map<friendId, points[]>. Server 返回的每个 subscribed friend 的 memory_points.
   * Load 时覆盖; 幂等.
   */
  friendMemory: Record<string, FriendMemoryPoint[]>;

  /** 递增版本号, 供 FogLayer / CairnPinsLayer useMemo 依赖数组用. */
  version: number;

  loading: boolean;
  loadError: string | null;

  /**
   * 从 backend 拉 GET /api/circle/fog, 填充 friendMemory.
   * Server 返回 shape: { friend_points: [{ friend_id, points: [{lat,lng,ts}] }] }.
   */
  loadFriendFog: () => Promise<void>;

  /**
   * 返回当前 subscribed friends 的所有 points (flat array).
   * "谁 subscribed" 从 useMemorySubscriptionsStore 拉, 保持真源单一.
   */
  getEnabledFriendPoints: () => FriendMemoryPoint[];

  /** 用户切换 / 登出时清空. */
  reset: () => void;
}

export const useFriendMemoryStore = create<FriendMemoryState>((set, get) => ({
  friendMemory: {},
  version: 0,
  loading: false,
  loadError: null,

  loadFriendFog: async () => {
    if (get().loading) return;
    set({ loading: true, loadError: null });
    try {
      const res = await authenticatedFetch('/api/circle/fog', { method: 'GET' });
      if (!res.ok) {
        throw new Error(`circle/fog HTTP ${res.status}`);
      }
      const data = await res.json();
      const arr = Array.isArray(data?.friend_points) ? data.friend_points : [];
      const next: Record<string, FriendMemoryPoint[]> = {};
      for (const entry of arr) {
        if (entry == null || entry.friend_id == null) continue;
        const fid = String(entry.friend_id);
        const pts = Array.isArray(entry.points) ? entry.points : [];
        next[fid] = pts.map((p: any) => ({
          lat: Number(p.lat),
          lng: Number(p.lng),
          ts: Number(p.ts) || 0,
        })).filter((p: { lat: number; lng: number; ts: number }) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      }
      set({
        friendMemory: next,
        loading: false,
        loadError: null,
        version: get().version + 1,
      });
    } catch (err: any) {
      set({
        loading: false,
        loadError: String(err?.message ?? err),
      });
    }
  },

  getEnabledFriendPoints: () => {
    // "enabled" = subscriptions store 里的 friend ids
    // 通过 require 避 module cycle
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useMemorySubscriptionsStore } = require('./useMemorySubscriptionsStore');
    const subs = useMemorySubscriptionsStore.getState().subscriptions;
    const friendMem = get().friendMemory;
    const out: FriendMemoryPoint[] = [];
    for (const s of subs) {
      const pts = friendMem[String(s.friend_id)];
      if (pts) out.push(...pts);
    }
    return out;
  },

  reset: () => {
    set({
      friendMemory: {},
      version: 0,
      loading: false,
      loadError: null,
    });
  },
}));

/**
 * 订阅 useMemorySubscriptionsStore 变化, 触发 version bump 让 FogLayer 重算.
 * 这是 store-to-store 桥梁: subscribe/unsubscribe → subscriptions 变 →
 * bump version → FogLayer useMemo 重算 → fog 回缩/扩展.
 *
 * 注意: 只 bump version, 不 refetch (friend memory 已 cache 在 friendMemory).
 * 这样 unsubscribe 后 fog 立即变化, 不等网络. subscribe 需要 refetch 拿新 friend
 * points → 在 UI 层显式调 loadFriendFog() (见 MemoryScreen).
 */
if (typeof globalThis !== 'undefined') {
  // 延迟 require 避 module cycle
  setTimeout(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useMemorySubscriptionsStore } = require('./useMemorySubscriptionsStore');
      let lastSubsRef = useMemorySubscriptionsStore.getState().subscriptions;
      useMemorySubscriptionsStore.subscribe((state: any) => {
        if (state.subscriptions !== lastSubsRef) {
          lastSubsRef = state.subscriptions;
          const fm = useFriendMemoryStore.getState();
          useFriendMemoryStore.setState({ version: fm.version + 1 });
        }
      });
    } catch {/* ignore module init race */}
  }, 0);
}
