/**
 * trackDifficulty.ts — DOC NZ 6-level track difficulty classification.
 *
 * PRD3 E-018. The official Department of Conservation grading every NZ
 * tramper recognises. UI uses these strings verbatim — translating them
 * to "Easy/Medium/Hard" loses the local signal.
 *
 * Reference: https://www.doc.govt.nz/parks-and-recreation/things-to-do/walking-and-tramping/track-categories/
 *
 * Color stops are aligned to severity ladder (E-016) so a Short Walk
 * reads as severityNotice green and a Route reads as severityWarning
 * orange — same colour grammar as weather/hazards.
 */

import { Colors } from '../components/tokens';

export type TrackDifficulty =
  | 'short_walk'
  | 'walking_track'
  | 'easy_tramping'
  | 'tramping'
  | 'route'
  | 'expert_route';

export interface TrackDifficultyMeta {
  id: TrackDifficulty;
  /** DOC official label. Do not paraphrase. */
  label: string;
  /** One-line explanation visible to users who don't know DOC grades. */
  hint: string;
  /** Severity ladder colour — pairs with E-016 token system. */
  color: string;
  bg: string;
  /** Indicative time on foot. Display when route distance is unknown. */
  fitness: string;
}

export const TRACK_DIFFICULTY: Record<TrackDifficulty, TrackDifficultyMeta> = {
  short_walk: {
    id: 'short_walk',
    label: 'Short Walk',
    hint: 'Easy walking, well-formed path. Suitable for most ages.',
    color: Colors.severityNotice,
    bg: Colors.severityNoticeBg,
    fitness: 'A few minutes to an hour, mostly flat',
  },
  walking_track: {
    id: 'walking_track',
    label: 'Walking Track',
    hint: 'Easy to moderate, well-marked. Light boots recommended.',
    color: Colors.severityNotice,
    bg: Colors.severityNoticeBg,
    fitness: 'Up to a day, gentle gradient',
  },
  easy_tramping: {
    id: 'easy_tramping',
    label: 'Easy Tramping Track',
    hint: 'Mostly formed, some rough sections. Tramping experience helpful.',
    color: Colors.severityCaution,
    bg: Colors.severityCautionBg,
    fitness: 'Day to multi-day, moderate fitness',
  },
  tramping: {
    id: 'tramping',
    label: 'Tramping Track',
    hint: 'Mostly unformed with steep, rough or muddy sections. Navigation skills required.',
    color: Colors.severityCaution,
    bg: Colors.severityCautionBg,
    fitness: 'Multi-day, good fitness, hut bookings',
  },
  route: {
    id: 'route',
    label: 'Route',
    hint: 'Unformed, marked with poles or cairns. River crossings, navigation, weather skills essential.',
    color: Colors.severityWarning,
    bg: Colors.severityWarningBg,
    fitness: 'Backcountry experience, full kit',
  },
  expert_route: {
    id: 'expert_route',
    label: 'Expert Route',
    hint: 'Alpine or remote terrain. Full mountaineering or wilderness experience required.',
    color: Colors.severityDanger,
    bg: Colors.severityDangerBg,
    fitness: 'Specialist skills and equipment',
  },
};

export const TRACK_DIFFICULTY_ORDER: TrackDifficulty[] = [
  'short_walk',
  'walking_track',
  'easy_tramping',
  'tramping',
  'route',
  'expert_route',
];

export function getTrackDifficultyMeta(id: TrackDifficulty | undefined | null): TrackDifficultyMeta | null {
  if (!id) return null;
  return TRACK_DIFFICULTY[id] ?? null;
}
