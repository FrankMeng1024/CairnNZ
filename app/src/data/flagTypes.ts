/**
 * FLAG_TYPES — canonical flag/marker type definitions shared across screens.
 *
 * HikingScreen and MapScreen use this array directly.
 * RoutesScreen keeps its own variant (different cairn colour for trail theming).
 */
import { Colors } from '../components/tokens';
import type { IconName } from '../components/Icon';
import type { MarkerType } from './mockData';

export type FlagTypeEntry = {
  id: MarkerType;
  icon: IconName;
  label: string;
  color: string;
  bg: string;
};

export const FLAG_TYPES: FlagTypeEntry[] = [
  { id: 'danger',   icon: 'TriangleAlert', label: 'Danger',   color: Colors.danger,    bg: Colors.dangerBg          },
  { id: 'cairn',    icon: 'Mountain',      label: 'Cairn',    color: Colors.info,      bg: Colors.infoBg            },
  { id: 'water',    icon: 'Droplets',      label: 'Water',    color: Colors.success,   bg: Colors.successBg         },
  { id: 'junction', icon: 'Navigation2',   label: 'Junction', color: Colors.docOrange, bg: Colors.severityWarningBg },
];
