/**
 * markerTypes.ts — single source of truth for marker categories.
 *
 * v105 type 重构 (调研结果):
 * - 删除 free (Note) — 跟 cairn 重叠, 用 cairn 的隐私开关代替 (TODO)
 * - 删除 scenic — 拍照打卡场景吸收到 cairn (cairn 加 photo 字段, TODO)
 * - 重命名 supply → water (更直白)
 * - 新增 hut — DOC NZ backcountry hut 系统, NZ tramping 文化高频
 * - 5 个 type: danger / junction / water / hut / cairn
 *
 * 真实使用场景边界:
 * - 危险信息一律 danger (颜色权重高), 不写 cairn
 * - 拍照打卡用 cairn + photo (吸收 scenic)
 * - 路径决策用 junction (橙色视觉权重)
 * - 水源 + DOC hut 用 water/hut (alpine 安全级)
 * - cairn 是留言 + 备忘 + 拍照打卡的统称 (产品灵魂)
 */

import { Colors } from '../components/tokens';
import type { IconName } from '../components/Icon';

export type MarkerType =
  | 'danger'
  | 'junction'
  | 'water'      // v105: rename from 'supply'
  | 'hut'        // v105: new — DOC backcountry hut
  | 'cairn';

export interface MarkerTypeMeta {
  id: MarkerType;
  /** lucide icon name. 'cairn' is rendered by a custom SVG, not lucide. */
  icon: IconName;
  /** UI label shown in pickers. NZ-correct copy. */
  label: string;
  /** Pin colour — for icon stroke and outer ring. */
  color: string;
  /** Pin background tint — for the disc. Soft enough to read on cream map. */
  bg: string;
  /** One-line hint shown in the marker picker. */
  hint: string;
}

export const MARKER_TYPES: Record<MarkerType, MarkerTypeMeta> = {
  danger: {
    id: 'danger',
    icon: 'TriangleAlert',
    label: 'Danger',
    color: Colors.danger,
    bg: Colors.dangerBg,
    hint: 'Flooded crossing, slip, hazard ahead',
  },
  junction: {
    id: 'junction',
    icon: 'Navigation2',
    label: 'Junction',
    color: Colors.docOrange,
    bg: Colors.severityWarningBg,
    hint: 'Track split or turn-off',
  },
  water: {
    id: 'water',
    icon: 'Droplets',
    label: 'Water',
    color: Colors.success,
    bg: Colors.successBg,
    hint: 'Drinkable stream, hut tank',
  },
  hut: {
    id: 'hut',
    // 'House' is the lucide icon for DOC backcountry hut shelter.
    icon: 'House',
    label: 'Hut',
    color: Colors.trail, // sepia brown — natural shelter colour
    bg: 'rgba(181,130,61,0.10)',
    hint: 'DOC hut, shelter, campsite',
  },
  cairn: {
    id: 'cairn',
    // 'Mountain' is the closest lucide approximation; real rendering uses
    // <CairnStoneIcon> SVG so this is only used as a fallback in pickers.
    icon: 'Mountain',
    label: 'Cairn',
    color: Colors.trail, // sepia brown #b5823d — neutral, not severity
    bg: 'rgba(181,130,61,0.10)',
    hint: 'A note, photo, or memory for whoever comes next',
  },
};

/** Stable order for marker pickers — emergency first, then info, then cairn. */
export const MARKER_TYPE_ORDER: MarkerType[] = [
  'danger',
  'junction',
  'water',
  'hut',
  'cairn',
];

/** All 5 types are primary in v105 (no longer separating cairn out). */
export const PRIMARY_MARKER_TYPES: MarkerType[] = [
  'danger',
  'junction',
  'water',
  'hut',
  'cairn',
];

export function getMarkerMeta(type: MarkerType | undefined | null): MarkerTypeMeta | null {
  if (!type) return null;
  return MARKER_TYPES[type] ?? null;
}
